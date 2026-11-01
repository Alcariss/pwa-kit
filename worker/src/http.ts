import { API_VERSION, type ApiFailure, type ApiSuccess } from '../../src/contract.js';

export type ResponseContext = {
  cors: Record<string, string>;
  schemaVersion: number;
  now: () => number;
};

/** Echoes the request origin only when it is on the list. */
export function corsHeaders(origin: string | null, allowedOrigins: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin !== null && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function preflight(cors: Record<string, string>): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

function json(body: unknown, status: number, context: ResponseContext): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...context.cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function meta(context: ResponseContext) {
  return {
    apiVersion: API_VERSION,
    schemaVersion: context.schemaVersion,
    source: 'primary' as const,
    fetchedAt: new Date(context.now()).toISOString()
  };
}

export function success<T>(data: T, context: ResponseContext): Response {
  const body: ApiSuccess<T> = { success: true, data, meta: meta(context) };
  return json(body, 200, context);
}

export function failure(errorCode: string, message: string, status: number, context: ResponseContext): Response {
  const body: ApiFailure = { success: false, data: null, meta: meta(context), errorCode, message };
  return json(body, status, context);
}

/** Plain-text page for sign-in errors that cannot be sent back to the app. */
export function textPage(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: { ...headers, Location: location, 'Cache-Control': 'no-store' }
  });
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      return value.join('=');
    }
  }
  return null;
}
