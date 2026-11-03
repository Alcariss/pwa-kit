import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, ME, sessionFor, setup } from './harness.js';

function fakeMedia(files: Record<string, { bytes: Uint8Array; contentType: string }>): KVNamespace {
  return {
    getWithMetadata: async (key: string) => {
      const file = files[key];
      return file
        ? { value: file.bytes.buffer, metadata: { contentType: file.contentType }, cacheStatus: null }
        : { value: null, metadata: null, cacheStatus: null };
    }
  } as unknown as KVNamespace;
}

const GIF = { bytes: new Uint8Array([71, 73, 70, 56, 57, 97]), contentType: 'image/gif' };

async function asMe(app = 'reps'): Promise<RequestInit> {
  return { headers: { Authorization: `Bearer ${await sessionFor(ME, app)}`, Origin: APP_ORIGIN } };
}

describe('media', () => {
  it('serves a file of the signed-in app with CORS and a private cache', async () => {
    const { send } = setup({ MEDIA: fakeMedia({ 'reps/squat.gif': GIF }) });

    const response = await send('/reps?action=media&name=squat.gif', await asMe());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/gif');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=604800');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP_ORIGIN);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(GIF.bytes);
  });

  it('requires a session', async () => {
    const { send } = setup({ MEDIA: fakeMedia({ 'reps/squat.gif': GIF }) });

    const response = await send('/reps?action=media&name=squat.gif', { headers: { Origin: APP_ORIGIN } });

    expect(response.status).toBe(401);
  });

  it('does not serve another app\'s files', async () => {
    const { send } = setup({ MEDIA: fakeMedia({ 'reps/squat.gif': GIF }) });

    const response = await send('/notes?action=media&name=squat.gif', await asMe('notes'));

    expect(response.status).toBe(404);
  });

  it('rejects names that are not plain file names', async () => {
    const { send } = setup({ MEDIA: fakeMedia({}) });

    const response = await send('/reps?action=media&name=..%2Fnotes%2Fx.gif', await asMe());

    expect(response.status).toBe(400);
  });
});
