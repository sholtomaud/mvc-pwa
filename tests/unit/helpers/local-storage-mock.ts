import { vi } from 'vitest';

/**
 * Installs a fully functional in-memory localStorage on globalThis.
 *
 * Tests must never rely on the host runtime's localStorage: Node may expose
 * its own experimental Web Storage global (e.g. when `--localstorage-file`
 * is set without a valid path) which shadows jsdom's with a broken partial
 * object — `localStorage.clear is not a function`. vi.stubGlobal overrides
 * whatever is there, getter or value, with this deterministic mock.
 */
export function installLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    }
  });
  return data;
}
