import { ERROR_CODES, type SessionClaims } from '../../src/contract.js';
import type { AppSpec, PushSpec } from './apps.js';
import type { Env } from './env.js';
import { failure, success, type ResponseContext } from './http.js';
import { messageText } from './notify.js';
import {
  base64UrlDecode,
  isP256PublicKey,
  sendWebPush,
  type PushSubscriptionJson,
  type VapidKeys
} from './webpush.js';

/** What the `PUSH` KV namespace holds under `<appId>/<sha256(endpoint)>`. */
export type StoredSubscription = PushSubscriptionJson & {
  /** Signed-in email of whoever subscribed the device. */
  email: string;
  createdAt: string;
};

/**
 * Push services of Chrome/Android, Safari/iOS, Firefox and Edge. The worker
 * only ever POSTs to these, so a subscription cannot point it at anything else.
 */
const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com'];
const MAX_ENDPOINT_LENGTH = 2048;

export const PUSH_ACTIONS = ['push-key', 'push-subscribe', 'push-unsubscribe'] as const;

/** Null when any of the three VAPID secrets is missing, which turns Web Push off. */
export function vapidKeys(env: Env): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** Devices subscribe per app; any table with `push` makes the app accept them. */
export function appHasPush(app: AppSpec): boolean {
  return Object.values(app.tables).some((table) => table.push !== undefined);
}

function isPushServiceUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname;
  return url.protocol === 'https:'
    && value.length <= MAX_ENDPOINT_LENGTH
    && PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function decodes(value: unknown, check: (bytes: Uint8Array) => boolean): boolean {
  try {
    return typeof value === 'string' && check(base64UrlDecode(value));
  } catch {
    return false;
  }
}

/** `PushSubscription.toJSON()` as sent by the browser, or null when it is not one. */
export function parseSubscription(raw: string | null): PushSubscriptionJson | null {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? '');
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== 'string' || !isPushServiceUrl(endpoint) || typeof keys !== 'object' || keys === null) {
    return null;
  }
  if (!decodes(keys.p256dh, isP256PublicKey) || !decodes(keys.auth, (bytes) => bytes.length === 16)) {
    return null;
  }
  return { endpoint, keys: { p256dh: keys.p256dh as string, auth: keys.auth as string } };
}

async function storageKey(appId: string, endpoint: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return `${appId}/${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export type PushRequest = {
  env: Env;
  app: AppSpec;
  appId: string;
  claims: SessionClaims;
  params: URLSearchParams;
  respond: ResponseContext;
  now: () => number;
};

/** `?action=push-key|push-subscribe|push-unsubscribe` for the signed-in user. */
export async function handlePushAction(action: string, request: PushRequest): Promise<Response> {
  const { env, respond } = request;
  if (!appHasPush(request.app)) {
    return failure(ERROR_CODES.UNSUPPORTED_ACTION, 'This app sends no push notifications', 400, respond);
  }
  const vapid = vapidKeys(env);
  if (vapid === null || !env.PUSH) {
    return failure(ERROR_CODES.MISCONFIGURED, 'Worker is missing the VAPID secrets or the PUSH binding', 500, respond);
  }

  if (action === 'push-key') {
    return success({ publicKey: vapid.publicKey }, respond);
  }

  if (action === 'push-subscribe') {
    const subscription = parseSubscription(request.params.get('subscription'));
    if (subscription === null) {
      return failure(ERROR_CODES.VALIDATION_ERROR, 'subscription must be a PushSubscription in JSON', 400, respond);
    }
    const stored: StoredSubscription = {
      ...subscription,
      email: request.claims.sub.toLowerCase(),
      createdAt: new Date(request.now()).toISOString()
    };
    await env.PUSH.put(await storageKey(request.appId, subscription.endpoint), JSON.stringify(stored));
    return success({ subscribed: true }, respond);
  }

  const endpoint = request.params.get('endpoint');
  if (endpoint === null || endpoint.length === 0) {
    return failure(ERROR_CODES.VALIDATION_ERROR, 'endpoint is required', 400, respond);
  }
  const key = await storageKey(request.appId, endpoint);
  const existing = await env.PUSH.get<StoredSubscription>(key, 'json');
  // A device subscribed by someone else stays theirs.
  if (existing !== null && existing.email === request.claims.sub.toLowerCase()) {
    await env.PUSH.delete(key);
  }
  return success({ subscribed: false }, respond);
}

const MAX_BODY_LENGTH = 1000;

export type PushMessage = {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  icon?: string;
  tag?: string;
};

export function buildPushMessage(spec: PushSpec, item: Record<string, unknown>): PushMessage {
  return {
    title: spec.title,
    body: messageText(spec.body, item, spec.title, MAX_BODY_LENGTH),
    url: spec.click,
    ...(spec.icon ? { icon: spec.icon } : {}),
    ...(spec.tag ? { tag: spec.tag } : {})
  };
}

async function listSubscriptions(kv: KVNamespace, appId: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: `${appId}/`, ...(cursor ? { cursor } : {}) });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

export type FanOutOptions = {
  env: Env;
  appId: string;
  spec: PushSpec;
  item: Record<string, unknown>;
  /** The author: their own devices are skipped. */
  author: string;
  fetch: typeof fetch;
  nowSeconds: number;
};

/**
 * Sends the new record to every device subscribed to the app except the
 * author's. Never throws: failures are logged, and subscriptions the push
 * service reports gone (404/410) are deleted.
 */
export async function pushToSubscribers(options: FanOutOptions): Promise<void> {
  const { env, appId } = options;
  const vapid = vapidKeys(env);
  const kv = env.PUSH;
  if (vapid === null || !kv) {
    return;
  }
  const author = options.author.toLowerCase();
  const payload = JSON.stringify(buildPushMessage(options.spec, options.item));

  try {
    const keys = await listSubscriptions(kv, appId);
    await Promise.all(keys.map(async (key) => {
      try {
        const subscription = await kv.get<StoredSubscription>(key, 'json');
        if (subscription === null || subscription.email === author) {
          return;
        }
        const response = await sendWebPush(subscription, payload, {
          fetch: options.fetch,
          vapid,
          nowSeconds: options.nowSeconds
        });
        if (response.status === 404 || response.status === 410) {
          await kv.delete(key);
        } else if (!response.ok) {
          console.error(JSON.stringify({ event: 'push_error', app: appId, status: response.status }));
        }
      } catch (error) {
        console.error(JSON.stringify({ event: 'push_error', app: appId, error: String(error) }));
      }
    }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'push_error', app: appId, error: String(error) }));
  }
}
