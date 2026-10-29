import AVFoundation
import Foundation
import Speech

/*
 * Qalam's voice helper. A command in, one JSON object per line out (server/voice reads them):
 *   check                            what this Mac has: Apple's engine and its English pack, the microphone
 *   install [--engine apple]         macOS fetches Apple's English pack: progress lines, then done
 *   listen [--engine apple] [--file f]
 *                                    ready, then level and partial lines (everything heard so far), then
 *                                    final; "stop" on stdin finishes the last words, "cancel" or the end of
 *                                    stdin drops them. --file reads a recording instead (for tests).
 * Errors are {"t":"error","code","message"} and exit 1. Audio never leaves this Mac.
 */

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o) else { return }
  FileHandle.standardOutput.write(d + Data([0x0A]))
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
  if await AssetInventory.status(forModules: [transcriber]) != .installed { try await installApple(transcriber) }
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
  guard #available(macOS 26, *) else { fail("unavailable", "Apple's speech engine needs macOS 26.") }
  do {
    try await listenApple(file: option("--file"))
  } catch {
    fail("listen", "Listening stopped: \(error.localizedDescription)")
  }
default:
  fail("usage", "Commands: check, install, listen.")
}
exit(0)
