import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('sbNative', {
  saveGame: (slot: string, data: string) => ipcRenderer.invoke('save', slot, data),
  loadGame: (slot: string) => ipcRenderer.invoke('load', slot),
  listSaves: () => ipcRenderer.invoke('list'),
  deleteSave: (slot: string) => ipcRenderer.invoke('delete', slot),
  quit: () => ipcRenderer.send('quit'),
  toggleFullscreen: () => ipcRenderer.send('fullscreen'),
});
