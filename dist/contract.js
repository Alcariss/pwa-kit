/**
 * The wire contract shared by the browser kit and the Grist worker.
 *
 * Every backend (the Grist worker and the legacy Google Apps Script backends)
 * answers `GET <endpoint>?action=<action>&...` with an `ApiResponse`.
 * Keep this file free of DOM and Workers types: both sides compile it.
 */
export const API_VERSION = '2.1.0';
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
};
/** Errors that mean "sign in again", never "show cached data". */
export const AUTH_ERROR_CODES = [
    ERROR_CODES.UNAUTHENTICATED,
    ERROR_CODES.FORBIDDEN
];
export const AUTH_PROVIDERS = ['google', 'github'];
/** Reasons the worker returns in `#auth_error=` after a failed sign-in. */
export const AUTH_ERRORS = {
    CANCELLED: 'cancelled',
    NOT_ALLOWED: 'not_allowed',
    PROVIDER_ERROR: 'provider_error'
};
/** App id is the endpoint path: `https://worker.example/notes` -> `notes`. */
export function appIdFromEndpoint(endpoint) {
    return new URL(endpoint).pathname.replace(/^\/+|\/+$/g, '');
}
