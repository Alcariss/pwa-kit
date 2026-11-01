import { describe, expect, it } from 'vitest';
import { toNote } from './notes';

describe('toNote', () => {
  it('reads a row from the worker', () => {
    const row = { id: '3', date: '2026-11-01', text: 'Hi', createdAt: 'c', updatedAt: 'u', extra: true };

    expect(toNote(row)).toEqual({ id: '3', date: '2026-11-01', text: 'Hi', createdAt: 'c', updatedAt: 'u' });
  });

  it('rejects a row whose shape changed', () => {
    expect(() => toNote({ id: 3 })).toThrow('id is not a string');
  });
});
