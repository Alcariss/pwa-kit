import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, createResource } from './api.js';
import type { ApiConfig } from './config.js';

const PRIMARY = 'https://api.example/notes';
const FALLBACK = 'https://script.google.com/macros/s/FALLBACK/exec';

function config(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    primaryUrl: PRIMARY,
    fallbackUrl: null,
    token: null,
    timeoutMs: 5_000,
    authProviders: [],
    ...overrides
  };
}

function ok(data: unknown, schemaVersion = 1): Response {
  return new Response(JSON.stringify({
    success: true,
    data,
    meta: { apiVersion: '2.1.0', schemaVersion, source: 'primary', fetchedAt: '2026-11-01T10:00:00.000Z' }
  }));
}

function failure(status: number, errorCode: string, message: string): Response {
  return new Response(JSON.stringify({
    success: false,
    data: null,
    meta: { apiVersion: '2.1.0', schemaVersion: 1, source: 'primary', fetchedAt: '' },
    errorCode,
    message
  }), { status });
}

function requestedUrl(fetchMock: ReturnType<typeof vi.fn>, call = 0): URL {
  return new URL(String(fetchMock.mock.calls[call]?.[0]));
}

function requestedHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call]?.[1] as RequestInit).headers as Record<string, string>;
}

const mapNote = (row: unknown) => row as { id: string; text: string };

describe('createApiClient', () => {
  it('sends the session as a bearer header, not in the URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok([]));
    const client = createApiClient(config(), { fetch: fetchMock, getSessionToken: () => 'session-jwt' });

    await client.request('fetch');

    expect(requestedHeaders(fetchMock).Authorization).toBe('Bearer session-jwt');
    expect(requestedUrl(fetchMock).search).toBe('?action=fetch');
  });

  it('sends the legacy token as a query parameter and no Authorization header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok([]));
    const client = createApiClient(config({ token: 'legacy' }), { fetch: fetchMock });

    await client.request('fetch');

    expect(requestedUrl(fetchMock).searchParams.get('token')).toBe('legacy');
    expect(requestedHeaders(fetchMock).Authorization).toBeUndefined();
  });

  it('raises the error code the backend put in a non-2xx payload', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(failure(401, 'UNAUTHENTICATED', 'Sign in'));
    const client = createApiClient(config(), { fetch: fetchMock });

    const error = await client.request('fetch').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'UNAUTHENTICATED', status: 401, message: 'Sign in' });
  });

  it('raises INVALID_RESPONSE for a 200 that is not an API payload', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>'));
    const client = createApiClient(config(), { fetch: fetchMock });

    await expect(client.request('fetch')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reports an aborted request as TIMEOUT', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('aborted', 'TimeoutError'));
    const client = createApiClient(config(), { fetch: fetchMock });

    await expect(client.request('fetch')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('retries a read on the fallback endpoint after a schema mismatch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(ok([], 2))
      .mockResolvedValueOnce(ok([{ id: '1', text: 'from fallback' }]));
    const client = createApiClient(config({ fallbackUrl: FALLBACK }), { fetch: fetchMock });

    const result = await client.request('fetch', {}, { allowFallback: true });

    expect(result.diagnostics).toMatchObject({ endpoint: FALLBACK, source: 'fallback' });
    expect(requestedUrl(fetchMock, 1).origin).toBe('https://script.google.com');
  });

  it('never retries a write on the fallback endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}, 2));
    const client = createApiClient(config({ fallbackUrl: FALLBACK }), { fetch: fetchMock });

    await expect(client.request('add', { text: 'x' })).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createResource', () => {
  it('sends the id alongside the mapped fields on update', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ id: '7', text: 'edited' }));
    const resource = createResource(createApiClient(config(), { fetch: fetchMock }), {
      mapRow: mapNote,
      toParams: (input: { text: string }) => ({ text: input.text })
    });

    const note = await resource.update('7', { text: 'edited' });

    expect(note).toEqual({ id: '7', text: 'edited' });
    expect(Object.fromEntries(requestedUrl(fetchMock).searchParams)).toEqual({
      action: 'edit',
      text: 'edited',
      id: '7'
    });
  });

  it('rejects a fetch response whose data is not a list', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ not: 'a list' }));
    const resource = createResource(createApiClient(config(), { fetch: fetchMock }), {
      mapRow: mapNote,
      toParams: () => ({})
    });

    await expect(resource.list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
