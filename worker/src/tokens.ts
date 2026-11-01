import type { SessionClaims } from '../../src/contract.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The only header this worker issues or accepts; pinning it rules out `alg: none`. */
const HEADER = toBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export function randomToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** HS256 JWT. Claims must carry `exp` (seconds) and a `purpose`. */
export async function signToken(claims: { purpose: string; exp: number }, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${HEADER}.${payload}`));
  return `${HEADER}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Claims of a token this worker signed for `purpose` and that has not expired; otherwise null. */
export async function verifyToken(
  token: string,
  secret: string,
  purpose: string,
  nowSeconds: number
): Promise<Record<string, unknown> | null> {
  const [header, payload, signature, ...rest] = token.split('.');
  if (header !== HEADER || payload === undefined || signature === undefined || rest.length > 0) {
    return null;
  }

  try {
    // subtle.verify compares in constant time.
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(`${header}.${payload}`)
    );
    if (!valid) {
      return null;
    }

    const claims = JSON.parse(decoder.decode(fromBase64Url(payload))) as Record<string, unknown>;
    if (claims.purpose !== purpose || typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function issueSession(
  email: string,
  appId: string,
  secret: string,
  nowSeconds: number,
  ttlSeconds: number
): Promise<string> {
  const claims: SessionClaims = {
    purpose: 'session',
    sub: email,
    app: appId,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  };
  return signToken(claims, secret);
}

/** The session in an `Authorization: Bearer` header, if valid for this app. */
export async function readSession(
  authorization: string | null,
  appId: string,
  secret: string,
  nowSeconds: number
): Promise<SessionClaims | null> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
  if (token === undefined) {
    return null;
  }

  const claims = await verifyToken(token, secret, 'session', nowSeconds);
  if (claims === null || claims.app !== appId || typeof claims.sub !== 'string') {
    return null;
  }
  return claims as SessionClaims;
}
