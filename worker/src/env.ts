export type Env = {
  GRIST_API_KEY?: string;
  SESSION_SECRET?: string;
  GRIST_BASE_URL?: string;
  DEV_ORIGINS?: string;
  SESSION_TTL_DAYS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
} & Partial<Record<`ALLOWED_EMAILS_${string}` | `NTFY_TOPIC_${string}`, string>>;

/** What the handler needs from the outside world; tests replace both. */
export type Deps = {
  fetch: typeof fetch;
  /** Milliseconds since the epoch. */
  now: () => number;
};

/** Work that may finish after the response is sent (`ctx.waitUntil`). */
export type WaitUntil = (promise: Promise<unknown>) => void;

const DEFAULT_GRIST_BASE_URL = 'https://docs.getgrist.com';
const DEFAULT_SESSION_TTL_DAYS = 90;

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** `notes` -> `ALLOWED_EMAILS_NOTES`, `time-tracker` -> `ALLOWED_EMAILS_TIME_TRACKER`. */
export function allowedEmailsVariable(appId: string): `ALLOWED_EMAILS_${string}` {
  return `ALLOWED_EMAILS_${appId.toUpperCase().replace(/-/g, '_')}`;
}

/** Empty when the variable is missing, which lets nobody in. */
export function allowedEmails(env: Env, appId: string): Set<string> {
  return new Set(splitList(env[allowedEmailsVariable(appId)]).map((email) => email.toLowerCase()));
}

export function devOrigins(env: Env): string[] {
  return splitList(env.DEV_ORIGINS);
}

export function gristBaseUrl(env: Env): string {
  return (env.GRIST_BASE_URL || DEFAULT_GRIST_BASE_URL).replace(/\/+$/, '');
}

export function sessionTtlSeconds(env: Env): number {
  const days = Number.parseInt(env.SESSION_TTL_DAYS ?? '', 10);
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_SESSION_TTL_DAYS) * 24 * 60 * 60;
}

export function nowSeconds(deps: Deps): number {
  return Math.floor(deps.now() / 1000);
}
