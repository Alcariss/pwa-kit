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
/**
 * Last successful list, kept in localStorage so the app opens instantly and
 * works offline. Apps on one GitHub Pages origin share localStorage, so the
 * key must be unique per app, e.g. `notes:v1:items`.
 */
export declare function createCache<T>(key: string, options?: CacheOptions): ItemCache<T>;
