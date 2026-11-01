import type { ApiConfig } from './config.js';
import {
  ERROR_CODES,
  type ApiResponse,
  type ApiSource,
  type Diagnostics
} from './contract.js';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
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

const DEFAULT_FALLBACK_CODES: readonly string[] = [
  ERROR_CODES.SCHEMA_MISMATCH,
  ERROR_CODES.SHEET_NOT_FOUND
];

function isTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'TimeoutError';
}

async function readPayload(response: Response): Promise<ApiResponse<unknown> | null> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === 'object' && payload !== null && 'success' in payload) {
      return payload as ApiResponse<unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function createApiClient(config: ApiConfig, options: ApiClientOptions = {}): ApiClient {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const expectedSchema = options.schemaVersion ?? 1;
  const fallbackOn = options.fallbackOn ?? DEFAULT_FALLBACK_CODES;

  function buildUrl(endpoint: string, action: string, params: RequestParams): URL {
    const url = new URL(endpoint);
    url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    if (config.token) {
      url.searchParams.set('token', config.token);
    }
    return url;
  }

  async function send<T>(
    endpoint: string,
    source: ApiSource,
    action: string,
    params: RequestParams
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    // Only when signed in: the header forces a CORS preflight, which Apps Script cannot answer.
    const session = options.getSessionToken?.();
    if (session) {
      headers.Authorization = `Bearer ${session}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(endpoint, action, params).toString(), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(config.timeoutMs)
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new ApiError(ERROR_CODES.TIMEOUT, `No response within ${config.timeoutMs} ms`);
      }
      throw new ApiError(ERROR_CODES.NETWORK_ERROR, error instanceof Error ? error.message : String(error));
    }

    const payload = await readPayload(response);
    if (payload === null) {
      throw new ApiError(
        response.ok ? ERROR_CODES.INVALID_RESPONSE : ERROR_CODES.HTTP_ERROR,
        `HTTP ${response.status}: response is not an API payload`,
        response.status
      );
    }

    if (!payload.success) {
      throw new ApiError(
        payload.errorCode ?? ERROR_CODES.HTTP_ERROR,
        payload.message ?? payload.errorCode ?? `HTTP ${response.status}`,
        response.status
      );
    }

    if (!response.ok) {
      throw new ApiError(ERROR_CODES.HTTP_ERROR, `HTTP ${response.status}`, response.status);
    }

    if (Number(payload.meta?.schemaVersion) !== expectedSchema) {
      throw new ApiError(
        ERROR_CODES.SCHEMA_MISMATCH,
        `Backend schema ${String(payload.meta?.schemaVersion)}, app expects ${expectedSchema}`
      );
    }

    return {
      data: payload.data as T,
      diagnostics: {
        endpoint,
        source,
        fetchedAt: payload.meta.fetchedAt,
        cacheAgeSeconds: null,
        error: null
      }
    };
  }

  return {
    async request<T>(action: string, params: RequestParams = {}, requestOptions: RequestOptions = {}) {
      try {
        return await send<T>(config.primaryUrl, 'primary', action, params);
      } catch (error) {
        const canFallback = requestOptions.allowFallback === true
          && config.fallbackUrl !== null
          && error instanceof ApiError
          && fallbackOn.includes(error.code);
        if (!canFallback || config.fallbackUrl === null) {
          throw error;
        }
        return send<T>(config.fallbackUrl, 'fallback', action, params);
      }
    }
  };
}

export type ResourceOptions<T, TInput> = {
  /** Turns one untrusted row from the backend into the app's type. Throw on rows you cannot use. */
  mapRow(row: unknown): T;
  /** Turns the app's input into query parameters for `add` and `edit`. */
  toParams(input: TInput): RequestParams;
};

export type Resource<T, TInput> = {
  list(): Promise<{ items: T[]; diagnostics: Diagnostics }>;
  create(input: TInput): Promise<T>;
  update(id: string, input: TInput): Promise<T>;
  remove(id: string): Promise<void>;
};

/** The standard `fetch` / `add` / `edit` / `delete` actions over one table. */
export function createResource<T, TInput>(
  client: ApiClient,
  options: ResourceOptions<T, TInput>
): Resource<T, TInput> {
  return {
    async list() {
      const { data, diagnostics } = await client.request<unknown>('fetch', {}, { allowFallback: true });
      if (!Array.isArray(data)) {
        throw new ApiError(ERROR_CODES.INVALID_RESPONSE, 'fetch did not return a list');
      }
      return { items: data.map((row) => options.mapRow(row)), diagnostics };
    },

    async create(input) {
      const { data } = await client.request<unknown>('add', options.toParams(input));
      return options.mapRow(data);
    },

    async update(id, input) {
      const { data } = await client.request<unknown>('edit', { ...options.toParams(input), id });
      return options.mapRow(data);
    },

    async remove(id) {
      await client.request<null>('delete', { id });
    }
  };
}
