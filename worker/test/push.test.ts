import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APPS, type AppSpec } from '../src/apps.js';
import type { Env } from '../src/env.js';
import { parseSubscription } from '../src/push.js';
import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  vapidAuthorization,
  type PushSubscriptionJson
} from '../src/webpush.js';
import { APP_ORIGIN, FakeKv, ME, NOW_S, PARTNER, sessionFor, setup } from './harness.js';

const encoder = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** A browser's side of a subscription: its key pair and auth secret. */
async function fakeDevice(endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const subscription: PushSubscriptionJson = {
    endpoint,
    keys: { p256dh: base64UrlEncode(publicKey), auth: base64UrlEncode(auth) }
  };

  /** What the browser does with an `aes128gcm` body (RFC 8291 section 3.4, receiver side). */
  async function decrypt(body: Uint8Array): Promise<string> {
    const salt = body.slice(0, 16);
    const idLength = body[20] ?? 0;
    const asPublic = body.slice(21, 21 + idLength);
    const ciphertext = body.slice(21 + idLength);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, pair.privateKey, 256)
    );
    const info = new Uint8Array([...encoder.encode('WebPush: info\0'), ...publicKey, ...asPublic]);
    const ikm = await hkdf(auth, ecdh, info, 32);
    const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
    expect(plain.at(-1)).toBe(0x02);
    return new TextDecoder().decode(plain.slice(0, -1));
  }

  return { subscription, decrypt };
}

// RFC 8291 appendix A. The VAPID key below is the RFC's server key, reused.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ'
};

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: RFC.asPublic,
  VAPID_PRIVATE_KEY: RFC.asPrivate,
  VAPID_SUBJECT: 'mailto:me@example.com'
};

describe('encryptPayload', () => {
  it('matches the RFC 8291 test vector', async () => {
    const body = await encryptPayload(
      encoder.encode(RFC.plaintext),
      { endpoint: 'https://push.example/x', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } },
      {
        salt: base64UrlDecode(RFC.salt),
        serverKeys: { publicKey: base64UrlDecode(RFC.asPublic), privateKey: base64UrlDecode(RFC.asPrivate) }
      }
    );

    expect(body).toEqual(new Uint8Array([...base64UrlDecode(RFC.header), ...base64UrlDecode(RFC.ciphertext)]));
  });

  it('round-trips with fresh keys', async () => {
    const device = await fakeDevice('https://web.push.apple.com/abc');

    const body = await encryptPayload(encoder.encode('Ahoj, Hlášky!'), device.subscription);

    expect(await device.decrypt(body)).toBe('Ahoj, Hlášky!');
  });
});

describe('vapidAuthorization', () => {
  it('signs a JWT for the push service origin that verifies with the public key', async () => {
    const header = await vapidAuthorization('https://web.push.apple.com/abc?x=1', {
      publicKey: RFC.asPublic,
      privateKey: RFC.asPrivate,
      subject: 'mailto:me@example.com'
    }, NOW_S);

    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head = '', claims = '', signature = '', key = ''] = match ?? [];
    expect(key).toBe(RFC.asPublic);
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims)))).toEqual({
      aud: 'https://web.push.apple.com',
      exp: NOW_S + 12 * 60 * 60,
      sub: 'mailto:me@example.com'
    });
    const publicKey = await crypto.subtle.importKey(
      'raw', base64UrlDecode(key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, publicKey, base64UrlDecode(signature), encoder.encode(`${head}.${claims}`)
    );
    expect(valid).toBe(true);
  });
});

describe('parseSubscription', () => {
  const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };

  it('accepts the push services of Safari, Chrome, Firefox and Edge', () => {
    for (const endpoint of [
      'https://web.push.apple.com/QK',
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc'
    ]) {
      expect(parseSubscription(JSON.stringify({ endpoint, keys }))).toEqual({ endpoint, keys });
    }
  });

  it('rejects other hosts, plain http, bad keys and non-JSON', () => {
    expect(parseSubscription(JSON.stringify({ endpoint: 'https://evil.example/push', keys }))).toBeNull();
    expect(parseSubscription(JSON.stringify({ endpoint: 'https://push.apple.com.evil.example/', keys }))).toBeNull();
    expect(parseSubscription(JSON.stringify({ endpoint: 'http://web.push.apple.com/x', keys }))).toBeNull();
    expect(parseSubscription(JSON.stringify({ endpoint: 'https://web.push.apple.com/x', keys: { ...keys, auth: 'AAAA' } }))).toBeNull();
    expect(parseSubscription(JSON.stringify({ endpoint: 'https://web.push.apple.com/x', keys: { ...keys, p256dh: '***' } }))).toBeNull();
    expect(parseSubscription('nope')).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });
});

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
      push: { title: 'Hlášky', body: 'text', click: 'https://alcariss.github.io/hanushlasky/', tag: 'quote' }
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

