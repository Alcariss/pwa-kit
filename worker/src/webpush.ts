/**
 * Web Push with nothing but WebCrypto: message encryption (RFC 8291,
 * `aes128gcm` from RFC 8188) and VAPID authentication (RFC 8292).
 */

export type PushSubscriptionJson = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type VapidKeys = {
  /** Uncompressed P-256 point, base64url (65 bytes). What browsers get as `applicationServerKey`. */
  publicKey: string;
  /** Private scalar, base64url (32 bytes). */
  privateKey: string;
  /** `mailto:` or `https:` contact for the push services. */
  subject: string;
};

const RECORD_SIZE = 4096;
const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws on anything that is not base64url (padding tolerated). */
export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) {
    throw new Error('not base64url');
  }
  const base64 = value.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** A P-256 public key as an uncompressed point: 0x04 || x || y. */
export function isP256PublicKey(bytes: Uint8Array): boolean {
  return bytes.length === 65 && bytes[0] === 0x04;
}

function privateJwk(publicKey: Uint8Array, privateKey: Uint8Array): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(publicKey.slice(1, 33)),
    y: base64UrlEncode(publicKey.slice(33, 65)),
    d: base64UrlEncode(privateKey),
    ext: true
  };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

export type EncryptOptions = {
  /** Tests only: fixed salt and server key pair instead of fresh random ones. */
  salt?: Uint8Array;
  serverKeys?: { publicKey: Uint8Array; privateKey: Uint8Array };
};

/** The request body for one push message: header (salt, rs, keyid) and a single record. */
export async function encryptPayload(
  plaintext: Uint8Array,
  subscription: PushSubscriptionJson,
  options: EncryptOptions = {}
): Promise<Uint8Array> {
  const uaPublic = base64UrlDecode(subscription.keys.p256dh);
  const authSecret = base64UrlDecode(subscription.keys.auth);
  if (!isP256PublicKey(uaPublic) || authSecret.length !== 16) {
    throw new Error('invalid subscription keys');
  }
  if (plaintext.length + 1 + 16 > RECORD_SIZE - 86) {
    throw new Error('payload too large');
  }

  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (options.serverKeys) {
    asPublic = options.serverKeys.publicKey;
    asPrivate = await crypto.subtle.importKey(
      'jwk',
      privateJwk(asPublic, options.serverKeys.privateKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // The Workers typings call the peer key `$public`; the runtime wants `public`.
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPrivate, 256)
  );

  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** `Authorization` header value proving the message comes from the holder of the VAPID key. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowSeconds: number): Promise<string> {
  const publicKey = base64UrlDecode(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk(publicKey, base64UrlDecode(vapid.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const part = (value: unknown): string => base64UrlEncode(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: nowSeconds + 12 * 60 * 60,
    sub: vapid.subject
  })}`;
  // WebCrypto signs in the raw r || s form that JWS expects.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned))
  );
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`;
}

export type SendOptions = {
  fetch: typeof fetch;
  vapid: VapidKeys;
  nowSeconds: number;
  /** Seconds the push service keeps the message for an offline device. */
  ttl?: number;
};

/** POSTs one encrypted message to the subscription's push service. */
export async function sendWebPush(
  subscription: PushSubscriptionJson,
  payload: string,
  options: SendOptions
): Promise<Response> {
  const body = await encryptPayload(encoder.encode(payload), subscription);
  return options.fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, options.vapid, options.nowSeconds),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(options.ttl ?? 24 * 60 * 60),
      Urgency: 'normal'
    },
    body
  });
}
