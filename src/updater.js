const { autoUpdater } = require('electron-updater');
const { getChatWindow } = require('./windows');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater() {
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
  autoUpdater.downloadUpdate().catch((err) => {
    sendToChat('update-error', { message: err.message });
  });
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { setupAutoUpdater, downloadUpdate, quitAndInstall };
