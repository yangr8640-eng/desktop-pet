const { app, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const { store, runMigrations } = require('./src/store');
const { createPetWindow, createChatWindow, getPetWindow, getChatWindow, getChatVisible, showChatWindow, hideChatWindow } = require('./src/windows');
const { registerIpcHandlers } = require('./src/ipc-handlers');
const { setupAutoUpdater } = require('./src/updater');
const { getTray, setTray, destroyTray } = require('./src/tray');
const { syncDesktopIcon } = require('./src/desktop-icon');
const { WeChatBridge } = require('./src/wechat/wechat-bridge');
const { startServer } = require('./src/server');

// 创建全局桥接实例
const wechatBridge = new WeChatBridge();

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

registerIpcHandlers(wechatBridge);

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  const tray = new Tray(icon);
  setTray(tray);
  tray.setToolTip('桌面宠物');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开聊天', click: () => {
        if (!getChatVisible()) showChatWindow();
      }
    },
    { type: 'separator' },
    {
      label: '退出桌宠', click: () => {
        const petWindow = getPetWindow();
        if (petWindow) {
          const pos = petWindow.getPosition();
          store.set('petPosition', { x: pos[0], y: pos[1] });
        }
        destroyTray();
        app.exit(0);
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // Left click toggles chat
  tray.on('click', () => {
    if (getChatVisible()) {
      hideChatWindow();
    } else {
      showChatWindow();
    }
  });
}

function updateTrayIcon(theme) {
  const tray = getTray();
  if (!tray) return;
  try {
    const svgPath = path.join(__dirname, 'pet', theme.svgs.normal);
    const icon = nativeImage.createFromPath(svgPath).resize({ width: 16, height: 16 });
    if (!icon.isEmpty()) tray.setImage(icon);
  } catch { /* keep existing icon */ }
}

function registerGlobalShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (getChatVisible()) {
      hideChatWindow();
    } else {
      showChatWindow();
    }
  });
}

// Make tray updater available via IPC
const { ipcMain } = require('electron');
ipcMain.on('update-tray-icon', (_event, theme) => {
  updateTrayIcon(theme);
});

ipcMain.on('sync-desktop-icon', (_event, themeId) => {
  syncDesktopIcon(themeId);
});

app.whenReady().then(() => {
  runMigrations();
  createPetWindow();
  createChatWindow();
  createTray();
  registerGlobalShortcuts();
  setupAutoUpdater(app.isPackaged);
  syncDesktopIcon(store.get('activeTheme') || 'claude');

  // Start local HTTP API server (for CLI, scripts, external tools)
  startServer();

  // 如果已启用微信桥接，自动开始轮询
  if (store.get('wechatEnabled', false)) {
    wechatBridge.start();
  }

  app.setLoginItemSettings({
    openAtLogin: store.get('autoLaunch', true),
    path: app.getPath('exe')
  });
});

app.on('window-all-closed', () => {
  // Keep app running in background (tray)
});

app.on('activate', () => {
  if (getPetWindow() === null) createPetWindow();
});

app.on('before-quit', () => {
  const petWindow = getPetWindow();
  if (petWindow) {
    const pos = petWindow.getPosition();
    store.set('petPosition', { x: pos[0], y: pos[1] });
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyTray();
});
