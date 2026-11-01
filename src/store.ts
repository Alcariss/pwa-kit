import { ApiError, type Resource } from './api.js';
import type { ItemCache } from './cache.js';
import { AUTH_ERROR_CODES, type Diagnostics } from './contract.js';

export type StoreResult<T> = {
  items: T[];
  diagnostics: Diagnostics;
};

export type Store<T, TInput> = {
  loadCached(): { items: T[]; ageMs: number } | null;
  /** Loads from the server; falls back to the cache when the server is unreachable. */
  refresh(): Promise<StoreResult<T>>;
  create(input: TInput): Promise<StoreResult<T>>;
  update(id: string, input: TInput): Promise<StoreResult<T>>;
  remove(id: string): Promise<StoreResult<T>>;
  /** Forgets cached data, e.g. on sign-out. */
  clear(): void;
};

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && AUTH_ERROR_CODES.includes(error.code);
}

export function createStore<T, TInput>(deps: {
  resource: Resource<T, TInput>;
  cache: ItemCache<T>;
  now?: () => number;
}): Store<T, TInput> {
  const { resource, cache } = deps;
  const now = deps.now ?? Date.now;

  async function refresh(): Promise<StoreResult<T>> {
    try {
      const result = await resource.list();
      cache.save(result.items);
      return result;
    } catch (error) {
      const cached = cache.load();
      if (cached === null || isAuthError(error)) {
        throw error;
      }

      return {
        items: cached.items,
        diagnostics: {
          endpoint: '',
          source: 'cache',
          fetchedAt: new Date(now() - cached.ageMs).toISOString(),
          cacheAgeSeconds: Math.floor(cached.ageMs / 1000),
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  return {
    loadCached: () => cache.load(),
    refresh,
    async create(input) {
      await resource.create(input);
      return refresh();
    },
    async update(id, input) {
      await resource.update(id, input);
      return refresh();
    },
    async remove(id) {
      await resource.remove(id);
      return refresh();
    },
    clear: () => cache.clear()
  };
}
