import AVFoundation
import FluidAudio
import Foundation
import Speech

/*
 * Qalam's voice helper. A command in, one JSON object per line out (server/voice reads them):
 *   check                            what this Mac has: Apple's engine and its English pack, the microphone
 *   install [--engine apple]         macOS fetches Apple's English pack: progress lines, then done
 *   listen [--engine apple|parakeet] [--models dir] [--file f] [--feed f]
 *                                    loading (while a model gets ready), ready, then level and partial lines (everything heard so far), then
 *                                    final; "stop" on stdin finishes the last words, "cancel" or the end of
 *                                    stdin drops them. Parakeet reads its model from --models (the core
 *                                    downloads it, only when asked). --file reads a recording instead, --feed
 *                                    plays one into the live path at speaking pace (both for tests).
 * Errors are {"t":"error","code","message"} and exit 1. Audio never leaves this Mac.
 */

// Qalam's lines alone go to stdout: what the frameworks print there (CoreML does) goes to stderr.
let lineOut = FileHandle(fileDescriptor: dup(STDOUT_FILENO), closeOnDealloc: false)
dup2(STDERR_FILENO, STDOUT_FILENO)

func emit(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o) else { return }
  lineOut.write(d + Data([0x0A]))
}

func fail(_ code: String, _ message: String) -> Never {
  emit(["t": "error", "code": code, "message": message])
  exit(1)
}

let args = Array(CommandLine.arguments.dropFirst())
func option(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}

let english = Locale(identifier: "en-US")
/// QALAM_VOICE_APPLE=0 makes this Mac look like one without Apple's engine, to try the other path.
let appleOff = ProcessInfo.processInfo.environment["QALAM_VOICE_APPLE"] == "0"
/// The longest a listen runs before it finishes by itself.
let maxListen: UInt64 = 5 * 60

func micState() -> String {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: return "granted"
  case .denied, .restricted: return "denied"
  default: return "undetermined"
  }
}

// MARK: Apple's engine (macOS 26)

@available(macOS 26, *)
func appleTranscriber() async -> SpeechTranscriber? {
  guard !appleOff, SpeechTranscriber.isAvailable, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: english) else { return nil }
  return SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
}

@available(macOS 26, *)
func installApple(_ t: SpeechTranscriber) async throws {
  guard let request = try await AssetInventory.assetInstallationRequest(supporting: [t]) else { return }
  let ticker = Task {
    while !Task.isCancelled {
      emit(["t": "progress", "done": request.progress.fractionCompleted])
      try? await Task.sleep(nanoseconds: 400_000_000)
    }
  }
  defer { ticker.cancel() }
  try await request.downloadAndInstall()
}

/// The next word on stdin: "stop" or "cancel" (the end of stdin cancels: the core is gone).
func nextCommand() async -> String {
  await withCheckedContinuation { c in
    Thread.detachNewThread {
      while let line = readLine() {
        let word = line.trimmingCharacters(in: .whitespaces)
        if word == "stop" || word == "cancel" { return c.resume(returning: word) }
      }
      c.resume(returning: "cancel")
    }
  }
}

/// "stop" or "cancel" from the core, or "stop" once the listen has run its longest.
func untilDone() async -> String {
  await withTaskGroup(of: String.self) { g in
    g.addTask { await nextCommand() }
    g.addTask {
      try? await Task.sleep(nanoseconds: maxListen * 1_000_000_000)
      return "stop"
    }
    let first = await g.next() ?? "cancel"
    g.cancelAll()
    return first
  }
}

/// The microphone's loudness, 0 to 1, from a buffer of floats.
func level(_ b: AVAudioPCMBuffer) -> Double {
  guard let ch = b.floatChannelData?[0], b.frameLength > 0 else { return 0 }
  var sum: Float = 0
  for i in 0..<Int(b.frameLength) { sum += ch[i] * ch[i] }
  let rms = sqrt(sum / Float(b.frameLength))
  let db = 20 * log10(max(rms, 0.000_01))
  return Double(min(1, max(0, (db + 50) / 50)))
}

