/**
 * The wire contract shared by the browser kit and the Grist worker.
 *
 * Every backend (the Grist worker and the legacy Google Apps Script backends)
 * answers `GET <endpoint>?action=<action>&...` with an `ApiResponse`.
 * Keep this file free of DOM and Workers types: both sides compile it.
 */

export const API_VERSION = '2.1.0';

export type ApiSource = 'primary' | 'fallback';

export type ApiMeta = {
  apiVersion: string;
  schemaVersion: number;
  source: ApiSource;
  fetchedAt: string;
};

export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta: ApiMeta;
};

export type ApiFailure = {
  success: false;
  data: null;
  meta: ApiMeta;
  errorCode: string;
  message: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  UNKNOWN_APP: 'UNKNOWN_APP',
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  MISCONFIGURED: 'MISCONFIGURED',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  SHEET_NOT_FOUND: 'SHEET_NOT_FOUND',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  HTTP_ERROR: 'HTTP_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE'
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Errors that mean "sign in again", never "show cached data". */
export const AUTH_ERROR_CODES: readonly string[] = [
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.FORBIDDEN
];

export type Diagnostics = {
  endpoint: string;
  source: ApiSource | 'cache';
  fetchedAt: string;
  cacheAgeSeconds: number | null;
  error: string | null;
};

export type AuthProvider = 'google' | 'github';

export const AUTH_PROVIDERS: readonly AuthProvider[] = ['google', 'github'];

/** Claims of the session token the worker issues after sign-in. */
export type SessionClaims = {
  purpose: 'session';
  /** Verified email address of the signed-in user. */
  sub: string;
  /** App id the session is valid for. */
  app: string;
  iat: number;
  exp: number;
};

/** Reasons the worker returns in `#auth_error=` after a failed sign-in. */
export const AUTH_ERRORS = {
  CANCELLED: 'cancelled',
  NOT_ALLOWED: 'not_allowed',
  PROVIDER_ERROR: 'provider_error'
} as const;

/** App id is the endpoint path: `https://worker.example/notes` -> `notes`. */
export function appIdFromEndpoint(endpoint: string): string {
  return new URL(endpoint).pathname.replace(/^\/+|\/+$/g, '');
}
