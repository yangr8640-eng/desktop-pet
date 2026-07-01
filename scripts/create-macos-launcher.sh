#!/bin/bash
# macOS 桌宠启动器 — 在桌面创建 桌宠.app
# 使用方法: bash scripts/create-macos-launcher.sh

APP_DIR="$HOME/Desktop/桌宠.app"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$APP_DIR" ]; then
  mkdir -p "$APP_DIR/Contents/MacOS"
  mkdir -p "$APP_DIR/Contents/Resources"

  cat > "$APP_DIR/Contents/MacOS/桌宠" << 'SCRIPT'
#!/bin/bash
DIR="$(dirname "$0")"
PROJECT_DIR="$DIR/../../../desktop-pet-main"

cd "$PROJECT_DIR" || { osascript -e 'display dialog "找不到桌宠项目目录" buttons {"确定"}'; exit 1; }
pkill -9 -f "desktop-pet-main/node_modules/electron" 2>/dev/null
sleep 0.5
unset ELECTRON_RUN_AS_NODE
"$PROJECT_DIR/node_modules/.bin/electron" . &
SCRIPT
  chmod +x "$APP_DIR/Contents/MacOS/桌宠"

  cat > "$APP_DIR/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>桌宠</string>
    <key>CFBundleIdentifier</key>
    <string>com.desktoppet.launcher</string>
    <key>CFBundleName</key>
    <string>桌宠</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST
fi

# Copy icon based on current theme
CURRENT_THEME=$(grep -o '"activeTheme"[^"]*"[^"]*"' "$HOME/Library/Application Support/desktop-pet/config.json" 2>/dev/null | cut -d'"' -f4)
CURRENT_THEME=${CURRENT_THEME:-claude}
cp "$PROJECT_DIR/assets/icon_${CURRENT_THEME}.icns" "$APP_DIR/Contents/Resources/icon.icns" 2>/dev/null || \
  cp "$PROJECT_DIR/assets/icon.icns" "$APP_DIR/Contents/Resources/icon.icns"

echo "桌宠启动器已创建: $APP_DIR"
