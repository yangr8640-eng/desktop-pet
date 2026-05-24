const { getChatWindow } = require('./windows');

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

function setupAutoUpdater() {
  const autoUpdater = getAutoUpdater();

  autoUpdater.on('checking-for-update', () => {
    sendToChat('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    sendToChat('update-available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    sendToChat('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToChat('update-download-progress', {
      percent: Math.round(progress.percent)
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToChat('update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    sendToChat('update-error', { message: err.message });
  });

  // Check for updates 5 seconds after startup
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Dev mode or no network — silently skip
    });
  }, 5000);
}

function sendToChat(channel, data = {}) {
  const chatWindow = getChatWindow();
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send(channel, data);
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

module.exports = { setupAutoUpdater, downloadUpdate, quitAndInstall };
