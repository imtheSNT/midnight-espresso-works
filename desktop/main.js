// Midnight Espresso Works — desktop shell.
//
// This file does one job: open a window and show index.html in it. The game is
// unchanged and knows nothing about Electron, so it stays the same single file
// that runs in a browser. If this shell ever grows game logic, something has
// gone wrong.

const { app, BrowserWindow, shell, screen } = require('electron');
const path = require('path');

// Where the kit lives depends on whether this is a packaged build. Running from
// source, it is one level up in the repo. Packaged, main.js sits inside app.asar
// and the kit is copied in as a resource, so __dirname would point into the
// archive and miss it.
const KIT = () => app.isPackaged
  ? path.join(process.resourcesPath, 'index.html')
  : path.join(__dirname, '..', 'index.html');

// One instance only: two windows would mean two copies of a save fighting over
// the same storage, and the loser's progress would quietly vanish.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  const createWindow = () => {
    // Landscape-first, like the kit itself. Start large but inside the display.
    const area = screen.getPrimaryDisplay().workAreaSize;
    const width = Math.min(1600, Math.max(1024, Math.round(area.width * 0.85)));
    const height = Math.min(1000, Math.max(640, Math.round(area.height * 0.85)));

    win = new BrowserWindow({
      width,
      height,
      minWidth: 900,
      minHeight: 560,
      backgroundColor: '#e6ebed',   // the kit's own paper colour, so no white flash
      show: false,
      title: 'Midnight Espresso Works',
      autoHideMenuBar: true,        // no File/Edit chrome over a model kit
      webPreferences: {
        // The kit is local and self-contained. It needs no Node, so don't give
        // it any: nothing in the page should be able to reach the filesystem.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false, // keep the machine turning if focus slips
      },
    });

    win.once('ready-to-show', () => win.show());
    win.loadFile(KIT());

    // Anything that tries to open a new window or navigate away goes to the
    // real browser instead. A kit builder should never become a browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (url !== win.webContents.getURL()) {
        event.preventDefault();
        if (/^https?:/.test(url)) shell.openExternal(url);
      }
    });

    win.on('closed', () => { win = null; });
  };

  app.whenReady().then(() => {
    createWindow();
    // macOS keeps the app alive with no windows; clicking the dock reopens one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