async function as(email: string, app = 'quotes'): Promise<RequestInit> {
  return { headers: { Authorization: `Bearer ${await sessionFor(email, app)}`, Origin: APP_ORIGIN } };
}

function pushSetup(overrides: Partial<Env> = {}) {
  const kv = new FakeKv();
  const context = setup({
    ALLOWED_EMAILS_QUOTES: `${ME},${PARTNER}`,
    PUSH: kv.asNamespace(),
    ...VAPID_ENV,
    ...overrides
  });
  const subscribe = async (email: string, subscription: PushSubscriptionJson) => {
    const query = new URLSearchParams({ action: 'push-subscribe', subscription: JSON.stringify(subscription) });
    return context.send(`/quotes?${query}`, await as(email));
  };
  return { ...context, kv, subscribe };
}

describe('push subscriptions', () => {
  it('hands out the VAPID public key', async () => {
    const { send } = pushSetup();

    const response = await send('/quotes?action=push-key', await as(ME));

    expect(await response.json()).toMatchObject({ success: true, data: { publicKey: RFC.asPublic } });
  });

  it('stores a device with the signed-in email', async () => {
    const { subscribe, kv } = pushSetup();
    const device = await fakeDevice('https://web.push.apple.com/me-phone');

    const response = await subscribe(ME, device.subscription);

    expect(response.status).toBe(200);
    const [[key, value] = []] = [...kv.data];
    expect(key).toMatch(/^quotes\/[0-9a-f]{64}$/);
    expect(JSON.parse(value ?? '{}')).toEqual({
      ...device.subscription,
      email: ME,
      createdAt: '2026-11-01T12:00:00.000Z'
    });
  });

  it('rejects a subscription to anything but a push service', async () => {
    const { subscribe, kv } = pushSetup();
    const device = await fakeDevice('https://evil.example/collect');

    const response = await subscribe(ME, device.subscription);

    expect(response.status).toBe(400);
    expect(kv.data.size).toBe(0);
  });

  it('unsubscribes only the caller\'s own devices', async () => {
    const { subscribe, send, kv } = pushSetup();
    const mine = await fakeDevice('https://web.push.apple.com/mine');
    const theirs = await fakeDevice('https://web.push.apple.com/theirs');
    await subscribe(ME, mine.subscription);
    await subscribe(PARTNER, theirs.subscription);

    await send(`/quotes?action=push-unsubscribe&endpoint=${encodeURIComponent(mine.subscription.endpoint)}`, await as(ME));
    await send(`/quotes?action=push-unsubscribe&endpoint=${encodeURIComponent(theirs.subscription.endpoint)}`, await as(ME));

    expect([...kv.data.values()].map((value) => JSON.parse(value).email)).toEqual([PARTNER]);
  });

  it('requires a session', async () => {
    const { send } = pushSetup();

    const response = await send('/quotes?action=push-key', { headers: { Origin: APP_ORIGIN } });

    expect(response.status).toBe(401);
  });

  it('is unsupported on apps without a push table', async () => {
    const { send } = pushSetup();

    const response = await send('/notes?action=push-key', await as(ME, 'notes'));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: 'UNSUPPORTED_ACTION' });
  });

  it('reports a worker without VAPID secrets or the KV binding as misconfigured', async () => {
    for (const overrides of [{ VAPID_PRIVATE_KEY: undefined }, { PUSH: undefined }]) {
      const { send } = pushSetup(overrides);

      const response = await send('/quotes?action=push-key', await as(ME));

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ errorCode: 'MISCONFIGURED' });
    }
  });
});