@available(macOS 26, *)
func listenApple(file: String?) async throws {
  guard let transcriber = await appleTranscriber() else { fail("unavailable", "Apple's speech engine isn't on this Mac.") }
  if await AssetInventory.status(forModules: [transcriber]) != .installed {
    emit(["t": "loading"])
    try await installApple(transcriber)
  }
  let analyzer = SpeechAnalyzer(modules: [transcriber])

  // Everything heard so far: what's settled, then what's still being worked out.
  let reader = Task { () -> String in
    var settled = ""
    for try await r in transcriber.results {
      let words = String(r.text.characters)
      if r.isFinal { settled += words }
      emit(["t": "partial", "text": (r.isFinal ? settled : settled + words).trimmingCharacters(in: .whitespacesAndNewlines)])
    }
    return settled.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  if let file {
    let audio = try AVAudioFile(forReading: URL(fileURLWithPath: file))
    emit(["t": "ready"])
    try await analyzer.start(inputAudioFile: audio, finishAfterFile: true)
    emit(["t": "final", "text": try await reader.value])
    return
  }

  guard await AVCaptureDevice.requestAccess(for: .audio) else {
    fail("mic-denied", "Qalam can't use the microphone. Allow it in System Settings → Privacy & Security → Microphone.")
  }
  guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else { fail("format", "Apple's speech engine took no audio format.") }
  try await analyzer.prepareToAnalyze(in: format)
  let (stream, input) = AsyncStream<AnalyzerInput>.makeStream()
  try await analyzer.start(inputSequence: stream)

  let engine = AVAudioEngine()
  let node = engine.inputNode
  let natural = node.outputFormat(forBus: 0)
  guard natural.sampleRate > 0, let converter = AVAudioConverter(from: natural, to: format) else { fail("no-mic", "No microphone is set up on this Mac.") }
  var lastLevel = Date.distantPast
  node.installTap(onBus: 0, bufferSize: 4096, format: natural) { buffer, _ in
    if Date().timeIntervalSince(lastLevel) > 0.08 {
      lastLevel = Date()
      emit(["t": "level", "v": (level(buffer) * 100).rounded() / 100])
    }
    let room = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / natural.sampleRate) + 1024
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: room) else { return }
    var given = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if given {
        status.pointee = .noDataNow
        return nil
      }
      given = true
      status.pointee = .haveData
      return buffer
    }
    if error == nil, out.frameLength > 0 { input.yield(AnalyzerInput(buffer: out)) }
  }
  engine.prepare()
  try engine.start()
  emit(["t": "ready"])

  let word = await untilDone()
  engine.stop()
  node.removeTap(onBus: 0)
  input.finish()
  if word == "stop" {
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    emit(["t": "final", "text": try await reader.value])
  } else {
    await analyzer.cancelAndFinishNow()
    reader.cancel()
    emit(["t": "cancelled"])
  }
}


// MARK: Parakeet (any Apple silicon Mac on macOS 14 and later)

/// The microphone, as Parakeet hears it: 16 kHz, one channel.
let sixteen = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!

/// What the microphone has heard, written by the audio thread and read by the transcriber.
final class Heard: @unchecked Sendable {
  private let lock = NSLock()
  private var samples: [Float] = []
  func add(_ s: UnsafeBufferPointer<Float>) {
    lock.lock()
    samples.append(contentsOf: s)
    lock.unlock()
  }
  func since(_ i: Int) -> [Float] {
    lock.lock()
    defer { lock.unlock() }
    return i < samples.count ? Array(samples[i...]) : []
  }
}

func parakeet() async -> AsrManager {
  guard let dir = option("--models") else { fail("usage", "Parakeet needs --models <folder>.") }
  do {
    let models = try AsrModels.loadLocal(from: URL(fileURLWithPath: dir), version: .v2)
    let asr = AsrManager(config: .default)
    try await asr.loadModels(models)
    return asr
  } catch {
    fail("not-installed", "Parakeet isn't installed on this Mac. Install it in Connections.")
  }
}

