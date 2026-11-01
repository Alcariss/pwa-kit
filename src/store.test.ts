import { describe, expect, it } from 'vitest';
import { ApiError, type Resource } from './api.js';
import { createCache, type KeyValueStorage } from './cache.js';
import { createStore } from './store.js';

type Note = { id: string; text: string };

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key)
  };
}

function failingResource(error: Error): Resource<Note, Note> {
  return {
    list: () => Promise.reject(error),
    create: () => Promise.reject(error),
    update: () => Promise.reject(error),
    remove: () => Promise.reject(error)
  };
}

const NOW = Date.parse('2026-11-01T12:00:00.000Z');

function cacheWithNotes(notes: Note[], savedAt: number) {
  const storage = memoryStorage();
  createCache<Note>('notes:v1:items', { storage, now: () => savedAt }).save(notes);
  return createCache<Note>('notes:v1:items', { storage, now: () => NOW });
}

describe('createCache', () => {
  it('returns saved items with their age', () => {
    const cache = cacheWithNotes([{ id: '1', text: 'a' }], NOW - 90_000);

    expect(cache.load()).toEqual({ items: [{ id: '1', text: 'a' }], ageMs: 90_000 });
  });

  it('treats unreadable stored data as no cache', () => {
    const storage = memoryStorage();
    storage.setItem('notes:v1:items', '{"items": "not a list"}');

    expect(createCache<Note>('notes:v1:items', { storage }).load()).toBeNull();
  });
});

describe('createStore', () => {
  it('serves cached items when the server is unreachable', async () => {
    const cache = cacheWithNotes([{ id: '1', text: 'offline copy' }], NOW - 120_000);
    const store = createStore({
      resource: failingResource(new ApiError('NETWORK_ERROR', 'Failed to fetch')),
      cache,
      now: () => NOW
    });

    const result = await store.refresh();

    expect(result.items).toEqual([{ id: '1', text: 'offline copy' }]);
    expect(result.diagnostics).toMatchObject({ source: 'cache', cacheAgeSeconds: 120, error: 'Failed to fetch' });
  });

  it('does not hide an expired session behind cached items', async () => {
    const cache = cacheWithNotes([{ id: '1', text: 'offline copy' }], NOW);
    const store = createStore({
      resource: failingResource(new ApiError('UNAUTHENTICATED', 'Sign in', 401)),
      cache
    });

    await expect(store.refresh()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
