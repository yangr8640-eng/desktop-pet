const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const MAC_SHORTCUT_APP_NAME = '桌宠.app';
const WINDOWS_SHORTCUT_NAMES = ['DesktopPet.lnk', '桌宠.lnk'];
const ICON_SYNC_LOG = path.join(os.tmpdir(), 'desktop-pet-icon-sync.log');

function logIconSync(message) {
  try {
    fs.appendFileSync(ICON_SYNC_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch { /* ignore logging failures */ }
}

function getDesktopPath() {
  const canUseElectronDesktopPath =
    app &&
    typeof app.isReady === 'function' &&
    typeof app.getPath === 'function' &&
    app.isReady();
  return canUseElectronDesktopPath ? app.getPath('desktop') : path.join(os.homedir(), 'Desktop');
}

function getUserDataPath() {
  const canUseElectronUserDataPath =
    app &&
    typeof app.isReady === 'function' &&
    typeof app.getPath === 'function' &&
    app.isReady();
  return canUseElectronUserDataPath
    ? app.getPath('userData')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'desktop-pet');
}

function getMacShortcutAppPath() {
  return path.join(getDesktopPath(), MAC_SHORTCUT_APP_NAME);
}

function escapeAppleScriptString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function touchIfExists(targetPath, date) {
  try {
    if (fs.existsSync(targetPath)) fs.utimesSync(targetPath, date, date);
  } catch { /* best-effort Finder cache nudge */ }
}

function getWritableShortcutAppPath(shortcutAppPath) {
  try {
    if (fs.lstatSync(shortcutAppPath).isSymbolicLink()) {
      return fs.realpathSync(shortcutAppPath);
    }
  } catch { /* use shortcut path below */ }
  return shortcutAppPath;
}

function refreshDesktopIcon(shortcutAppPath, writableShortcutAppPath, appIconPath) {
  const now = new Date();
  touchIfExists(appIconPath, now);
  touchIfExists(path.join(writableShortcutAppPath, 'Contents', 'Info.plist'), now);
  touchIfExists(path.join(writableShortcutAppPath, 'Contents', 'Resources'), now);
  touchIfExists(writableShortcutAppPath, now);

  try {
    execFileSync('/usr/bin/osascript', [
      '-e',
      `tell application "Finder" to update POSIX file "${escapeAppleScriptString(shortcutAppPath)}"`
    ], { stdio: 'ignore' });
  } catch { /* Finder may not be running; the icon file is still updated */ }
}

function syncMacDesktopIcon(themeId) {
  const shortcutAppPath = getMacShortcutAppPath();
  const writableShortcutAppPath = getWritableShortcutAppPath(shortcutAppPath);
  const themedIconPath = path.join(__dirname, '..', 'assets', `icon_${themeId}.icns`);
  const fallbackIconPath = path.join(__dirname, '..', 'assets', 'icon.icns');
  const iconPath = fs.existsSync(themedIconPath) ? themedIconPath : fallbackIconPath;
  const appIconPath = path.join(writableShortcutAppPath, 'Contents', 'Resources', 'icon.icns');

  try {
    if (!fs.existsSync(iconPath)) {
      logIconSync(`missing icon: ${iconPath}`);
      return false;
    }
    if (!fs.existsSync(shortcutAppPath)) {
      logIconSync(`missing shortcut: ${shortcutAppPath}`);
      return false;
    }
    fs.mkdirSync(path.dirname(appIconPath), { recursive: true });
    fs.writeFileSync(appIconPath, fs.readFileSync(iconPath));
    refreshDesktopIcon(shortcutAppPath, writableShortcutAppPath, appIconPath);
    return true;
  } catch (error) {
    logIconSync(`theme=${themeId} failed: ${error.message}; shortcut=${shortcutAppPath}; writable=${writableShortcutAppPath}; icon=${iconPath}`);
    return false;
  }
}

function getWindowsShortcutRoots() {
  const roots = [getDesktopPath()];

  if (process.env.PUBLIC) {
    roots.push(path.join(process.env.PUBLIC, 'Desktop'));
  }
  if (process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }
  if (process.env.PROGRAMDATA) {
    roots.push(path.join(process.env.PROGRAMDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }

  return [...new Set(roots.filter(Boolean))];
}

function collectWindowsShortcuts() {
  const shortcuts = new Set();

  for (const root of getWindowsShortcutRoots()) {
    for (const shortcutName of WINDOWS_SHORTCUT_NAMES) {
      shortcuts.add(path.join(root, shortcutName));
    }

    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          for (const shortcutName of WINDOWS_SHORTCUT_NAMES) {
            shortcuts.add(path.join(root, entry.name, shortcutName));
          }
        }
      }
    } catch { /* shortcut root may not exist */ }
  }

  return [...shortcuts].filter(shortcutPath => fs.existsSync(shortcutPath));
}

