import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('sbNative', {
  saveGame: (slot: string, data: string) => ipcRenderer.invoke('save', slot, data),
  loadGame: (slot: string) => ipcRenderer.invoke('load', slot),
  listSaves: () => ipcRenderer.invoke('list'),
  deleteSave: (slot: string) => ipcRenderer.invoke('delete', slot),
  quit: () => ipcRenderer.send('quit'),
  toggleFullscreen: () => ipcRenderer.send('fullscreen'),
  lan: {
    host: (port: number) => ipcRenderer.invoke('lan:host', port),
    join: (host: string, port: number) => ipcRenderer.invoke('lan:join', host, port),
    send: (msg: unknown) => ipcRenderer.send('lan:send', msg),
    close: () => ipcRenderer.send('lan:close'),
    onMessage: (cb: (msg: unknown) => void) => {
      ipcRenderer.removeAllListeners('lan:message');
      ipcRenderer.on('lan:message', (_e, msg) => cb(msg));
    },
    onStatus: (cb: (status: unknown) => void) => {
      ipcRenderer.removeAllListeners('lan:status');
      ipcRenderer.on('lan:status', (_e, st) => cb(st));
    },
  },
});
