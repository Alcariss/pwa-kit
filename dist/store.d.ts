import { type Resource } from './api.js';
import type { ItemCache } from './cache.js';
import { type Diagnostics } from './contract.js';
export type StoreResult<T> = {
    items: T[];
    diagnostics: Diagnostics;
};
export type Store<T, TInput> = {
    loadCached(): {
        items: T[];
        ageMs: number;
    } | null;
    /** Loads from the server; falls back to the cache when the server is unreachable. */
    refresh(): Promise<StoreResult<T>>;
    create(input: TInput): Promise<StoreResult<T>>;
    update(id: string, input: TInput): Promise<StoreResult<T>>;
    remove(id: string): Promise<StoreResult<T>>;
    /** Forgets cached data, e.g. on sign-out. */
    clear(): void;
};
export declare function createStore<T, TInput>(deps: {
    resource: Resource<T, TInput>;
    cache: ItemCache<T>;
    now?: () => number;
}): Store<T, TInput>;
