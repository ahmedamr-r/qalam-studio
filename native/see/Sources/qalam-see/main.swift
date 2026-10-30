import CoreGraphics
import Foundation
import ImageIO
import Vision

/*
 * Qalam's screenshot reader. A command in, one JSON object per line out (server/see reads them):
 *   check            {"ok": true, "languages": [...]}: the languages it reads here
 *   read <file>…     per file, as each is read: {"file", "w", "h", "dhash", "lines": [{"text", "box", "conf"}]},
 *                    or {"file", "error"} for one it can't read. w and h are the picture's pixels, upright;
 *                    a box is [x, y, w, h] from 0 to 1 with the origin top left; lines go top to bottom,
 *                    a row's left to right. The dhash is 64 bits in 16 hex: the picture in 9×8 grays,
 *                    each bit whether a gray is lighter than the one to its right, row by row.
 * Anything else goes to stderr. Nothing leaves this Mac.
 */

// Qalam's lines alone go to stdout: whatever the frameworks print there goes to stderr.
let lineOut = FileHandle(fileDescriptor: dup(STDOUT_FILENO), closeOnDealloc: false)
dup2(STDERR_FILENO, STDOUT_FILENO)

func emit(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.withoutEscapingSlashes]) else { return }
  lineOut.write(d + Data([0x0A]))
}

func usage() -> Never {
  FileHandle.standardError.write(Data("usage: qalam-see check | qalam-see read <file>…\n".utf8))
  exit(2)
}

/// English and Arabic, as far as this Mac's recognizer reads them.
func readingRequest() -> VNRecognizeTextRequest {
  let r = VNRecognizeTextRequest()
  r.recognitionLevel = .accurate
  r.usesLanguageCorrection = true
  r.automaticallyDetectsLanguage = true
  let here = (try? r.supportedRecognitionLanguages()) ?? []
  r.recognitionLanguages = ["en-US", "ar-SA"].filter { here.contains($0) }
  return r
}

/// The picture upright (its EXIF orientation applied), at its own size.
func upright(_ url: URL) -> CGImage? {
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(src) > 0 else { return nil }
  let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
  let w = props?[kCGImagePropertyPixelWidth] as? Int ?? 0
  let h = props?[kCGImagePropertyPixelHeight] as? Int ?? 0
  guard w > 0, h > 0 else { return CGImageSourceCreateImageAtIndex(src, 0, nil) }
  let opts: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: max(w, h),
    kCGImageSourceShouldCacheImmediately: true,
  ]
  return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) ?? CGImageSourceCreateImageAtIndex(src, 0, nil)
}

/// The picture's grays at w×h, on white (a transparent screenshot reads as on a white page), top row first.
func grays(_ image: CGImage, _ w: Int, _ h: Int) -> [UInt8]? {
  var px = [UInt8](repeating: 255, count: w * h)
  let drawn = px.withUnsafeMutableBytes { buf -> Bool in
    guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
    ctx.setFillColor(gray: 1, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return true
  }
  return drawn ? px : nil
}

/// The difference hash: 9×8 grays, each the mean of a 16×16 block of a 144×128 copy (so one resize
/// doesn't decide it), then for each row whether each gray is lighter than the next.
func dhash(_ image: CGImage) -> String? {
  let (cols, rows, block) = (9, 8, 16)
  let (w, h) = (cols * block, rows * block)
  guard let px = grays(image, w, h) else { return nil }
  var cell = [Int](repeating: 0, count: cols * rows)
  for y in 0..<h {
    for x in 0..<w { cell[(y / block) * cols + x / block] += Int(px[y * w + x]) }
  }
  var bits: UInt64 = 0
  for r in 0..<rows {
    for c in 0..<(cols - 1) {
      bits = bits << 1 | (cell[r * cols + c] > cell[r * cols + c + 1] ? 1 : 0)
    }
  }
  return String(format: "%016llx", bits)
}

func rounded(_ v: CGFloat, _ places: Double = 4) -> Double {
  let k = pow(10, places)
  return (Double(v) * k).rounded() / k
}

struct Line {
  let text: String
  /// From the top left.
  let x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat
  let conf: Float
}

/// Top to bottom; lines whose middles sit within half a line of a row's are that row, left to right.
func reading(_ lines: [Line]) -> [Line] {
  var rows: [[Line]] = []
  for l in lines.sorted(by: { $0.y + $0.h / 2 < $1.y + $1.h / 2 }) {
    if let last = rows.last?.first, abs((l.y + l.h / 2) - (last.y + last.h / 2)) < min(l.h, last.h) / 2 {
      rows[rows.count - 1].append(l)
    } else {
      rows.append([l])
    }
  }
  return rows.flatMap { $0.sorted { $0.x < $1.x } }
}

func read(_ path: String) -> [String: Any] {
  let url = URL(fileURLWithPath: path)
  guard FileManager.default.isReadableFile(atPath: url.path) else { return ["file": path, "error": "No file to read there."] }
  guard let image = upright(url) else { return ["file": path, "error": "This Mac can't open it as a picture."] }
  guard let hash = dhash(image) else { return ["file": path, "error": "This Mac couldn't draw the picture."] }
  let request = readingRequest()
  do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  } catch {
    return ["file": path, "error": "This Mac couldn't read its words: \(error.localizedDescription)"]
  }
  let lines: [Line] = (request.results ?? []).compactMap { o in
    guard let best = o.topCandidates(1).first, !best.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    let b = o.boundingBox
    return Line(text: best.string, x: b.minX, y: 1 - b.maxY, w: b.width, h: b.height, conf: best.confidence)
  }
  return [
    "file": path,
    "w": image.width,
    "h": image.height,
    "dhash": hash,
    "lines": reading(lines).map { l in
      ["text": l.text, "box": [rounded(l.x), rounded(l.y), rounded(l.w), rounded(l.h)], "conf": rounded(CGFloat(l.conf), 3)] as [String: Any]
    },
  ]
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "check":
  emit(["ok": true, "languages": readingRequest().recognitionLanguages])
case "read":
  let files = args.dropFirst()
  if files.isEmpty { usage() }
  for f in files { autoreleasepool { emit(read(f)) } }
default:
  usage()
}
exit(0)
