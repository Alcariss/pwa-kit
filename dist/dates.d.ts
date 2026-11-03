/**
 * Dates travel as `YYYY-MM-DD` strings in the user's local calendar.
 * `new Date('2026-09-01')` parses as UTC midnight and shows the previous day
 * west of Greenwich, and `toISOString()` shifts the day around midnight, so
 * neither is used here.
 */
export declare function toIsoDate(date?: Date): string;
/** Local midnight of a `YYYY-MM-DD` string, or null if it is not a real date. */
export declare function parseIsoDate(value: string): Date | null;
export declare function formatIsoDate(value: string, locale?: string, options?: Intl.DateTimeFormatOptions): string;
