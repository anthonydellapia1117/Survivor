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
