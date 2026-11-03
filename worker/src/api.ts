import { ERROR_CODES, type SessionClaims } from '../../src/contract.js';
import { getApp, getTable, type TableSpec } from './apps.js';
import { allowedEmails, devOrigins, gristBaseUrl, nowSeconds, type Deps, type Env, type WaitUntil } from './env.js';
import { parseInput, toItem } from './fields.js';
import { gristTable, UpstreamError, type GristRecord, type GristTable } from './grist.js';
import { corsHeaders, failure, preflight, success, type ResponseContext } from './http.js';
import { ntfyTopic, publishNotification } from './notify.js';
import { readSession } from './tokens.js';

type ActionContext = {
  spec: TableSpec;
  grist: GristTable;
  claims: SessionClaims;
  params: URLSearchParams;
  respond: ResponseContext;
  now: () => number;
  /** Runs after a successful add; must not throw or block the response. */
  onAdded: (item: Record<string, unknown>) => void;
};

function ownerFilter(spec: TableSpec, claims: SessionClaims): Record<string, string[]> {
  return spec.ownerColumn ? { [spec.ownerColumn]: [claims.sub] } : {};
}

function parseRowId(raw: string | null): number | null {
  return raw !== null && /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
}

/** The row, if it exists and (with `ownerColumn`) belongs to the caller. */
async function findOwnedRow(context: ActionContext, id: number): Promise<GristRecord | null> {
  const rows = await context.grist.list({ filter: { id: [id], ...ownerFilter(context.spec, context.claims) } });
  return rows[0] ?? null;
}

async function listRows(context: ActionContext): Promise<Response> {
  const { spec, claims } = context;
  const rows = await context.grist.list({ filter: ownerFilter(spec, claims), sort: spec.sort });
  return success(rows.map((row) => toItem(spec, row)), context.respond);
}

async function addRow(context: ActionContext): Promise<Response> {
  const { spec } = context;
  const input = parseInput(spec, context.params, 'create');
  if (!input.ok) {
    return failure(ERROR_CODES.VALIDATION_ERROR, input.message, 400, context.respond);
  }

  const now = new Date(context.now()).toISOString();
  const columns: Record<string, unknown> = { ...input.columns };
  if (spec.timestamps) {
    columns[spec.timestamps.createdAt] = now;
    columns[spec.timestamps.updatedAt] = now;
  }
  if (spec.ownerColumn) {
    columns[spec.ownerColumn] = context.claims.sub;
  }

  const id = await context.grist.add(columns);
  const item = toItem(spec, { id, fields: columns });
  context.onAdded(item);
  return success(item, context.respond);
}

async function editRow(context: ActionContext): Promise<Response> {
  const { spec } = context;
  const id = parseRowId(context.params.get('id'));
  if (id === null) {
    return failure(ERROR_CODES.VALIDATION_ERROR, 'id must be a positive integer', 400, context.respond);
  }
  const input = parseInput(spec, context.params, 'update');
  if (!input.ok) {
    return failure(ERROR_CODES.VALIDATION_ERROR, input.message, 400, context.respond);
  }

  const existing = await findOwnedRow(context, id);
  if (existing === null) {
    return failure(ERROR_CODES.NOT_FOUND, `No record ${id}`, 404, context.respond);
  }

  const columns: Record<string, unknown> = { ...input.columns };
  if (spec.timestamps) {
    columns[spec.timestamps.updatedAt] = new Date(context.now()).toISOString();
  }
  await context.grist.update(id, columns);
  return success(toItem(spec, { id, fields: { ...existing.fields, ...columns } }), context.respond);
}

async function deleteRow(context: ActionContext): Promise<Response> {
  const id = parseRowId(context.params.get('id'));
  if (id === null) {
    return failure(ERROR_CODES.VALIDATION_ERROR, 'id must be a positive integer', 400, context.respond);
  }

  const existing = await findOwnedRow(context, id);
  if (existing === null) {
    return failure(ERROR_CODES.NOT_FOUND, `No record ${id}`, 404, context.respond);
  }

  await context.grist.remove(id);
  return success(null, context.respond);
}

const ACTIONS: Record<string, (context: ActionContext) => Promise<Response>> = {
  fetch: listRows,
  add: addRow,
  edit: editRow,
  delete: deleteRow
};

