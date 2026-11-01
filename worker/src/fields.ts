import type { FieldSpec, TableSpec } from './apps.js';
import type { GristRecord } from './grist.js';

export type ParseResult =
  | { ok: true; columns: Record<string, unknown> }
  | { ok: false; message: string };

type ValueResult = { ok: true; value: unknown } | { ok: false; message: string };

/** Query parameters that are not record fields. */
const RESERVED_PARAMS = new Set(['action', 'id', 'table', 'token']);
const DEFAULT_MAX_TEXT_LENGTH = 10_000;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseValue(name: string, spec: FieldSpec, raw: string): ValueResult {
  if (raw.trim() === '') {
    if (spec.required) {
      return { ok: false, message: `${name} is required` };
    }
    return { ok: true, value: spec.type === 'text' ? raw : null };
  }

  switch (spec.type) {
    case 'text': {
      const maxLength = spec.maxLength ?? DEFAULT_MAX_TEXT_LENGTH;
      if (raw.length > maxLength) {
        return { ok: false, message: `${name} is longer than ${maxLength} characters` };
      }
      if (spec.oneOf && !spec.oneOf.includes(raw)) {
        return { ok: false, message: `${name} must be one of ${spec.oneOf.join(', ')}` };
      }
      return { ok: true, value: raw };
    }
    case 'date':
      return isRealDate(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: `${name} must be a date as YYYY-MM-DD` };
    case 'number': {
      const value = Number(raw.replace(',', '.'));
      if (!Number.isFinite(value)) {
        return { ok: false, message: `${name} must be a number` };
      }
      if (spec.min !== undefined && value < spec.min) {
        return { ok: false, message: `${name} must be at least ${spec.min}` };
      }
      return { ok: true, value };
    }
    case 'boolean':
      if (raw === 'true' || raw === '1') {
        return { ok: true, value: true };
      }
      if (raw === 'false' || raw === '0') {
        return { ok: true, value: false };
      }
      return { ok: false, message: `${name} must be true or false` };
  }
}

/**
 * Validates request parameters against the table's fields and returns Grist
 * columns. `create` needs every required field; `update` takes any subset.
 */
export function parseInput(table: TableSpec, params: URLSearchParams, mode: 'create' | 'update'): ParseResult {
  for (const name of params.keys()) {
    if (!RESERVED_PARAMS.has(name) && !Object.hasOwn(table.fields, name)) {
      return { ok: false, message: `Unknown field ${name}` };
    }
  }

  const columns: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(table.fields)) {
    const raw = params.get(name);
    if (raw === null) {
      if (mode === 'create' && spec.required) {
        return { ok: false, message: `${name} is required` };
      }
      continue;
    }

    const parsed = parseValue(name, spec, raw);
    if (!parsed.ok) {
      return parsed;
    }
    columns[spec.column ?? name] = parsed.value;
  }

  if (mode === 'update' && Object.keys(columns).length === 0) {
    return { ok: false, message: 'Nothing to update' };
  }
  return { ok: true, columns };
}

function readValue(spec: FieldSpec, value: unknown): unknown {
  switch (spec.type) {
    case 'text':
      return value === null || value === undefined ? '' : String(value);
    case 'date':
      // A Grist Date column returns seconds since the epoch.
      if (typeof value === 'number') {
        return new Date(value * 1000).toISOString().slice(0, 10);
      }
      return value === null || value === undefined ? '' : String(value);
    case 'number':
      return typeof value === 'number' ? value : null;
    case 'boolean':
      return value === true;
  }
}

/** A Grist record as the app sees it: `id`, the configured fields, and timestamps. */
export function toItem(table: TableSpec, record: GristRecord): Record<string, unknown> {
  const item: Record<string, unknown> = { id: String(record.id) };
  for (const [name, spec] of Object.entries(table.fields)) {
    item[name] = readValue(spec, record.fields[spec.column ?? name]);
  }
  if (table.timestamps) {
    item.createdAt = String(record.fields[table.timestamps.createdAt] ?? '');
    item.updatedAt = String(record.fields[table.timestamps.updatedAt] ?? '');
  }
  return item;
}
