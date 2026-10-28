# The Homebrew cask, as .github/workflows/homebrew.yml writes it into the tap (ahmedamr-r/homebrew-tap)
# for each published release, with its version and the .dmg's checksum in place of @VERSION@ and @SHA256@.
cask "qalam-studio" do
  version "@VERSION@"
  sha256 "@SHA256@"

  url "https://github.com/ahmedamr-r/qalam-studio/releases/download/v#{version}/Qalam-Studio-#{version}-arm64.dmg"
  name "Qalam Studio"
  desc "Second brain for product makers, on your own Claude Code"
  homepage "https://github.com/ahmedamr-r/qalam-studio"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"

  app "Qalam Studio.app"

  # The app's own state. Organizations stay where they are (~/Qalam, or the folders opened as one).
  zap trash: [
    "~/Library/Application Support/Qalam Studio",
    "~/Library/Caches/Qalam",
    "~/Library/Caches/qalam-studio-updater",
    "~/Library/Logs/Qalam Studio",
    "~/Library/Preferences/io.github.ahmedamr-r.qalam-studio.plist",
    "~/Library/Saved Application State/io.github.ahmedamr-r.qalam-studio.savedState",
  ]
end
