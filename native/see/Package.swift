// swift-tools-version:6.0
import PackageDescription

// Qalam's screenshot reader (qalam-see): reads the words on product screenshots, on this Mac, with
// Apple's text recognition (Vision), and a difference hash of each picture, as JSON lines the core
// reads (server/see). Vision and ImageIO only. Built by scripts/build-see.mjs; the packaged app
// carries it in Resources.
let package = Package(
  name: "qalam-see",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "qalam-see",
      path: "Sources/qalam-see",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
