/** Save storage: Electron file system when available, browser storage otherwise. */
export interface NativeApi {
  saveGame(slot: string, data: string): Promise<void>;
  loadGame(slot: string): Promise<string | null>;
  listSaves(): Promise<{ slot: string; modified: number }[]>;
  deleteSave(slot: string): Promise<void>;
  quit(): void;
  toggleFullscreen(): void;
}

declare global {
  interface Window {
    sbNative?: NativeApi;
  }
}

const PREFIX = 'survivorbias.save.';

export const storage = {
  async save(slot: string, data: string) {
    if (window.sbNative) return window.sbNative.saveGame(slot, data);
    try {
      localStorage.setItem(PREFIX + slot, data);
      localStorage.setItem(PREFIX + slot + '.t', String(Date.now()));
    } catch {
      /* storage unavailable */
    }
  },
  async load(slot: string): Promise<string | null> {
    if (window.sbNative) return window.sbNative.loadGame(slot);
    try {
      return localStorage.getItem(PREFIX + slot);
    } catch {
      return null;
    }
  },
  async list(): Promise<{ slot: string; modified: number }[]> {
    if (window.sbNative) return window.sbNative.listSaves();
    const out: { slot: string; modified: number }[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith(PREFIX) && !k.endsWith('.t')) {
          const slot = k.slice(PREFIX.length);
          out.push({ slot, modified: Number(localStorage.getItem(k + '.t') ?? 0) });
        }
      }
    } catch {
      /* ignore */
    }
    return out.sort((a, b) => b.modified - a.modified);
  },
  async remove(slot: string) {
    if (window.sbNative) return window.sbNative.deleteSave(slot);
    try {
      localStorage.removeItem(PREFIX + slot);
      localStorage.removeItem(PREFIX + slot + '.t');
    } catch {
      /* ignore */
    }
  },
};
