import { describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  backupFilename,
  buildBackupSql,
  rowsToInserts,
  sqlLiteral,
} from "@/lib/backup";

describe("sqlLiteral", () => {
  it("escapes apostrophes by doubling — thedrick's picks survives", () => {
    expect(sqlLiteral("thedrick's picks")).toBe("'thedrick''s picks'");
  });

  it("handles null, numbers, booleans, and jsonb objects", () => {
    expect(sqlLiteral(null)).toBe("null");
    expect(sqlLiteral(2500)).toBe("2500");
    expect(sqlLiteral(true)).toBe("true");
    expect(sqlLiteral({ entry: "a'b", n: 1 })).toBe(
      `'{"entry":"a''b","n":1}'::jsonb`,
    );
  });

  it("serializes Date objects as timestamp strings, not jsonb", () => {
    expect(sqlLiteral(new Date("2026-09-08T16:00:00Z"))).toBe(
      "'2026-09-08T16:00:00.000Z'",
    );
  });
});

describe("rowsToInserts", () => {
  it("emits batched multi-row inserts with explicit columns", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: i,
      name: `E ${i}`,
    }));
    const stmts = rowsToInserts("entries", rows, 50);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toMatch(/^insert into entries \(id, name\) values\n/);
    expect(stmts[0]).toContain("(0, 'E 0')");
  });

  it("refuses unsafe identifiers", () => {
    expect(() => rowsToInserts("entries; drop", [{ a: 1 }])).toThrow();
  });
});

describe("buildBackupSql", () => {
  it("wraps a truncate + inserts + sequence fix in one transaction", () => {
    const sql = buildBackupSql(
      [
        { table: "owners", rows: [{ id: "x", first_name: "O'Brien" }] },
        { table: "audit_log", rows: [] },
      ],
      new Date("2026-08-25T12:00:00Z"),
    );
    expect(sql).toContain("begin;");
    expect(sql).toContain("truncate table owners, audit_log restart identity cascade;");
    expect(sql).toContain("'O''Brien'");
    expect(sql).toContain("pg_get_serial_sequence('audit_log', 'id')");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("generated 2026-08-25T12:00:00.000Z");
  });

  // The free-entry trigger tops the count up to FLOOR(recruited / ratio) after
  // every write to `entries`. A restore is only consistent at the END: the
  // rows arrive in 50-row batches ordered by created_at, which puts every
  // recruited entry BEFORE the AAA row it earned, so a batch boundary falling
  // between them mints a duplicate — which then collides with the backed-up
  // row on (owner_id, entry_index) and takes the whole restore down. Verified
  // against a real database: without this the restore dies on
  // entries_owner_id_entry_index_key. tests/sql/12_free_entries.sql replays
  // the same shape end to end.
  it("holds the free-entry trigger off until the whole roster has landed", () => {
    const sql = buildBackupSql(
      [
        { table: "owners", rows: [{ id: "o1", first_name: "A" }] },
        { table: "entries", rows: [{ id: "e1", owner_id: "o1" }] },
      ],
      new Date("2026-09-04T12:00:00Z"),
    );
    const at = (needle: string) => {
      const i = sql.indexOf(needle);
      expect(i, `missing from the restore script: ${needle}`).toBeGreaterThan(-1);
      return i;
    };
    // USER only — the foreign keys are internal triggers and must stay on.
    const off = at("alter table entries disable trigger user;");
    const rows = at("insert into entries");
    const on = at("alter table entries enable trigger user;");
    const settle = at("update entries set entry_name = entry_name where false;");
    const commit = at("commit;");
    expect(off).toBeLessThan(rows);
    expect(rows).toBeLessThan(on);
    // Re-enabled and settled BEFORE commit, so a backup taken from a database
    // that was itself short comes back at the rule rather than short again.
    expect(on).toBeLessThan(settle);
    expect(settle).toBeLessThan(commit);
    expect(sql).not.toContain("session_replication_role");
  });

  it("re-enables the trigger even when the dump carries no entries", () => {
    // An empty entries dump emits no insert at all; the enable must not be
    // tied to there being rows, or the restore leaves the rule switched off.
    const sql = buildBackupSql(
      [{ table: "entries", rows: [] }],
      new Date("2026-09-04T12:00:00Z"),
    );
    expect(sql).toContain("alter table entries disable trigger user;");
    expect(sql).toContain("alter table entries enable trigger user;");
  });
});

describe("backup coverage and filename", () => {
  it("covers every data table in the schema", () => {
    expect(BACKUP_TABLES.map((t) => t.table)).toEqual([
      "config",
      "weeks",
      "nfl_games",
      "owners",
      "entries",
      "picks",
      "payments",
      "lynne_imports",
      "archive_2025_entries",
      "archive_2025_weekly",
      "audit_log",
    ]);
  });

  it("timestamps the filename", () => {
    expect(backupFilename(new Date("2026-08-25T12:30:05Z"))).toBe(
      "survivor-data-backup-2026-08-25T12-30-05Z.sql",
    );
  });
});
