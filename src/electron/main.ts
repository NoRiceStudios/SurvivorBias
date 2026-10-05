import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
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

/* ---------------- LAN: one opponent, newline-delimited JSON over TCP ---------------- */
let server: Server | null = null;
let peer: Socket | null = null;

function lanStatus(status: Record<string, unknown>) {
  win?.webContents.send('lan:status', status);
}

function attach(s: Socket) {
  peer = s;
  s.setNoDelay(true);
  s.setEncoding('utf8');
  let buf = '';
  s.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        win?.webContents.send('lan:message', JSON.parse(line));
      } catch {
        /* ignore malformed line */
      }
    }
  });
  s.on('close', () => {
    if (peer === s) peer = null;
    lanStatus({ connected: false });
  });
  s.on('error', (e) => lanStatus({ connected: false, error: e.message }));
  lanStatus({ connected: true, remote: s.remoteAddress });
}

function closeLan() {
  peer?.destroy();
  peer = null;
  server?.close();
  server = null;
}

function localAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
}

ipcMain.handle('lan:host', (_e, port: number) =>
  new Promise((resolve) => {
    closeLan();
    const srv = createServer((s) => {
      // One opponent at a time; a reconnecting player replaces a dead connection.
      if (peer && !peer.destroyed) {
        s.end(JSON.stringify({ t: 'reject', reason: 'This game already has an opponent connected.' }) + '\n');
        return;
      }
      attach(s);
    });
    srv.once('error', (e) => resolve({ ok: false, error: e.message }));
    srv.listen(port, () => {
      server = srv;
      resolve({ ok: true, addresses: localAddresses(), port });
    });
  }),
);

ipcMain.handle('lan:join', (_e, host: string, port: number) =>
  new Promise((resolve) => {
    closeLan();
    const s = connect({ host, port }, () => {
      attach(s);
      resolve({ ok: true });
    });
    s.once('error', (e) => resolve({ ok: false, error: e.message }));
  }),
);

ipcMain.on('lan:send', (_e, msg: unknown) => {
  if (peer && !peer.destroyed) peer.write(JSON.stringify(msg) + '\n');
});
ipcMain.on('lan:close', () => closeLan());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
