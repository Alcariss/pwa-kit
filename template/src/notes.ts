import type { RequestParams } from '@alcariss/pwa-kit';

/** Mirrors the `notes` entry in the worker's `apps.ts`. */
export type Note = {
  id: string;
  date: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type NoteInput = {
  date: string;
  text: string;
};

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`Note row: ${key} is not a string`);
  }
  return value;
}

export function toNote(row: unknown): Note {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Note row is not an object');
  }
  const record = row as Record<string, unknown>;
  return {
    id: readString(record, 'id'),
    date: readString(record, 'date'),
    text: readString(record, 'text'),
    createdAt: readString(record, 'createdAt'),
    updatedAt: readString(record, 'updatedAt')
  };
}

export function toNoteParams(input: NoteInput): RequestParams {
  return { date: input.date, text: input.text };
}
