/**
 * Dates travel as `YYYY-MM-DD` strings in the user's local calendar.
 * `new Date('2026-09-01')` parses as UTC midnight and shows the previous day
 * west of Greenwich, and `toISOString()` shifts the day around midnight, so
 * neither is used here.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toIsoDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a `YYYY-MM-DD` string, or null if it is not a real date. */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }

  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(year, month - 1, day);
  return toIsoDate(date) === value ? date : null;
}

export function formatIsoDate(
  value: string,
  locale?: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
): string {
  const date = parseIsoDate(value);
  return date === null ? value : date.toLocaleDateString(locale, options);
}
