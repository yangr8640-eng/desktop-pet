const { getChatWindow } = require('./windows');

const isDev = !require('electron').app.isPackaged;
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

// Track whether the current check was user-initiated (manual)
let _manualCheck = false;

function setupAutoUpdater() {
  const autoUpdater = getAutoUpdater();

  autoUpdater.on('checking-for-update', () => {
    if (isDev && !_manualCheck) return;
    sendToChat('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    _manualCheck = false;
    sendToChat('update-available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    const wasManual = _manualCheck;
    _manualCheck = false;
    // Only forward to the renderer if the user manually triggered the check
    if (wasManual) {
      sendToChat('update-not-available');
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    _manualCheck = false;
    sendToChat('update-download-progress', {
      percent: Math.round(progress.percent)
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    _manualCheck = false;
    sendToChat('update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    _manualCheck = false;
    if (isDev) {
      console.warn('[auto-updater]', err.message);
    }
    sendToChat('update-error', { message: err.message });
  });

  // Check for updates shortly after startup (silent on dev / no-release)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Dev mode or no network — silently skip
    });
  }, 5000);
}

/**
 * Manually trigger an update check. The user will see feedback even when
 * no update is available (unlike the silent startup check).
 */
async function checkForUpdatesNow() {
  try {
    _manualCheck = true;
    const autoUpdater = getAutoUpdater();
    sendToChat('update-checking');

    // 15-second timeout to prevent the banner from hanging forever
    // when no GitHub release exists or the network is unreachable
    await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 15000)
      )
    ]);
  } catch (err) {
    _manualCheck = false;
    if (err.message === 'TIMEOUT') {
      // No release published yet or network issue — friendly dismiss
      sendToChat('update-not-available');
    } else {
      sendToChat('update-error', { message: err.message });
    }
  }
}

function sendToChat(channel, data = {}) {
  try {
    const chatWindow = getChatWindow();
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send(channel, data);
    }
  } catch {
    // Window might not be ready yet
  }
}

function downloadUpdate() {
  getAutoUpdater().downloadUpdate().catch((err) => {
    sendToChat('update-error', { message: err.message });
  });
}

function quitAndInstall() {
  getAutoUpdater().quitAndInstall();
}

module.exports = { setupAutoUpdater, downloadUpdate, quitAndInstall, checkForUpdatesNow };
