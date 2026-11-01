/**
 * One entry per app. Adding an app is adding an entry here, creating its
 * Grist table, and setting its `ALLOWED_EMAILS_<APP_ID>` secret.
 *
 * The key is the app id and the last segment of its API URL:
 * `https://<worker>/notes` serves the `notes` entry.
 */

export type FieldType = 'text' | 'date' | 'number' | 'boolean';

export type FieldSpec = {
  type: FieldType;
  /** Grist column id; defaults to the field name. */
  column?: string;
  required?: boolean;
  /** For `text`; defaults to 10 000 characters. */
  maxLength?: number;
};

export type AppSpec = {
  /** Origins hosting the app. Sessions are only ever handed back to these. */
  origins: readonly string[];
  grist: {
    documentId: string;
    tableId: string;
    /** Grist sort expression over column ids, e.g. `-date,-created_at`. */
    sort?: string;
  };
  /** API field name -> column. Dates travel as `YYYY-MM-DD`; store them in Text columns. */
  fields: Readonly<Record<string, FieldSpec>>;
  /** Columns the worker stamps with ISO timestamps; `false` to skip. */
  timestamps?: { createdAt: string; updatedAt: string } | false;
  /** Column holding the signed-in email. Set it and each user sees only their own rows. */
  ownerColumn?: string;
  schemaVersion?: number;
};

const GITHUB_PAGES = 'https://alcariss.github.io';

export const APPS: Readonly<Record<string, AppSpec>> = {
  // The starter app in `template/`: Grist document "pwa-kit Notes".
  notes: {
    origins: [GITHUB_PAGES],
    grist: { documentId: 'nU5bcqehQxe3En3PvDhfgj', tableId: 'Notes', sort: '-date,-created_at' },
    fields: {
      date: { type: 'date', required: true },
      text: { type: 'text', required: true, maxLength: 5000 }
    },
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    ownerColumn: 'owner'
  }
};

export function getApp(appId: string): AppSpec | null {
  return Object.hasOwn(APPS, appId) ? (APPS[appId] ?? null) : null;
}