const MEDIA_NAME = /^[a-z0-9][a-z0-9-]{0,63}\.(gif|webp|png|jpg)$/;

/**
 * `?action=media&name=<file>`: a file from the `MEDIA` KV namespace, for
 * licensed images that must not sit in a public repo. Same sign-in as data.
 */
async function serveMedia(env: Env, appId: string, name: string | null, respond: ResponseContext): Promise<Response> {
  if (name === null || !MEDIA_NAME.test(name)) {
    return failure(ERROR_CODES.VALIDATION_ERROR, 'name must be a file name like squat.gif', 400, respond);
  }
  const file = env.MEDIA ? await env.MEDIA.getWithMetadata<{ contentType?: string }>(`${appId}/${name}`, 'arrayBuffer') : null;
  if (file === null || file.value === null) {
    return failure(ERROR_CODES.NOT_FOUND, `No media ${name}`, 404, respond);
  }
  return new Response(file.value, {
    status: 200,
    headers: {
      ...respond.cors,
      'Content-Type': file.metadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=604800'
    }
  });
}

/** `GET /<appId>?action=...` with `Authorization: Bearer <session>`. */
export async function handleApi(
  request: Request,
  url: URL,
  env: Env,
  deps: Deps,
  waitUntil: WaitUntil
): Promise<Response> {
  const appId = url.pathname.replace(/^\/+|\/+$/g, '');
  const app = getApp(appId);
  const respond: ResponseContext = {
    cors: corsHeaders(request.headers.get('Origin'), app ? [...app.origins, ...devOrigins(env)] : []),
    schemaVersion: app?.schemaVersion ?? 1,
    now: deps.now
  };

  if (app === null) {
    return failure(ERROR_CODES.UNKNOWN_APP, `No app "${appId}"`, 404, respond);
  }
  if (request.method === 'OPTIONS') {
    return preflight(respond.cors);
  }
  if (request.method !== 'GET') {
    return failure(ERROR_CODES.METHOD_NOT_ALLOWED, 'Only GET is supported', 405, respond);
  }
  if (!env.SESSION_SECRET || !env.GRIST_API_KEY) {
    return failure(ERROR_CODES.MISCONFIGURED, 'Worker is missing SESSION_SECRET or GRIST_API_KEY', 500, respond);
  }

  const claims = await readSession(request.headers.get('Authorization'), appId, env.SESSION_SECRET, nowSeconds(deps));
  if (claims === null) {
    return failure(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue', 401, respond);
  }
  // Checked on every request, so removing an email from the list revokes its sessions.
  if (!allowedEmails(env, appId).has(claims.sub.toLowerCase())) {
    return failure(ERROR_CODES.FORBIDDEN, 'This account has no access to the app', 403, respond);
  }

  if (url.searchParams.get('action') === 'media') {
    return await serveMedia(env, appId, url.searchParams.get('name'), respond);
  }

  const action = ACTIONS[url.searchParams.get('action') ?? ''];
  if (action === undefined) {
    return failure(ERROR_CODES.UNSUPPORTED_ACTION, 'Unsupported action', 400, respond);
  }

  const tableName = url.searchParams.get('table');
  const spec = getTable(app, tableName);
  if (spec === null) {
    const message = tableName === null ? 'table is required' : `Unknown table ${tableName}`;
    return failure(ERROR_CODES.VALIDATION_ERROR, message, 400, respond);
  }

  const grist = gristTable({
    baseUrl: gristBaseUrl(env),
    apiKey: env.GRIST_API_KEY,
    documentId: app.documentId,
    tableId: spec.tableId,
    fetch: deps.fetch
  });

  const notify = spec.notify;
  const topic = notify ? ntfyTopic(env, appId) : null;
  const onAdded = (item: Record<string, unknown>): void => {
    if (notify && topic) {
      waitUntil(publishNotification(deps.fetch, notify, topic, item, appId));
    }
  };

  try {
    return await action({ spec, grist, claims, params: url.searchParams, respond, now: deps.now, onAdded });
  } catch (error) {
    console.error(JSON.stringify({ event: 'api_error', app: appId, error: String(error) }));
    if (error instanceof UpstreamError) {
      return failure(ERROR_CODES.UPSTREAM_ERROR, 'The data store did not answer', 502, respond);
    }
    return failure(ERROR_CODES.INTERNAL_ERROR, 'Unexpected error', 500, respond);
  }
}
