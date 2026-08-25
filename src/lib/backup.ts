// Data-only backup: every table needed to rebuild the pool from a fresh
// database. The SCHEMA lives in supabase/migrations (the repo); this file
// captures the DATA as one restorable SQL script. Restore procedure (also
// written into the file header):
//   1. Create a fresh Supabase project (or empty database).
//   2. Apply every file in supabase/migrations, in order.
//   3. Run this backup file in the SQL editor (as postgres). One step —
//      it truncates the data tables and re-inserts everything.
// The admin auth login is Supabase-managed and not part of the database
// data; recreate it from the dashboard (one user).

export interface TableDump {
  table: string;
  rows: Record<string, unknown>[];
}

/** Insert order respects foreign keys; picks/payments self-references are
 *  satisfied by created_at ordering (corrections/supersedes come later). */
export const BACKUP_TABLES: { table: string; orderBy: string | null }[] = [
  { table: "config", orderBy: null },
  { table: "weeks", orderBy: "week" },
  { table: "nfl_games", orderBy: "id" },
  { table: "owners", orderBy: "created_at" },
  { table: "entries", orderBy: "created_at" },
  { table: "picks", orderBy: "submitted_at" },
  { table: "payments", orderBy: "created_at" },
  { table: "lynne_imports", orderBy: "imported_at" },
  { table: "archive_2025_entries", orderBy: "lynne_number" },
  { table: "archive_2025_weekly", orderBy: "week" },
  { table: "audit_log", orderBy: "id" },
];

export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) {
    // node-postgres returns timestamptz/date columns as Date objects.
    return sqlString(v.toISOString());
  }
  if (typeof v === "object") {
    // jsonb columns (audit before/after, lynne_imports rows/variances).
    return `${sqlString(JSON.stringify(v))}::jsonb`;
  }
  return sqlString(String(v));
}

function sqlString(s: string): string {
  // standard_conforming_strings is on: doubling single quotes suffices.
  return `'${s.replaceAll("'", "''")}'`;
}

function quoteIdent(s: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier: ${s}`);
  return s;
}

export function rowsToInserts(
  table: string,
  rows: Record<string, unknown>[],
  batchSize = 50,
): string[] {
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]).map(quoteIdent);
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = chunk
      .map((r) => `  (${cols.map((c) => sqlLiteral(r[c])).join(", ")})`)
      .join(",\n");
    out.push(
      `insert into ${quoteIdent(table)} (${cols.join(", ")}) values\n${values};`,
    );
  }
  return out;
}

export function buildBackupSql(dumps: TableDump[], generatedAt: Date): string {
  const counts = dumps
    .map((d) => `--   ${d.table}: ${d.rows.length} rows`)
    .join("\n");
  const tables = dumps.map((d) => quoteIdent(d.table)).join(", ");
  const parts: string[] = [
    `-- Survivor 2026 data backup — generated ${generatedAt.toISOString()}`,
    `-- RESTORE: fresh database -> apply supabase/migrations in order ->`,
    `-- run this whole file as postgres (SQL editor). It truncates the data`,
    `-- tables and re-inserts everything below in one transaction.`,
    `-- The admin auth login is Supabase-managed; recreate it in the`,
    `-- dashboard (Authentication -> Add user) with the admin email.`,
    `--`,
    counts,
    ``,
    `begin;`,
    ``,
    `truncate table ${tables} restart identity cascade;`,
    ``,
  ];
  for (const d of dumps) {
    parts.push(`-- ---- ${d.table} (${d.rows.length}) ----`);
    parts.push(...rowsToInserts(d.table, d.rows));
    parts.push("");
  }
  parts.push(
    `select setval(pg_get_serial_sequence('audit_log', 'id'),`,
    `              greatest((select coalesce(max(id), 1) from audit_log), 1));`,
    ``,
    `commit;`,
    ``,
  );
  return parts.join("\n");
}

export function backupFilename(generatedAt: Date): string {
  const stamp = generatedAt
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replaceAll(":", "-");
  return `survivor-data-backup-${stamp}.sql`;
}