/// Loudness of each 20 ms of a stretch.
func frameLevels(_ s: [Float]) -> [Float] {
  stride(from: 0, to: s.count - 319, by: 320).map { i in
    var sum: Float = 0
    for x in s[i..<(i + 320)] { sum += x * x }
    return sqrt(sum / 320)
  }
}

/// Where someone speaks in a stretch, with a little air around it; nil when it's only room noise
/// (Parakeet makes words up from silence). Speech is well above the stretch's quietest part.
func speechSpan(_ s: [Float]) -> Range<Int>? {
  let levels = frameLevels(s)
  guard levels.count >= 25 else { return nil }
  let floor = levels.sorted()[levels.count / 5]
  let loud = max(0.003, floor * 4)
  let voiced = levels.indices.filter { levels[$0] > loud }
  guard voiced.count >= 15, let first = voiced.first, let last = voiced.last else { return nil }
  return max(0, (first - 10) * 320)..<min(s.count, (last + 16) * 320)
}

/// Quiet at the end: the last 0.6 s are near the stretch's quietest.
func quietTail(_ s: [Float]) -> Bool {
  let levels = frameLevels(s)
  guard levels.count > 60 else { return false }
  let floor = levels.sorted()[levels.count / 5]
  return levels.suffix(30).allSatisfy { $0 < max(0.003, floor * 2.5) }
}

func joined(_ a: String, _ b: String) -> String {
  let x = a.trimmingCharacters(in: .whitespaces), y = b.trimmingCharacters(in: .whitespaces)
  return x.isEmpty ? y : y.isEmpty ? x : "\(x) \(y)"
}

func listenParakeet(file: String?) async throws {
  // Loading takes a second; the first time on a Mac, CoreML prepares the model for its chip (about 40 s).
  emit(["t": "loading"])
  let asr = await parakeet()
  func words(_ samples: [Float]) async throws -> String {
    var state = TdtDecoderState.make(decoderLayers: await asr.decoderLayerCount)
    return try await asr.transcribe(samples, decoderState: &state).text
  }

  if let file {
    emit(["t": "ready"])
    var state = TdtDecoderState.make(decoderLayers: await asr.decoderLayerCount)
    let text = try await asr.transcribe(URL(fileURLWithPath: file), decoderState: &state).text
    emit(["t": "final", "text": text.trimmingCharacters(in: .whitespacesAndNewlines)])
    return
  }

  let heard = Heard()
  // --feed plays a recording into the live path at the pace it was spoken (for tests: no microphone).
  if let feed = option("--feed") {
    let samples = try sixteenK(URL(fileURLWithPath: feed))
    emit(["t": "ready"])
    Task.detached {
      var i = 0
      while i < samples.count {
        let n = min(1600, samples.count - i)
        samples[i..<(i + n)].withUnsafeBufferPointer { heard.add($0) }
        i += n
        try? await Task.sleep(nanoseconds: 100_000_000)
      }
    }
    try await transcribeLive(heard, words: words, stopMic: {})
    return
  }

  guard await AVCaptureDevice.requestAccess(for: .audio) else {
    fail("mic-denied", "Qalam can't use the microphone. Allow it in System Settings → Privacy & Security → Microphone.")
  }
  let engine = AVAudioEngine()
  let node = engine.inputNode
  let natural = node.outputFormat(forBus: 0)
  guard natural.sampleRate > 0, let converter = AVAudioConverter(from: natural, to: sixteen) else { fail("no-mic", "No microphone is set up on this Mac.") }
  var lastLevel = Date.distantPast
  node.installTap(onBus: 0, bufferSize: 4096, format: natural) { buffer, _ in
    if Date().timeIntervalSince(lastLevel) > 0.08 {
      lastLevel = Date()
      emit(["t": "level", "v": (level(buffer) * 100).rounded() / 100])
    }
    let room = AVAudioFrameCount(Double(buffer.frameLength) * 16000 / natural.sampleRate) + 1024
    guard let out = AVAudioPCMBuffer(pcmFormat: sixteen, frameCapacity: room) else { return }
    var given = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if given {
        status.pointee = .noDataNow
        return nil
      }
      given = true
      status.pointee = .haveData
      return buffer
    }
    if error == nil, out.frameLength > 0, let ch = out.floatChannelData?[0] { heard.add(UnsafeBufferPointer(start: ch, count: Int(out.frameLength))) }
  }
  engine.prepare()
  try engine.start()
  emit(["t": "ready"])
  try await transcribeLive(heard, words: words) {
    engine.stop()
    node.removeTap(onBus: 0)
  }
}