function exportWindowsIcon(themeId) {
  const themedIconPath = path.join(__dirname, '..', 'assets', `icon_${themeId}.ico`);
  const fallbackIconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  const iconPath = fs.existsSync(themedIconPath) ? themedIconPath : fallbackIconPath;

  if (!fs.existsSync(iconPath)) {
    logIconSync(`missing windows icon: ${iconPath}`);
    return null;
  }

  const iconDir = path.join(getUserDataPath(), 'theme-icons');
  const exportedIconPath = path.join(iconDir, path.basename(iconPath));
  fs.mkdirSync(iconDir, { recursive: true });
  fs.writeFileSync(exportedIconPath, fs.readFileSync(iconPath));
  return exportedIconPath;
}

function escapePowerShellSingleQuotedString(value) {
  return value.replace(/'/g, "''");
}

function getPowerShellPath() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const systemPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(systemPowerShell) ? systemPowerShell : 'powershell.exe';
}

function updateWindowsShortcutIcon(shortcutPath, iconPath) {
  const script = [
    '$shell = New-Object -ComObject WScript.Shell',
    `$shortcut = $shell.CreateShortcut('${escapePowerShellSingleQuotedString(shortcutPath)}')`,
    `$shortcut.IconLocation = '${escapePowerShellSingleQuotedString(`${iconPath},0`)}'`,
    '$shortcut.Save()',
    `$item = Get-Item -LiteralPath '${escapePowerShellSingleQuotedString(shortcutPath)}'`,
    '$item.LastWriteTime = Get-Date'
  ].join('; ');

  execFileSync(getPowerShellPath(), [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], { stdio: 'ignore', windowsHide: true });
}

function refreshWindowsShellIcons() {
  const ie4uinitPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ie4uinit.exe');
  try {
    execFileSync(ie4uinitPath, ['-show'], { stdio: 'ignore', windowsHide: true });
  } catch { /* Windows may refresh the shortcut lazily */ }
}

function syncWindowsDesktopIcon(themeId) {
  try {
    const exportedIconPath = exportWindowsIcon(themeId);
    if (!exportedIconPath) return false;

    const shortcuts = collectWindowsShortcuts();
    if (shortcuts.length === 0) {
      logIconSync(`no windows shortcuts found for theme=${themeId}`);
      return false;
    }

    let updatedCount = 0;
    for (const shortcutPath of shortcuts) {
      try {
        updateWindowsShortcutIcon(shortcutPath, exportedIconPath);
        updatedCount += 1;
      } catch (error) {
        logIconSync(`shortcut update failed: ${error.message}; shortcut=${shortcutPath}; icon=${exportedIconPath}`);
      }
    }

    if (updatedCount > 0) refreshWindowsShellIcons();
    return updatedCount > 0;
  } catch (error) {
    logIconSync(`theme=${themeId} windows sync failed: ${error.message}`);
    return false;
  }
}

function syncDesktopIcon(themeId) {
  if (process.platform === 'darwin') return syncMacDesktopIcon(themeId);
  if (process.platform === 'win32') return syncWindowsDesktopIcon(themeId);
  return false;
}

module.exports = {
  syncDesktopIcon,
  syncMacDesktopIcon,
  syncWindowsDesktopIcon,
  collectWindowsShortcuts,
  exportWindowsIcon
};
