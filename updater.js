const { app } = require('electron');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { getChatWindow } = require('./windows');

// ─────────────────────────────────────────────────────────────
// 自定义 macOS 更新器
//
// 背景：macOS 上 electron-updater 走原生 Squirrel.Mac，它会用
// 当前运行 app 的 designated requirement（对 adhoc/未签名 app 即
// cdhash，每次构建都变）去验证新下载的 app —— 因此未签名或 adhoc
// 签名的 app 永远无法通过 Squirrel.Mac 的自动更新。
//
// 解法：macOS 上完全绕开 Squirrel.Mac，由应用自己：
//   检查 GitHub Release → 下载 zip → 校验 sha512 → 解压替换 .app → 重启
// （与 Windows 端跳过签名验证的思路一致。）
//
// Windows 端仍保留 electron-updater（publisherName 为空时本就跳过
// 签名验证，工作正常）。
// ─────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'yangr8640-eng';
const GITHUB_REPO = 'desktop-pet';
const RELEASE_BASE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download`;

let _isPackaged = false;
let _manualCheck = false;
let _downloading = false;

// ─── 工具函数 ────────────────────────────────────────────────

// 通用请求（跟随重定向），返回 body
function requestWithRedirect(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'desktop-pet-updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        const next = new URL(res.headers.location, url).toString();
        return resolve(requestWithRedirect(next, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
  });
}

// 下载文件到磁盘，带进度回调 (receivedBytes, totalBytes)
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const perform = (currentUrl, redirectsLeft) => {
      const mod = currentUrl.startsWith('https:') ? https : http;
      const req = mod.get(currentUrl, { headers: { 'User-Agent': 'desktop-pet-updater' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          const next = new URL(res.headers.location, currentUrl).toString();
          return perform(next, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
        }
        const file = fs.createWriteStream(destPath);
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total > 0) onProgress(received, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(destPath)));
        file.on('error', (err) => { res.unpipe(file); reject(err); });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(60000, () => req.destroy(new Error('Download timeout')));
    };
    perform(url, 5);
  });
}

// 简单的 semver 比较：a > b 返回 1，a < b 返回 -1，相等返回 0
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// 解析 latest-mac.yml —— 提取 version / zip 文件名 / sha512
function parseLatestMacYml(yml) {
  const versionMatch = yml.match(/^version:\s*(.+)$/m);
  const pathMatch = yml.match(/^path:\s*(.+)$/m);
  if (!versionMatch || !pathMatch) throw new Error('无法解析 latest-mac.yml');

  const version = versionMatch[1].trim();
  const zipName = pathMatch[1].trim();

  // 取 zip 对应文件的 sha512：先按 files 块切分，找到 url 匹配 zip 的那段
  let sha512 = null;
  const filesBlock = yml.match(/^files:\s*\n([\s\S]*?)(?=^path:)/m);
  if (filesBlock) {
    const entries = filesBlock[1].split(/\n\s*-\s*/);
    for (const entry of entries) {
      if (entry.includes(`url: ${zipName}`)) {
        const s = entry.match(/sha512:\s*(.+)$/m);
        if (s) sha512 = s[1].trim();
        break;
      }
    }
  }
  if (!sha512) {
    // 回退：直接取 path 之后的 sha512
    const s = yml.match(/^path:[\s\S]*?^sha512:\s*(.+)$/m);
    if (s) sha512 = s[1].trim();
  }
  if (!sha512) throw new Error('latest-mac.yml 中找不到 sha512');

  return { version, zipName, sha512 };
}

// 查找当前 .app 的真实路径（处理 App Translocation）
function getAppPath() {
  const exePath = app.getPath('exe'); // .../DesktopPet.app/Contents/MacOS/DesktopPet
  let appPath = path.dirname(path.dirname(path.dirname(exePath))); // .../DesktopPet.app
  // App Translocation：从 /var/folders/.../AppTranslocation/ 运行的临时副本
  if (appPath.includes('AppTranslocation')) {
    const candidates = [
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Downloads'),
      '/Applications',
    ];
    for (const dir of candidates) {
      const guess = path.join(dir, path.basename(appPath));
      if (fs.existsSync(guess)) return guess;
    }
  }
  return appPath;
}

// 启动外部脚本完成替换 + 重启（等旧进程退出后）
function spawnInstallerScript(appPath, newAppPath, oldPid) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-pet-install-'));
  const scriptPath = path.join(tmpDir, 'install.sh');
  const script = `#!/bin/bash
OLD_PID="$1"
APP_PATH="$2"
NEW_APP="$3"

# 等待旧进程完全退出（最多 30s）
for i in $(seq 1 30); do
  if ! kill -0 "$OLD_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done
sleep 1

# 替换 app
rm -rf "$APP_PATH"
mv "$NEW_APP" "$APP_PATH"

# 移除隔离标记，避免 Gatekeeper 拦截
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null

