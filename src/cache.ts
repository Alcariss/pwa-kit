export type CacheEntry<T> = {
  items: T[];
  ageMs: number;
};

export type ItemCache<T> = {
  load(): CacheEntry<T> | null;
  save(items: T[]): void;
  clear(): void;
};

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type CacheOptions = {
  storage?: KeyValueStorage;
  now?: () => number;
};

type StoredEntry = {
  savedAt: number;
  items: unknown[];
};

function isStoredEntry(value: unknown): value is StoredEntry {
  return typeof value === 'object'
    && value !== null
    && typeof (value as StoredEntry).savedAt === 'number'
    && Array.isArray((value as StoredEntry).items);
}

/**
 * Last successful list, kept in localStorage so the app opens instantly and
 * works offline. Apps on one GitHub Pages origin share localStorage, so the
 * key must be unique per app, e.g. `notes:v1:items`.
 */
export function createCache<T>(key: string, options: CacheOptions = {}): ItemCache<T> {
  const storage = options.storage ?? globalThis.localStorage;
  const now = options.now ?? Date.now;

  return {
    load() {
      const raw = storage.getItem(key);
      if (raw === null) {
        return null;
      }

      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isStoredEntry(parsed)) {
          return null;
        }
        return {
          items: parsed.items as T[],
          ageMs: Math.max(0, now() - parsed.savedAt)
        };
      } catch {
        return null;
      }
    },

    save(items) {
      const entry: StoredEntry = { savedAt: now(), items };
      try {
        storage.setItem(key, JSON.stringify(entry));
      } catch (error) {
        // A full storage quota must not break the app; the data is still on the server.
        console.warn(`pwa-kit: could not cache ${key}`, error);
      }
    },

    clear() {
      storage.removeItem(key);
    }
  };
}
