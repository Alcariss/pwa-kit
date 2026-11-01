import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, ME, NOW_S, PARTNER, sessionFor, setup } from './harness.js';

async function authorized(token: Promise<string> | string): Promise<RequestInit> {
  return { headers: { Authorization: `Bearer ${await token}`, Origin: APP_ORIGIN } };
}

describe('authentication', () => {
  it('answers 401 without a session and never reaches Grist', async () => {
    const { send, backends } = setup();

    const response = await send('/notes?action=fetch');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ errorCode: 'UNAUTHENTICATED' });
    expect(backends.gristCalls()).toHaveLength(0);
  });

  it('answers 401 for a session issued for another app', async () => {
    const { send } = setup();

    const response = await send('/notes?action=fetch', await authorized(sessionFor(ME, 'period')));

    expect(response.status).toBe(401);
  });

  it('answers 401 for an expired session', async () => {
    const { send } = setup();

    const response = await send('/notes?action=fetch', await authorized(sessionFor(ME, 'notes', NOW_S - 7200, 3600)));

    expect(response.status).toBe(401);
  });

  it('answers 401 for a session signed with another secret', async () => {
    const { send } = setup({ SESSION_SECRET: 'rotated-secret' });

    const response = await send('/notes?action=fetch', await authorized(sessionFor(ME)));

    expect(response.status).toBe(401);
  });

  it('answers 403 once the email is removed from the allowlist', async () => {
    const { send, backends } = setup({ ALLOWED_EMAILS_NOTES: PARTNER });

    const response = await send('/notes?action=fetch', await authorized(sessionFor(ME)));

    expect(response.status).toBe(403);
    expect(backends.gristCalls()).toHaveLength(0);
  });

  it('answers 404 for an app that is not configured', async () => {
    const { send } = setup();

    const response = await send('/unknown?action=fetch', await authorized(sessionFor(ME, 'unknown')));

    expect(await response.json()).toMatchObject({ errorCode: 'UNKNOWN_APP' });
  });
});

describe('CORS', () => {
  it('allows the app origin to send the Authorization header', async () => {
    const { send } = setup();

    const response = await send('/notes', { method: 'OPTIONS', headers: { Origin: APP_ORIGIN } });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP_ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization');
  });

  it('does not allow a foreign origin', async () => {
    const { send } = setup();

    const response = await send('/notes', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('records', () => {
  it('lists only the caller\'s rows in the configured order', async () => {
    const { send, backends } = setup();
    backends.seed({ owner: ME, date: '2026-10-01', text: 'mine', created_at: 'c', updated_at: 'u' });
    backends.seed({ owner: PARTNER, date: '2026-10-02', text: 'theirs', created_at: 'c', updated_at: 'u' });

    const response = await send('/notes?action=fetch', await authorized(sessionFor(ME)));

    expect(await response.json()).toMatchObject({
      success: true,
      data: [{ id: '1', date: '2026-10-01', text: 'mine', createdAt: 'c', updatedAt: 'u' }]
    });
    expect(backends.gristCalls()[0]?.url.searchParams.get('sort')).toBe('-date,-created_at');
  });

  it('adds a row stamped with the owner and timestamps', async () => {
    const { send, backends } = setup();

    const response = await send('/notes?action=add&date=2026-11-01&text=Hello', await authorized(sessionFor(ME)));

    expect(await response.json()).toMatchObject({
      success: true,
      data: { id: '1', date: '2026-11-01', text: 'Hello', createdAt: '2026-11-01T12:00:00.000Z' }
    });
    expect(backends.rows.get(1)).toEqual({
      date: '2026-11-01',
      text: 'Hello',
      owner: ME,
      created_at: '2026-11-01T12:00:00.000Z',
      updated_at: '2026-11-01T12:00:00.000Z'
    });
  });

  it('rejects an add without a required field before calling Grist', async () => {
    const { send, backends } = setup();

    const response = await send('/notes?action=add&date=2026-11-01', await authorized(sessionFor(ME)));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: 'VALIDATION_ERROR', message: 'text is required' });
    expect(backends.gristCalls()).toHaveLength(0);
  });

  it('rejects a date that does not exist', async () => {
    const { send } = setup();

    const response = await send('/notes?action=add&date=2026-02-30&text=x', await authorized(sessionFor(ME)));

    expect(await response.json()).toMatchObject({ message: 'date must be a date as YYYY-MM-DD' });
  });

  it('rejects a field the app does not define', async () => {
    const { send } = setup();

    const response = await send('/notes?action=add&date=2026-11-01&text=x&owner=someone@else', await authorized(sessionFor(ME)));

    expect(await response.json()).toMatchObject({ message: 'Unknown field owner' });
  });

  it('edits the caller\'s row and keeps the fields it did not send', async () => {
    const { send, backends } = setup();
    const id = backends.seed({ owner: ME, date: '2026-10-01', text: 'old', created_at: 'c', updated_at: 'u' });

    const response = await send(`/notes?action=edit&id=${id}&text=new`, await authorized(sessionFor(ME)));

    expect(await response.json()).toMatchObject({ data: { id: String(id), date: '2026-10-01', text: 'new' } });
    expect(backends.rows.get(id)).toMatchObject({ text: 'new', updated_at: '2026-11-01T12:00:00.000Z' });
  });

  it('will not edit another user\'s row', async () => {
    const { send, backends } = setup();
    const id = backends.seed({ owner: PARTNER, date: '2026-10-01', text: 'theirs' });

    const response = await send(`/notes?action=edit&id=${id}&text=mine now`, await authorized(sessionFor(ME)));

    expect(response.status).toBe(404);
    expect(backends.rows.get(id)).toMatchObject({ text: 'theirs' });
  });

  it('deletes the caller\'s row', async () => {
    const { send, backends } = setup();
    const id = backends.seed({ owner: ME, date: '2026-10-01', text: 'bye' });

    const response = await send(`/notes?action=delete&id=${id}`, await authorized(sessionFor(ME)));

    expect(response.status).toBe(200);
    expect(backends.rows.has(id)).toBe(false);
  });

  it('will not delete another user\'s row', async () => {
    const { send, backends } = setup();
    const id = backends.seed({ owner: PARTNER, date: '2026-10-01', text: 'theirs' });

    const response = await send(`/notes?action=delete&id=${id}`, await authorized(sessionFor(ME)));

    expect(response.status).toBe(404);
    expect(backends.rows.has(id)).toBe(true);
  });

  it('reports a Grist outage as UPSTREAM_ERROR with CORS headers', async () => {
    const { send, backends } = setup();
    backends.gristDown = true;

    const response = await send('/notes?action=fetch', await authorized(sessionFor(ME)));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ errorCode: 'UPSTREAM_ERROR' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP_ORIGIN);
  });
});
