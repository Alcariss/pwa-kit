/**
 * The wire contract shared by the browser kit and the Grist worker.
 *
 * Every backend (the Grist worker and the legacy Google Apps Script backends)
 * answers `GET <endpoint>?action=<action>&...` with an `ApiResponse`.
 * Keep this file free of DOM and Workers types: both sides compile it.
 */
export declare const API_VERSION = "2.1.0";
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
export declare const ERROR_CODES: {
    readonly UNAUTHENTICATED: "UNAUTHENTICATED";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly UNKNOWN_APP: "UNKNOWN_APP";
    readonly UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION";
    readonly METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly UPSTREAM_ERROR: "UPSTREAM_ERROR";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
    readonly MISCONFIGURED: "MISCONFIGURED";
    readonly SCHEMA_MISMATCH: "SCHEMA_MISMATCH";
    readonly SHEET_NOT_FOUND: "SHEET_NOT_FOUND";
    readonly NETWORK_ERROR: "NETWORK_ERROR";
    readonly TIMEOUT: "TIMEOUT";
    readonly HTTP_ERROR: "HTTP_ERROR";
    readonly INVALID_RESPONSE: "INVALID_RESPONSE";
};
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
/** Errors that mean "sign in again", never "show cached data". */
export declare const AUTH_ERROR_CODES: readonly string[];
export type Diagnostics = {
    endpoint: string;
    source: ApiSource | 'cache';
    fetchedAt: string;
    cacheAgeSeconds: number | null;
    error: string | null;
};
export type AuthProvider = 'google' | 'github';
export declare const AUTH_PROVIDERS: readonly AuthProvider[];
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
export declare const AUTH_ERRORS: {
    readonly CANCELLED: "cancelled";
    readonly NOT_ALLOWED: "not_allowed";
    readonly PROVIDER_ERROR: "provider_error";
};
/** App id is the endpoint path: `https://worker.example/notes` -> `notes`. */
export declare function appIdFromEndpoint(endpoint: string): string;
