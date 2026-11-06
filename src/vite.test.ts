import { afterEach, describe, expect, it } from 'vitest';
import { definePwaApp, normalizeBase } from './vite.js';

describe('normalizeBase', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/', '/'],
    ['notes', '/notes/'],
    ['/notes', '/notes/'],
    ['/notes/', '/notes/']
  ])('%s -> %s', (input, expected) => {
    expect(normalizeBase(input)).toBe(expected);
  });
});

describe('definePwaApp', () => {
  afterEach(() => {
    delete process.env.VITE_BASE_PATH;
    delete process.env.VITE_APP_VERSION;
  });

  it('takes the base path and version from the environment', () => {
    process.env.VITE_BASE_PATH = 'notes';
    process.env.VITE_APP_VERSION = 'abc1234';
    const configure = definePwaApp({
      name: 'Notes',
      description: 'Test',
      lang: 'en',
      themeColor: '#000000',
      backgroundColor: '#ffffff'
    });

    const config = configure({ mode: 'production', command: 'build' });

    expect(config.base).toBe('/notes/');
    expect(config.define).toEqual({ __APP_VERSION__: '"abc1234"' });
  });

  it('emits the push handlers for the service worker', () => {
    const config = definePwaApp({
      name: 'Notes',
      description: 'Test',
      lang: 'en',
      themeColor: '#000000',
      backgroundColor: '#ffffff'
    })({ mode: 'production', command: 'build' });

    const plugins = (config.plugins ?? []).flat() as { name?: string }[];
    expect(plugins.map((plugin) => plugin.name)).toContain('pwa-kit:push-sw');
  });
});
