import { handleApi } from './api.js';
import { finishLogin, startLogin } from './auth.js';
import type { Deps, Env, WaitUntil } from './env.js';
import { textPage } from './http.js';

export type { Env } from './env.js';

/** Without an execution context, background work still runs; nothing waits for it. */
const detach: WaitUntil = (promise) => {
  void promise;
};

export function createHandler(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
    now: overrides.now ?? Date.now
  };

  return async (request: Request, env: Env, ctx?: { waitUntil: WaitUntil }): Promise<Response> => {
    const waitUntil: WaitUntil = ctx ? (promise) => ctx.waitUntil(promise) : detach;
    const url = new URL(request.url);
    try {
      if (url.pathname === '/auth/login') {
        return await startLogin(url, env, deps);
      }
      if (url.pathname === '/auth/callback') {
        return await finishLogin(request, url, env, deps);
      }
      return await handleApi(request, url, env, deps, waitUntil);
    } catch (error) {
      console.error(JSON.stringify({ event: 'unhandled_error', path: url.pathname, error: String(error) }));
      return textPage('Unexpected error.', 500);
    }
  };
}

const handle = createHandler();

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx)
} satisfies ExportedHandler<Env>;
