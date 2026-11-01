import { ERROR_CODES } from './contract.js';
export class ApiError extends Error {
    code;
    status;
    constructor(code, message, status = null) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
    }
}
const DEFAULT_FALLBACK_CODES = [
    ERROR_CODES.SCHEMA_MISMATCH,
    ERROR_CODES.SHEET_NOT_FOUND
];
function isTimeout(error) {
    return typeof error === 'object' && error !== null && error.name === 'TimeoutError';
}
async function readPayload(response) {
    try {
        const payload = await response.json();
        if (typeof payload === 'object' && payload !== null && 'success' in payload) {
            return payload;
        }
        return null;
    }
    catch {
        return null;
    }
}
export function createApiClient(config, options = {}) {
    const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const expectedSchema = options.schemaVersion ?? 1;
    const fallbackOn = options.fallbackOn ?? DEFAULT_FALLBACK_CODES;
    function buildUrl(endpoint, action, params) {
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
    async function send(endpoint, source, action, params) {
        const headers = { Accept: 'application/json' };
        // Only when signed in: the header forces a CORS preflight, which Apps Script cannot answer.
        const session = options.getSessionToken?.();
        if (session) {
            headers.Authorization = `Bearer ${session}`;
        }
        let response;
        try {
            response = await fetchImpl(buildUrl(endpoint, action, params).toString(), {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(config.timeoutMs)
            });
        }
        catch (error) {
            if (isTimeout(error)) {
                throw new ApiError(ERROR_CODES.TIMEOUT, `No response within ${config.timeoutMs} ms`);
            }
            throw new ApiError(ERROR_CODES.NETWORK_ERROR, error instanceof Error ? error.message : String(error));
        }
        const payload = await readPayload(response);
        if (payload === null) {
            throw new ApiError(response.ok ? ERROR_CODES.INVALID_RESPONSE : ERROR_CODES.HTTP_ERROR, `HTTP ${response.status}: response is not an API payload`, response.status);
        }
        if (!payload.success) {
            throw new ApiError(payload.errorCode ?? ERROR_CODES.HTTP_ERROR, payload.message ?? payload.errorCode ?? `HTTP ${response.status}`, response.status);
        }
        if (!response.ok) {
            throw new ApiError(ERROR_CODES.HTTP_ERROR, `HTTP ${response.status}`, response.status);
        }
        if (Number(payload.meta?.schemaVersion) !== expectedSchema) {
            throw new ApiError(ERROR_CODES.SCHEMA_MISMATCH, `Backend schema ${String(payload.meta?.schemaVersion)}, app expects ${expectedSchema}`);
        }
        return {
            data: payload.data,
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
        async request(action, params = {}, requestOptions = {}) {
            try {
                return await send(config.primaryUrl, 'primary', action, params);
            }
            catch (error) {
                const canFallback = requestOptions.allowFallback === true
                    && config.fallbackUrl !== null
                    && error instanceof ApiError
                    && fallbackOn.includes(error.code);
                if (!canFallback || config.fallbackUrl === null) {
                    throw error;
                }
                return send(config.fallbackUrl, 'fallback', action, params);
            }
        }
    };
}
/** The standard `fetch` / `add` / `edit` / `delete` actions over one table. */
export function createResource(client, options) {
    const table = options.table === undefined ? {} : { table: options.table };
    return {
        async list() {
            const { data, diagnostics } = await client.request('fetch', table, { allowFallback: true });
            if (!Array.isArray(data)) {
                throw new ApiError(ERROR_CODES.INVALID_RESPONSE, 'fetch did not return a list');
            }
            return { items: data.map((row) => options.mapRow(row)), diagnostics };
        },
        async create(input) {
            const { data } = await client.request('add', { ...options.toParams(input), ...table });
            return options.mapRow(data);
        },
        async update(id, input) {
            const { data } = await client.request('edit', { ...options.toParams(input), ...table, id });
            return options.mapRow(data);
        },
        async remove(id) {
            await client.request('delete', { ...table, id });
        }
    };
}
