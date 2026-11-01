export type GristRecord = {
  id: number;
  fields: Record<string, unknown>;
};

export type GristQuery = {
  /** Column id -> allowed values, e.g. `{ owner: ['me@example.com'] }`. */
  filter?: Record<string, readonly unknown[]>;
  sort?: string;
};

export class UpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

export type GristTable = {
  list(query?: GristQuery): Promise<GristRecord[]>;
  add(fields: Record<string, unknown>): Promise<number>;
  update(id: number, fields: Record<string, unknown>): Promise<void>;
  remove(id: number): Promise<void>;
};

export type GristTableOptions = {
  baseUrl: string;
  apiKey: string;
  documentId: string;
  tableId: string;
  fetch: typeof fetch;
  timeoutMs?: number;
};

export function gristTable(options: GristTableOptions): GristTable {
  const documentUrl = `${options.baseUrl}/api/docs/${encodeURIComponent(options.documentId)}`;
  const recordsUrl = `${documentUrl}/tables/${encodeURIComponent(options.tableId)}/records`;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call(method: string, url: string, body?: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await options.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new UpstreamError(`Grist ${method} failed: ${error instanceof Error ? error.message : String(error)}`, 0);
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new UpstreamError(`Grist ${method} returned HTTP ${response.status}: ${detail}`, response.status);
    }
    return response;
  }

  return {
    async list(query = {}) {
      const url = new URL(recordsUrl);
      if (query.filter) {
        url.searchParams.set('filter', JSON.stringify(query.filter));
      }
      if (query.sort) {
        url.searchParams.set('sort', query.sort);
      }
      const response = await call('GET', url.toString());
      return ((await response.json()) as { records: GristRecord[] }).records;
    },

    async add(fields) {
      const response = await call('POST', recordsUrl, { records: [{ fields }] });
      const created = (await response.json()) as { records: { id: number }[] };
      const id = created.records[0]?.id;
      if (id === undefined) {
        throw new UpstreamError('Grist did not return the new record id', response.status);
      }
      return id;
    },

    async update(id, fields) {
      await call('PATCH', recordsUrl, { records: [{ id, fields }] });
    },

    async remove(id) {
      await call('POST', `${documentUrl}/apply`, [['RemoveRecord', options.tableId, id]]);
    }
  };
}
