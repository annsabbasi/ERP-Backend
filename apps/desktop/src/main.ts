import { app, BrowserWindow, ipcMain, Menu, shell, type WebContents } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeviceInfo } from './device-info';

// Security baseline: §10.12.3.

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';
const WINDOW_TITLE = 'ERP System';

// Packaged builds load the web app shipped as an extra resource (electron-builder.yml).
const appUrl = isDev
  ? DEV_URL
  : pathToFileURL(join(process.resourcesPath, 'web', 'index.html')).href;

/** True only for the app's own origin (or its files, when packaged). */
function isAppUrl(url: string): boolean {
  try {
    const target = new URL(url);
    const home = new URL(appUrl);
    return home.protocol === 'file:' ? target.protocol === 'file:' : target.origin === home.origin;
  } catch {
    return false;
  }
}

function openInSystemBrowser(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function harden(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openInSystemBrowser(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    openInSystemBrowser(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  if (isDev) {
    contents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') contents.toggleDevTools();
    });
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: WINDOW_TITLE,
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: isDev,
    },
  });
  // Keep the window title fixed, whatever the page sets.
  window.on('page-title-updated', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  void window.loadURL(appUrl);
}

ipcMain.handle('device:info', (event): DeviceInfo => {
  if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) {
    throw new Error('device.info is only available to the app');
  }
  return { platform: process.platform, arch: process.arch, appVersion: app.getVersion() };
});

app.on('web-contents-created', (_event, contents) => harden(contents));

void app.whenReady().then(() => {
  // No default menu on Windows and Linux; macOS keeps its app menu.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
