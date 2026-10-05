import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const savesDir = () => {
  const dir = join(app.getPath('userData'), 'saves');
  mkdirSync(dir, { recursive: true });
  return dir;
};
// Slots are plain names; never let one escape the saves folder.
const slotPath = (slot: string) => join(savesDir(), `${slot.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1f231d',
    title: 'Survivor Bias',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenu(null);
  void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('save', (_e, slot: string, data: string) => writeFileSync(slotPath(slot), data, 'utf8'));
ipcMain.handle('load', (_e, slot: string) => {
  try {
    return readFileSync(slotPath(slot), 'utf8');
  } catch {
    return null;
  }
});
ipcMain.handle('list', () =>
  readdirSync(savesDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ slot: f.slice(0, -5), modified: statSync(join(savesDir(), f)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified),
);
ipcMain.handle('delete', (_e, slot: string) => {
  try {
    unlinkSync(slotPath(slot));
  } catch {
    /* already gone */
  }
});
ipcMain.on('quit', () => app.quit());
ipcMain.on('fullscreen', () => win?.setFullScreen(!win.isFullScreen()));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
