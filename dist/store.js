import { ApiError } from './api.js';
import { AUTH_ERROR_CODES } from './contract.js';
function isAuthError(error) {
    return error instanceof ApiError && AUTH_ERROR_CODES.includes(error.code);
}
export function createStore(deps) {
    const { resource, cache } = deps;
    const now = deps.now ?? Date.now;
    async function refresh() {
        try {
            const result = await resource.list();
            cache.save(result.items);
            return result;
        }
        catch (error) {
            const cached = cache.load();
            if (cached === null || isAuthError(error)) {
                throw error;
            }
            return {
                items: cached.items,
                diagnostics: {
                    endpoint: '',
                    source: 'cache',
                    fetchedAt: new Date(now() - cached.ageMs).toISOString(),
                    cacheAgeSeconds: Math.floor(cached.ageMs / 1000),
                    error: error instanceof Error ? error.message : String(error)
                }
            };
        }
    }
    return {
        loadCached: () => cache.load(),
        refresh,
        async create(input) {
            await resource.create(input);
            return refresh();
        },
        async update(id, input) {
            await resource.update(id, input);
            return refresh();
        },
        async remove(id) {
            await resource.remove(id);
            return refresh();
        },
        clear: () => cache.clear()
    };
}
