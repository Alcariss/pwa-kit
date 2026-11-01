import { handleApi } from './api.js';
import { finishLogin, startLogin } from './auth.js';
import type { Deps, Env } from './env.js';
import { textPage } from './http.js';

export type { Env } from './env.js';

export function createHandler(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
    now: overrides.now ?? Date.now
  };

  return async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/auth/login') {
        return await startLogin(url, env, deps);
      }
      if (url.pathname === '/auth/callback') {
        return await finishLogin(request, url, env, deps);
      }
      return await handleApi(request, url, env, deps);
    } catch (error) {
      console.error(JSON.stringify({ event: 'unhandled_error', path: url.pathname, error: String(error) }));
      return textPage('Unexpected error.', 500);
    }
  };
}

const handle = createHandler();

export default {
  fetch: (request, env) => handle(request, env)
} satisfies ExportedHandler<Env>;
