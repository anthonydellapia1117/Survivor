import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The local backend calls the admin RPCs POSITIONALLY — `select fn($1,$2,…)`
 * with a bare array — so nothing in TypeScript, SQL or either test suite
 * notices if two arguments of the same type change places. Swap ccEmail and
 * phone in admin-localpg and every owner edit stores the phone number as the
 * CC address, which then goes into a real Cc header, and typecheck, lint,
 * vitest and the SQL suite all stay green.
 *
 * The Supabase path is insulated because it passes named parameters, so this
 * is the one caller carrying the risk — and it is the caller dev and any
 * hand-run script uses.
 *
 * This is a seam test: it reads the live migration and the live backend and
 * asserts they agree, which no test that exercises only one side can do.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const LOCALPG = join(process.cwd(), "src", "lib", "data", "admin-localpg.ts");

/** p_participation_status -> participationStatus */
const toCamel = (param: string): string =>
  param
    .replace(/^p_/, "")
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * The parameter list of the LAST migration that defines `fn`, in order.
 * Migrations are append-only and a later file can replace a function, so
 * reading a fixed filename would guard a superseded signature.
 */
function liveParams(fn: string): string[] {
  const defines = `create or replace function ${fn}(`;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .filter((sql) => sql.includes(defines));
  expect(files.length, `no migration defines ${fn}`).toBeGreaterThan(0);
  const sql = files[files.length - 1];
  const from = sql.lastIndexOf(defines) + defines.length;
  const end = sql.indexOf(")", from);
  expect(end, `could not find the end of ${fn}'s parameter list`).toBeGreaterThan(
    from,
  );
  return sql
    .slice(from, end)
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0])
    .filter((p) => p.startsWith("p_"));
}

/** The argument array the local backend passes to `select fn($1,…)`. */
function localpgArgs(fn: string): string[] {
  const src = readFileSync(LOCALPG, "utf8");
  const at = src.indexOf(`select ${fn}(`);
  expect(at, `admin-localpg does not call ${fn}`).toBeGreaterThan(-1);
  const open = src.indexOf("[", at);
  const close = src.indexOf("]", open);
  expect(close).toBeGreaterThan(open);
  return src
    .slice(open + 1, close)
    .split(",")
    .map((a) => a.trim().replace(/^a\./, ""))
    .filter((a) => a !== "");
}

describe("the local backend's positional args match the RPC signature", () => {
  // Every admin RPC admin-localpg calls positionally with a plain array.
  for (const fn of [
    "admin_update_owner",
    "admin_create_owner",
    "admin_add_entries",
  ]) {
    it(`${fn} — argument order matches parameter order`, () => {
      const params = liveParams(fn);
      const args = localpgArgs(fn);
      expect(
        args.length,
        `${fn} takes ${params.length} parameters but is called with ${args.length} arguments`,
      ).toBe(params.length);
      // Compared as whole lists rather than pairwise, so a failure prints the
      // transposition instead of just the first index that differs.
      expect(args).toEqual(params.map(toCamel));
    });
  }

  it("reads the LAST definition, so a replaced signature is what is checked", () => {
    // admin_update_owner was replaced twice on 2026-09-04 (58 added p_cc_email,
    // 59 restored the grant). Whichever file lands last is the live one.
    expect(liveParams("admin_update_owner")).toContain("p_cc_email");
  });
});
