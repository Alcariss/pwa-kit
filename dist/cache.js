function isStoredEntry(value) {
    return typeof value === 'object'
        && value !== null
        && typeof value.savedAt === 'number'
        && Array.isArray(value.items);
}
/**
 * Last successful list, kept in localStorage so the app opens instantly and
 * works offline. Apps on one GitHub Pages origin share localStorage, so the
 * key must be unique per app, e.g. `notes:v1:items`.
 */
export function createCache(key, options = {}) {
    const storage = options.storage ?? globalThis.localStorage;
    const now = options.now ?? Date.now;
    return {
        load() {
            const raw = storage.getItem(key);
            if (raw === null) {
                return null;
            }
            try {
                const parsed = JSON.parse(raw);
                if (!isStoredEntry(parsed)) {
                    return null;
                }
                return {
                    items: parsed.items,
                    ageMs: Math.max(0, now() - parsed.savedAt)
                };
            }
            catch {
                return null;
            }
        },
        save(items) {
            const entry = { savedAt: now(), items };
            try {
                storage.setItem(key, JSON.stringify(entry));
            }
            catch (error) {
                // A full storage quota must not break the app; the data is still on the server.
                console.warn(`pwa-kit: could not cache ${key}`, error);
            }
        },
        clear() {
            storage.removeItem(key);
        }
    };
}
