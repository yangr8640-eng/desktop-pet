let tray = null;

function getTray() {
  return tray;
}

function setTray(t) {
  tray = t;
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { getTray, setTray, destroyTray };
