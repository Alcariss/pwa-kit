/**
 * One entry per app. Adding an app is adding an entry here, creating its
 * Grist tables, and setting its `ALLOWED_EMAILS_<APP_ID>` secret.
 *
 * The key is the app id and the last segment of its API URL:
 * `https://<worker>/notes` serves the `notes` entry. An app with several
 * tables picks one per request with `?table=<name>`.
 */

export type FieldType = 'text' | 'date' | 'number' | 'boolean';

export type FieldSpec = {
  type: FieldType;
  /** Grist column id; defaults to the field name. */
  column?: string;
  required?: boolean;
  /** For `text`; defaults to 10 000 characters. */
  maxLength?: number;
  /** For `text`: the only values accepted. */
  oneOf?: readonly string[];
  /** For `number`: the smallest value accepted. */
  min?: number;
};

export type TableSpec = {
  tableId: string;
  /** Grist sort expression over column ids, e.g. `-date,-created_at`. */
  sort?: string;
  /** API field name -> column. Dates travel as `YYYY-MM-DD`; store them in Text columns. */
  fields: Readonly<Record<string, FieldSpec>>;
  /** Columns the worker stamps with ISO timestamps; `false` to skip. */
  timestamps?: { createdAt: string; updatedAt: string } | false;
  /** Column holding the signed-in email. Set it and each user sees only their own rows. */
  ownerColumn?: string;
};

export type AppSpec = {
  /** Origins hosting the app. Sessions are only ever handed back to these. */
  origins: readonly string[];
  documentId: string;
  /** Table name (as the app sends it in `?table=`) -> Grist table. */
  tables: Readonly<Record<string, TableSpec>>;
  schemaVersion?: number;
};

const GITHUB_PAGES = 'https://alcariss.github.io';
const TIMESTAMPS = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

const SKLEPMISTR_CATEGORIES = ['water', 'food', 'hygiene', 'medicine', 'energy', 'other'] as const;

export const APPS: Readonly<Record<string, AppSpec>> = {
  // The starter app in `template/`: Grist document "pwa-kit Notes".
  notes: {
    origins: [GITHUB_PAGES],
    documentId: 'nU5bcqehQxe3En3PvDhfgj',
    tables: {
      notes: {
        tableId: 'Notes',
        sort: '-date,-created_at',
        fields: {
          date: { type: 'date', required: true },
          text: { type: 'text', required: true, maxLength: 5000 }
        },
        timestamps: TIMESTAMPS,
        ownerColumn: 'owner'
      }
    }
  },

  // Blackout supplies, shared by the whole family: Grist document "Sklepmistr".
  sklepmistr: {
    origins: [GITHUB_PAGES],
    documentId: '8wnBsuyyWnm3bxZXeJwLSU',
    tables: {
      items: {
        tableId: 'Items',
        sort: 'name',
        fields: {
          name: { type: 'text', required: true, maxLength: 200 },
          category: { type: 'text', required: true, oneOf: SKLEPMISTR_CATEGORIES },
          location: { type: 'text', maxLength: 100 },
          quantity: { type: 'number', required: true, min: 0 },
          packageSize: { type: 'number', column: 'package_size', min: 0 },
          dailyUse: { type: 'number', column: 'daily_use', min: 0 },
          expiry: { type: 'date' },
          note: { type: 'text', maxLength: 1000 },
          barcode: { type: 'text', maxLength: 14 }
        },
        timestamps: TIMESTAMPS
      },
      household: {
        tableId: 'Household',
        fields: {
          adults: { type: 'number', required: true, min: 0 },
          children: { type: 'number', required: true, min: 0 },
          toddlers: { type: 'number', required: true, min: 0 },
          targetDays: { type: 'number', column: 'target_days', required: true, min: 1 }
        },
        timestamps: TIMESTAMPS
      }
    }
  }
};

export function getApp(appId: string): AppSpec | null {
  return Object.hasOwn(APPS, appId) ? (APPS[appId] ?? null) : null;
}

/**
 * The table a request addresses: `?table=` when given, otherwise the app's
 * only table. Null when the name is unknown, or missing on a multi-table app.
 */
export function getTable(app: AppSpec, name: string | null): TableSpec | null {
  if (name === null) {
    const names = Object.keys(app.tables);
    return names.length === 1 ? (app.tables[names[0] as string] ?? null) : null;
  }
  return Object.hasOwn(app.tables, name) ? (app.tables[name] ?? null) : null;
}
