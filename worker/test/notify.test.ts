import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APPS, type AppSpec } from '../src/apps.js';
import { buildNotification } from '../src/notify.js';
import { APP_ORIGIN, ME, sessionFor, setup } from './harness.js';

// A shared quotes table like Hlášky's, registered only for these tests.
const QUOTES: AppSpec = {
  origins: [APP_ORIGIN],
  documentId: 'quotes-doc',
  tables: {
    quotes: {
      tableId: 'Quotes',
      fields: {
        date: { type: 'date', required: true },
        text: { type: 'text', required: true }
      },
      timestamps: false,
      notify: { title: 'Hlášky', body: 'text', click: 'https://alcariss.github.io/hanushlasky/', tags: ['speech_balloon'] }
    }
  }
};

const apps = APPS as Record<string, AppSpec>;
beforeAll(() => {
  apps.quotes = QUOTES;
});
afterAll(() => {
  delete apps.quotes;
});

const ENV = { ALLOWED_EMAILS_QUOTES: ME, NTFY_TOPIC_QUOTES: 'secret-topic' };

async function asMe(): Promise<RequestInit> {
  return { headers: { Authorization: `Bearer ${await sessionFor(ME, 'quotes')}`, Origin: APP_ORIGIN } };
}

describe('ntfy notifications', () => {
  it('publishes the new record to the app topic after an add', async () => {
    const { send, backends, settle } = setup(ENV);

    const response = await send('/quotes?action=add&date=2026-11-01&text=Já chci bagr!', await asMe());
    await settle();

    expect(response.status).toBe(200);
    const [call] = backends.ntfyCalls();
    expect(call?.method).toBe('POST');
    expect(call?.url.href).toBe('https://ntfy.sh/');
    expect(call?.body).toEqual({
      topic: 'secret-topic',
      title: 'Hlášky',
      message: 'Já chci bagr!',
      click: 'https://alcariss.github.io/hanushlasky/',
      tags: ['speech_balloon']
    });
  });

  it('hands the push to waitUntil instead of awaiting it', async () => {
    const { send, background } = setup(ENV);

    await send('/quotes?action=add&date=2026-11-01&text=x', await asMe());

    expect(background).toHaveLength(1);
  });

  it('stays quiet without the topic secret', async () => {
    const { send, backends, background } = setup({ ALLOWED_EMAILS_QUOTES: ME });

    await send('/quotes?action=add&date=2026-11-01&text=x', await asMe());

    expect(background).toHaveLength(0);
    expect(backends.ntfyCalls()).toHaveLength(0);
  });

  it('does not notify on fetch, edit, delete or a rejected add', async () => {
    const { send, backends, settle } = setup(ENV);
    const id = backends.seed({ date: '2026-10-01', text: 'old' });

    await send('/quotes?action=fetch', await asMe());
    await send(`/quotes?action=edit&id=${id}&text=new`, await asMe());
    await send(`/quotes?action=delete&id=${id}`, await asMe());
    await send('/quotes?action=add&date=2026-11-01', await asMe());
    await settle();

    expect(backends.ntfyCalls()).toHaveLength(0);
  });

  it('keeps the add successful when ntfy is down', async () => {
    const { send, backends, settle } = setup(ENV);
    backends.ntfyDown = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await send('/quotes?action=add&date=2026-11-01&text=x', await asMe());
    await settle();

    expect(response.status).toBe(200);
    expect(backends.rows.size).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ntfy_error'));
    log.mockRestore();
  });

  it('never notifies for apps without a notify setting', async () => {
    const { send, backends, settle } = setup({ NTFY_TOPIC_NOTES: 'topic' });

    await send('/notes?action=add&date=2026-11-01&text=x', {
      headers: { Authorization: `Bearer ${await sessionFor(ME)}`, Origin: APP_ORIGIN }
    });
    await settle();

    expect(backends.ntfyCalls()).toHaveLength(0);
  });
});

describe('buildNotification', () => {
  const spec = { title: 'Hlášky', body: 'text', click: 'https://example.com/' };

  it('builds the message with a function', () => {
    const message = buildNotification(
      { ...spec, body: (item) => `${String(item.date)}: ${String(item.text)}` },
      't',
      { date: '2026-11-01', text: 'Ahoj' }
    );

    expect(message.message).toBe('2026-11-01: Ahoj');
  });

  it('falls back to the title for an empty message and shortens long ones', () => {
    expect(buildNotification(spec, 't', { text: '  ' }).message).toBe('Hlášky');
    expect(buildNotification(spec, 't', { text: 'a'.repeat(5000) }).message).toHaveLength(1000);
  });
});
