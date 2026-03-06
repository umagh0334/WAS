const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

let mainWindow;
let savedBounds = null;
const allowedReadPaths = new Set();
const allowedWritePaths = new Set();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1200,
    minWidth: 1400,
    maxWidth: 1400,
    minHeight: 750,
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#080808',
    icon: path.join(__dirname, '..', 'icon.png'),
    frame: false,
    titleBarStyle: 'hidden'
  });

  // Load from Vite dev server or built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (process.env.ELECTRON_DEBUG) mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Block navigation away from the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
      return;
    }
    event.preventDefault();
  });

  // Block new window creation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Clear reference when window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Window control handlers
  ipcMain.handle('window-minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.handle('window-maximize', () => {
    if (savedBounds) {
      mainWindow.setBounds(savedBounds);
      savedBounds = null;
    } else {
      savedBounds = mainWindow.getBounds();
      const { workArea } = screen.getPrimaryDisplay();
      mainWindow.setBounds({
        x: Math.round((workArea.width - savedBounds.width) / 2) + workArea.x,
        y: workArea.y,
        width: savedBounds.width,
        height: workArea.height
      });
    }
  });

  ipcMain.handle('window-close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window-resize', (event, { width, height }) => {
    const [currentWidth, currentHeight] = mainWindow.getSize();
    const minWidth = 800, maxWidth = 2560;
    const minHeight = 600, maxHeight = 1440;

    const newWidth = Math.min(Math.max(width || currentWidth, minWidth), maxWidth);
    const newHeight = Math.min(Math.max(height || currentHeight, minHeight), maxHeight);
    mainWindow.setSize(newWidth, newHeight, true);
  });

  // File selection dialog
  ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'mp4'] }]
    });
    const selected = result.filePaths[0] || null;
    if (selected) allowedReadPaths.add(path.resolve(selected));
    return selected;
  });

  // Save file dialog
  ipcMain.handle('save-file', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'WAV File', extensions: ['wav'] }]
    });
    const selected = result.filePath || null;
    if (selected) allowedWritePaths.add(path.resolve(selected));
    return selected;
  });

  // Read file data - returns Uint8Array
  ipcMain.handle('read-file-data', async (event, filePath) => {
    if (!filePath) {
      throw new Error('No file path provided');
    }

    // Normalize and resolve path
    const normalized = path.normalize(filePath);
    const resolved = path.resolve(normalized);

    const ALLOWED_AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.mp4'];
    const ext = path.extname(resolved).toLowerCase();
    if (!ALLOWED_AUDIO_EXTS.includes(ext)) {
      throw new Error('Unsupported file type');
    }

    if (!allowedReadPaths.has(resolved)) {
      throw new Error('Access denied: file was not selected via dialog');
    }

    if (!fs.existsSync(resolved)) {
      throw new Error('File not found');
    }

    const stat = fs.statSync(resolved);
    if (stat.size > 1 * 1024 * 1024 * 1024) {
      throw new Error('File too large (max 1 GB)');
    }

    const buffer = fs.readFileSync(resolved);
    return new Uint8Array(buffer);
  });

  // Write file data - receives Uint8Array from renderer
  ipcMain.handle('write-file-data', async (event, { filePath, data }) => {
    if (!filePath) {
      throw new Error('No output path specified');
    }
    if (!data || data.length === 0) {
      throw new Error('No data to write');
    }

    // Normalize path
    const normalized = path.normalize(filePath);
    const resolved = path.resolve(normalized);

    // Ensure it's a .wav file
    if (!resolved.toLowerCase().endsWith('.wav')) {
      throw new Error('Output must be a WAV file');
    }

    if (!allowedWritePaths.has(resolved)) {
      throw new Error('Access denied: path was not selected via dialog');
    }

    // Handle both Uint8Array and regular arrays (IPC may serialize differently)
    let buffer;
    if (data instanceof Uint8Array) {
      buffer = Buffer.from(data);
    } else if (ArrayBuffer.isView(data)) {
      buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    } else if (Array.isArray(data)) {
      buffer = Buffer.from(new Uint8Array(data));
    } else {
      throw new Error('Invalid data format');
    }

    fs.writeFileSync(resolved, buffer);
    return { success: true };
  });

  // Send progress updates to renderer
  ipcMain.handle('send-progress', (event, progress) => {
    mainWindow.webContents.send('processing-progress', progress);
  });

  // Auto-update
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  function sendUpdateStatus(type, data = {}) {
    if (mainWindow) mainWindow.webContents.send('update-status', { type, ...data });
  }

  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => sendUpdateStatus('available', { version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('up-to-date'));
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus('downloading', { percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', () => sendUpdateStatus('ready'));
  autoUpdater.on('error', (err) => sendUpdateStatus('error', { message: err.message }));

  ipcMain.handle('check-for-update', async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      sendUpdateStatus('error', { message: err.message });
    }
  });

  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      sendUpdateStatus('error', { message: err.message });
    }
  });

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });

  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  // Remove all IPC handlers to prevent leaks
  ipcMain.removeHandler('window-minimize');
  ipcMain.removeHandler('window-maximize');
  ipcMain.removeHandler('window-close');
  ipcMain.removeHandler('window-resize');
  ipcMain.removeHandler('select-file');
  ipcMain.removeHandler('save-file');
  ipcMain.removeHandler('read-file-data');
  ipcMain.removeHandler('write-file-data');
  ipcMain.removeHandler('send-progress');

  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