# 启动新版本
open "$APP_PATH"
`;
  fs.writeFileSync(scriptPath, script, 'utf-8');
  fs.chmodSync(scriptPath, 0o755);
  spawn(scriptPath, [String(oldPid), appPath, newAppPath], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

// ─── 前端事件 ───────────────────────────────────────────────

function sendToChat(channel, data = {}) {
  try {
    const chatWindow = getChatWindow();
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send(channel, data);
    }
  } catch {
    // 窗口可能还没就绪
  }
}

// ─── 检查更新（macOS 自定义）────────────────────────────────

async function checkForUpdatesMac() {
  if (!_isPackaged) return;
  try {
    sendToChat('update-checking');
    const ymlBuffer = await requestWithRedirect(`${RELEASE_BASE}/latest-mac.yml`);
    const info = parseLatestMacYml(ymlBuffer.toString('utf-8'));

    const current = app.getVersion();
    if (compareVersions(info.version, current) <= 0) {
      if (_manualCheck) sendToChat('update-not-available');
      return;
    }
    sendToChat('update-available', { version: info.version, _macCustom: true });
  } catch (err) {
    console.warn('[updater] check failed:', err.message);
    if (_manualCheck) sendToChat('update-error', { message: err.message });
  }
}

// ─── 下载更新（macOS 自定义）────────────────────────────────

async function downloadUpdateMac() {
  if (_downloading) return;
  try {
    _downloading = true;
    const ymlBuffer = await requestWithRedirect(`${RELEASE_BASE}/latest-mac.yml`);
    const info = parseLatestMacYml(ymlBuffer.toString('utf-8'));
    const current = app.getVersion();
    if (compareVersions(info.version, current) <= 0) {
      sendToChat('update-not-available');
      return;
    }

    const zipUrl = `${RELEASE_BASE}/${encodeURIComponent(info.zipName)}`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-pet-update-'));
    const zipPath = path.join(tmpDir, 'update.zip');

    await downloadFile(zipUrl, zipPath, (received, total) => {
      sendToChat('update-download-progress', {
        percent: Math.round((received / total) * 100),
      });
    });

    // 校验 sha512
    const hash = crypto.createHash('sha512').update(fs.readFileSync(zipPath)).digest('base64');
    if (hash !== info.sha512) {
      sendToChat('update-error', { message: '下载文件校验失败，请重试' });
      return;
    }

    // 解压
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    execFileSync('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir]);
    const newAppPath = path.join(extractDir, 'DesktopPet.app');
    if (!fs.existsSync(newAppPath)) {
      sendToChat('update-error', { message: '更新包内容异常，未找到 DesktopPet.app' });
      return;
    }

    sendToChat('update-downloaded', { version: info.version, _macCustom: true });
    _pendingInstall = { appPath: getAppPath(), newAppPath };
  } catch (err) {
    console.warn('[updater] download failed:', err.message);
    sendToChat('update-error', { message: err.message });
  } finally {
    _downloading = false;
  }
}

let _pendingInstall = null;

function quitAndInstallMac() {
  if (!_pendingInstall) {
    sendToChat('update-error', { message: '没有待安装的更新' });
    return;
  }
  const { appPath, newAppPath } = _pendingInstall;
  const oldPid = process.pid;
  spawnInstallerScript(appPath, newAppPath, oldPid);
  app.exit(0);
}

// ─── Windows / Linux 走 electron-updater ────────────────────

let _autoUpdater = null;
function getAutoUpdater() {
  if (!_autoUpdater) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    _autoUpdater = autoUpdater;
  }
  return _autoUpdater;
}

let _autoCheckDone = false;

function setupElectronUpdater(isPackaged) {
  const autoUpdater = getAutoUpdater();

  autoUpdater.on('checking-for-update', () => {
    if (!isPackaged && !_manualCheck) return;
    sendToChat('update-checking');
  });
  autoUpdater.on('update-available', (info) => {
    _manualCheck = false;
    sendToChat('update-available', { version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    const wasManual = _manualCheck;
    _manualCheck = false;
    if (wasManual) sendToChat('update-not-available');
  });
  autoUpdater.on('download-progress', (progress) => {
    _manualCheck = false;
    sendToChat('update-download-progress', { percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    _manualCheck = false;
    sendToChat('update-downloaded', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    _manualCheck = false;
    if (!isPackaged || !_autoCheckDone) {
      console.warn('[auto-updater]', err.message);
      return;
    }
    sendToChat('update-error', { message: err.message });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().then(() => { _autoCheckDone = true; }).catch(() => { _autoCheckDone = true; });
  }, 5000);
}

async function checkForUpdatesNowElectron() {
  try {
    _manualCheck = true;
    const autoUpdater = getAutoUpdater();
    sendToChat('update-checking');
    await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 15000)
      ),
    ]);
  } catch (err) {
    _manualCheck = false;
    if (err.message === 'TIMEOUT') {
      sendToChat('update-not-available');
    } else {
      sendToChat('update-error', { message: err.message });
    }
  }
}

// ─── 对外接口 ───────────────────────────────────────────────

function setupAutoUpdater(isPackaged) {
  _isPackaged = !!isPackaged;
  if (process.platform === 'darwin') {
    // macOS：自定义更新，绕开 Squirrel.Mac
    if (_isPackaged) {
      setTimeout(() => checkForUpdatesMac(), 5000);
    }
  } else {
    // Windows：electron-updater（publisherName 为空时跳过签名验证，正常）
    setupElectronUpdater(isPackaged);
  }
}

async function checkForUpdatesNow() {
  if (process.platform === 'darwin') {
    _manualCheck = true;
    await checkForUpdatesMac();
  } else {
    await checkForUpdatesNowElectron();
  }
}

async function downloadUpdate() {
  if (process.platform === 'darwin') {
    await downloadUpdateMac();
  } else {
    getAutoUpdater().downloadUpdate().catch((err) => {
      sendToChat('update-error', { message: err.message });
    });
  }
}

function quitAndInstall() {
  if (process.platform === 'darwin') {
    quitAndInstallMac();
  } else {
    getAutoUpdater().quitAndInstall();
  }
}

module.exports = { setupAutoUpdater, downloadUpdate, quitAndInstall, checkForUpdatesNow };
