/**
 * Defensive localStorage helpers.
 *
 * localStorage can throw (Safari private mode, quota exceeded, disabled
 * storage) and stored JSON can be corrupted. Neither should ever brick a
 * component constructor, so all failures degrade to the provided fallback.
 */

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
