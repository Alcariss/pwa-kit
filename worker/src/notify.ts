import type { NotifySpec } from './apps.js';
import type { Env } from './env.js';

export const DEFAULT_NTFY_SERVER = 'https://ntfy.sh';
/** ntfy cuts long messages anyway; keep the push readable. */
const MAX_MESSAGE_LENGTH = 1000;

/** `hlasky` -> `NTFY_TOPIC_HLASKY`, `time-tracker` -> `NTFY_TOPIC_TIME_TRACKER`. */
export function ntfyTopicVariable(appId: string): `NTFY_TOPIC_${string}` {
  return `NTFY_TOPIC_${appId.toUpperCase().replace(/-/g, '_')}`;
}

/** Null when the secret is missing, which turns notifications off. */
export function ntfyTopic(env: Env, appId: string): string | null {
  const topic = env[ntfyTopicVariable(appId)]?.trim();
  return topic ? topic : null;
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}

export type NtfyMessage = {
  topic: string;
  title: string;
  message: string;
  click: string;
  tags?: string[];
};

/** The JSON ntfy accepts on its root URL. JSON, not headers, so titles like "Hlášky" survive. */
export function buildNotification(spec: NotifySpec, topic: string, item: Record<string, unknown>): NtfyMessage {
  const raw = typeof spec.body === 'function' ? spec.body(item) : item[spec.body];
  const message = truncate(String(raw ?? '').trim()) || spec.title;
  return {
    topic,
    title: spec.title,
    message,
    click: spec.click,
    ...(spec.tags && spec.tags.length > 0 ? { tags: [...spec.tags] } : {})
  };
}

/**
 * Publishes to ntfy. Never throws: a failed push is logged, and the record
 * the user just saved stays saved.
 */
export async function publishNotification(
  fetcher: typeof fetch,
  spec: NotifySpec,
  topic: string,
  item: Record<string, unknown>,
  appId: string
): Promise<void> {
  const server = (spec.server ?? DEFAULT_NTFY_SERVER).replace(/\/+$/, '');
  try {
    const response = await fetcher(`${server}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildNotification(spec, topic, item))
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: 'ntfy_error', app: appId, status: response.status }));
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'ntfy_error', app: appId, error: String(error) }));
  }
}
