// swift-tools-version:6.0
import PackageDescription

// Qalam's voice helper (qalam-voice): listens to the microphone and writes what it hears, on this
// Mac, as JSON lines the core reads (server/voice). Apple's on-device engine where macOS has it
// (26 and later); NVIDIA's Parakeet through FluidAudio (CoreML, Apache-2.0) where it doesn't, its
// model downloaded only when asked. Built by scripts/build-voice.mjs; the packaged app carries it
// in Resources.
let package = Package(
  name: "qalam-voice",
  platforms: [.macOS(.v14)],
  dependencies: [.package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.18.0")],
  targets: [
    .executableTarget(
      name: "qalam-voice",
      dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
      path: "Sources/qalam-voice",
      exclude: ["Info.plist"],
      swiftSettings: [.swiftLanguageMode(.v5)],
      // The microphone's reason, inside the binary: macOS reads it when the helper asks to listen.
      linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Sources/qalam-voice/Info.plist"])]
    ),
  ]
)