describe('push after add', () => {
  it('sends the new record to everyone else\'s devices, encrypted and signed', async () => {
    const { subscribe, send, settle, backends, background } = pushSetup();
    const mine = await fakeDevice('https://web.push.apple.com/mine');
    const partnerPhone = await fakeDevice('https://web.push.apple.com/partner-phone');
    const partnerLaptop = await fakeDevice('https://fcm.googleapis.com/fcm/send/partner-laptop');
    await subscribe(ME, mine.subscription);
    await subscribe(PARTNER, partnerPhone.subscription);
    await subscribe(PARTNER, partnerLaptop.subscription);

    const response = await send('/quotes?action=add&date=2026-11-01&text=Já chci bagr!', await as(ME));
    await settle();

    expect(response.status).toBe(200);
    expect(background).toHaveLength(1);
    const calls = backends.pushCalls();
    expect(calls.map((call) => call.url.href).sort()).toEqual([
      'https://fcm.googleapis.com/fcm/send/partner-laptop',
      'https://web.push.apple.com/partner-phone'
    ]);
    const phone = calls.find((call) => call.url.host === 'web.push.apple.com');
    expect(phone?.method).toBe('POST');
    expect(phone?.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(phone?.headers.get('TTL')).toBe('86400');
    expect(phone?.headers.get('Authorization')).toMatch(/^vapid t=.+, k=/);
    expect(JSON.parse(await partnerPhone.decrypt(phone?.body as Uint8Array))).toEqual({
      title: 'Hlášky',
      body: 'Já chci bagr!',
      url: 'https://alcariss.github.io/hanushlasky/',
      tag: 'quote'
    });
  });

  it('forgets devices the push service no longer knows', async () => {
    const { subscribe, send, settle, backends, kv } = pushSetup();
    const gone = await fakeDevice('https://web.push.apple.com/gone');
    const expired = await fakeDevice('https://web.push.apple.com/expired');
    const alive = await fakeDevice('https://web.push.apple.com/alive');
    for (const device of [gone, expired, alive]) {
      await subscribe(PARTNER, device.subscription);
    }
    backends.pushStatus.set(gone.subscription.endpoint, 410);
    backends.pushStatus.set(expired.subscription.endpoint, 404);

    await send('/quotes?action=add&date=2026-11-01&text=x', await as(ME));
    await settle();

    expect([...kv.data.values()].map((value) => JSON.parse(value).endpoint)).toEqual([alive.subscription.endpoint]);
  });

  it('keeps the add successful when the push service fails', async () => {
    const { subscribe, send, settle, backends, kv } = pushSetup();
    const device = await fakeDevice('https://web.push.apple.com/flaky');
    await subscribe(PARTNER, device.subscription);
    backends.pushStatus.set(device.subscription.endpoint, 500);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await send('/quotes?action=add&date=2026-11-01&text=x', await as(ME));
    await settle();

    expect(response.status).toBe(200);
    expect(backends.rows.size).toBe(1);
    expect(kv.data.size).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('push_error'));
    log.mockRestore();
  });

  it('does nothing without the VAPID secrets', async () => {
    const { send, background } = pushSetup({ VAPID_PUBLIC_KEY: undefined });

    await send('/quotes?action=add&date=2026-11-01&text=x', await as(ME));

    expect(background).toHaveLength(0);
  });

  it('does not push on fetch, edit or delete', async () => {
    const { subscribe, send, settle, backends } = pushSetup();
    await subscribe(PARTNER, (await fakeDevice('https://web.push.apple.com/p')).subscription);
    const id = backends.seed({ date: '2026-10-01', text: 'old' });

    await send('/quotes?action=fetch', await as(ME));
    await send(`/quotes?action=edit&id=${id}&text=new`, await as(ME));
    await send(`/quotes?action=delete&id=${id}`, await as(ME));
    await settle();

    expect(backends.pushCalls()).toHaveLength(0);
  });
});

describe('hanushlasky', () => {
  it('shares quotes across the family and pushes each new one to the others', async () => {
    const kv = new FakeKv();
    const { send, backends, settle } = setup({
      ALLOWED_EMAILS_HANUSHLASKY: `${ME},${PARTNER}`,
      NTFY_TOPIC_HANUSHLASKY: 'old-topic',
      PUSH: kv.asNamespace(),
      ...VAPID_ENV
    });
    const device = await fakeDevice('https://web.push.apple.com/partner');
    const query = new URLSearchParams({ action: 'push-subscribe', subscription: JSON.stringify(device.subscription) });
    await send(`/hanushlasky?${query}`, await as(PARTNER, 'hanushlasky'));

    await send('/hanushlasky?action=add&date=2026-11-03&text=Ahoj', await as(ME, 'hanushlasky'));
    await settle();
    const response = await send('/hanushlasky?action=fetch', await as(PARTNER, 'hanushlasky'));

    expect(backends.gristCalls()[0]?.url.pathname).toMatch(/\/docs\/r7UEV7ogACUR\/tables\/Sheet1\/records$/);
    expect(await response.json()).toMatchObject({ data: [{ date: '2026-11-03', text: 'Ahoj' }] });
    expect(backends.ntfyCalls()).toHaveLength(0);
    const [call] = backends.pushCalls();
    expect(JSON.parse(await device.decrypt(call?.body as Uint8Array))).toEqual({
      title: 'Hlášky',
      body: 'Ahoj',
      url: 'https://alcariss.github.io/hanushlasky/'
    });
  });
});
