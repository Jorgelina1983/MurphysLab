/** Local storage that never throws: the page must work when storage is unavailable. */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as T;
    // A list is returned as stored; an object is laid over the fallback so new fields get their defaults.
    return Array.isArray(fallback) ? (Array.isArray(stored) ? stored : fallback) : { ...fallback, ...stored };
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: settings simply are not remembered.
  }
}
