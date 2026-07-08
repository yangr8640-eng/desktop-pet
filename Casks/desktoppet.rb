cask "desktoppet" do
  version "1.0.0"
  sha256 "d00cf2d845509a45c2161e40a9cab9dae9eeffb6409129dcac2647fb535b3c16"

  url "https://github.com/yangr8640-eng/desktop-pet/releases/download/v#{version}/DesktopPet-#{version}-arm64.dmg"
  name "DesktopPet"
  desc "AI desktop pet - A cute kitten companion for macOS"
  homepage "https://github.com/yangr8640-eng/desktop-pet"

  app "DesktopPet.app"

  zap trash: [
    "~/Library/Application Support/desktop-pet",
    "~/Library/Preferences/com.desktoppet.cat.plist",
    "~/Library/Saved Application State/com.desktoppet.cat.savedState",
  ]
end