/// A recording as Parakeet hears it: 16 kHz, one channel.
func sixteenK(_ url: URL) throws -> [Float] {
  let file = try AVAudioFile(forReading: url)
  guard let input = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
    let converter = AVAudioConverter(from: file.processingFormat, to: sixteen),
    let out = AVAudioPCMBuffer(pcmFormat: sixteen, frameCapacity: AVAudioFrameCount(Double(file.length) * 16000 / file.processingFormat.sampleRate) + 4096)
  else { fail("format", "Couldn't read the recording.") }
  try file.read(into: input)
  var given = false
  var error: NSError?
  converter.convert(to: out, error: &error) { _, status in
    if given {
      status.pointee = .endOfStream
      return nil
    }
    given = true
    status.pointee = .haveData
    return input
  }
  if let error { throw error }
  return Array(UnsafeBufferPointer(start: out.floatChannelData![0], count: Int(out.frameLength)))
}

/// Text as it's spoken, from what `heard` collects, until stop (or cancel) comes in.
func transcribeLive(_ heard: Heard, words: @escaping ([Float]) async throws -> String, stopMic: () -> Void) async throws {
  // Stretches of speech, cut at a pause (or at 12 s, inside the model's window): what's settled,
  // then the stretch going on, read again every second as it grows.
  var settled = ""
  var cut = 0
  let reader = Task {
    while !Task.isCancelled {
      try? await Task.sleep(nanoseconds: 900_000_000)
      if Task.isCancelled { break }
      let stretch = heard.since(cut)
      if stretch.count < 8000 { continue }
      let span = speechSpan(stretch)
      let text = span == nil ? "" : ((try? await words(Array(stretch[span!]))) ?? "")
      if !text.isEmpty { emit(["t": "partial", "text": joined(settled, text)]) }
      if (stretch.count > 48000 && quietTail(stretch)) || stretch.count > 192_000 {
        settled = joined(settled, text)
        cut += stretch.count
      }
    }
  }

  let word = await untilDone()
  stopMic()
  reader.cancel()
  _ = await reader.value
  if word == "stop" {
    let rest = heard.since(cut)
    let span = speechSpan(rest)
    let text = span == nil ? "" : ((try? await words(Array(rest[span!]))) ?? "")
    emit(["t": "final", "text": joined(settled, text)])
  } else {
    emit(["t": "cancelled"])
  }
}

// MARK: Commands

switch args.first ?? "check" {
case "check":
  var apple: [String: Any] = ["available": false, "ready": false]
  if #available(macOS 26, *), let t = await appleTranscriber() {
    let status = await AssetInventory.status(forModules: [t])
    apple = ["available": status != .unsupported, "ready": status == .installed]
  }
  emit(["t": "check", "apple": apple, "mic": micState()])
case "install":
  guard #available(macOS 26, *), let t = await appleTranscriber() else { fail("unavailable", "Apple's speech engine isn't on this Mac.") }
  do {
    try await installApple(t)
    emit(["t": "done"])
  } catch {
    fail("install", "macOS couldn't fetch the English speech pack: \(error.localizedDescription)")
  }
case "listen":
  do {
    if option("--engine") == "parakeet" {
      try await listenParakeet(file: option("--file"))
    } else {
      guard #available(macOS 26, *) else { fail("unavailable", "Apple's speech engine needs macOS 26.") }
      try await listenApple(file: option("--file"))
    }
  } catch {
    fail("listen", "Listening stopped: \(error.localizedDescription)")
  }
default:
  fail("usage", "Commands: check, install, listen.")
}
exit(0)
