import type { ApiConfig } from './config.js';
import { type Diagnostics } from './contract.js';
export declare class ApiError extends Error {
    readonly code: string;
    readonly status: number | null;
    constructor(code: string, message: string, status?: number | null);
}
export type RequestParams = Readonly<Record<string, string | number | boolean | null | undefined>>;
export type ApiResult<T> = {
    data: T;
    diagnostics: Diagnostics;
};
export type RequestOptions = {
    /** Retry on the fallback endpoint for schema errors (legacy sheet backends). */
    allowFallback?: boolean;
};
export type ApiClient = {
    /** Calls any action, including app-specific ones beyond the CRUD four. */
    request<T>(action: string, params?: RequestParams, options?: RequestOptions): Promise<ApiResult<T>>;
};
export type ApiClientOptions = {
    /** Schema version the app understands; other versions raise SCHEMA_MISMATCH. */
    schemaVersion?: number;
    /** Returns the current sign-in session, sent as a bearer token. */
    getSessionToken?: () => string | null;
    fetch?: typeof fetch;
    fallbackOn?: readonly string[];
};
export declare function createApiClient(config: ApiConfig, options?: ApiClientOptions): ApiClient;
export type ResourceOptions<T, TInput> = {
    /** Turns one untrusted row from the backend into the app's type. Throw on rows you cannot use. */
    mapRow(row: unknown): T;
    /** Turns the app's input into query parameters for `add` and `edit`. */
    toParams(input: TInput): RequestParams;
};
export type Resource<T, TInput> = {
    list(): Promise<{
        items: T[];
        diagnostics: Diagnostics;
    }>;
    create(input: TInput): Promise<T>;
    update(id: string, input: TInput): Promise<T>;
    remove(id: string): Promise<void>;
};
/** The standard `fetch` / `add` / `edit` / `delete` actions over one table. */
export declare function createResource<T, TInput>(client: ApiClient, options: ResourceOptions<T, TInput>): Resource<T, TInput>;
