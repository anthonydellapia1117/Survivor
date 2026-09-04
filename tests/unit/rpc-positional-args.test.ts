import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The local backend calls the admin RPCs POSITIONALLY — `select fn($1,$2,…)`
 * with a bare array — so nothing in TypeScript, SQL or either test suite
 * notices if two arguments of the same type change places. Transpose
 * `a.paidOn` and `a.venmoTxnId` in recordPayment and a payment is filed under
 * a bogus transaction id on a bogus date, on a ledger CLAUDE.md calls
 * append-only, while typecheck, lint, vitest and the SQL suite stay green.
 *
 * The Supabase path passes named parameters and is insulated, so this is the
 * one caller carrying the risk — and it is the caller dev and any hand-run
 * script uses.
 *
 * This is a seam test: it reads the live migration and the live backend and
 * asserts they agree, which no test exercising only one side can do. It
 * enumerates the call sites from the file rather than listing them by hand,
 * so an RPC added tomorrow is covered the day it is written — the first
 * version of this file guarded three of nineteen while claiming to cover all.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const LOCALPG = join(process.cwd(), "src", "lib", "data", "admin-localpg.ts");
const SOURCE = readFileSync(LOCALPG, "utf8");

/** p_participation_status -> participationStatus */
const toCamel = (param: string): string =>
  param
    .replace(/^p_/, "")
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** The text between `open` and its matching close paren. */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced parentheses from index ${open}`);
}

/** Split on commas at depth 0, so `numeric(12,2)` stays one item. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((p) => p.trim()).filter((p) => p !== "");
}

/**
 * The parameter names of the LAST migration that defines `fn`, in order.
 * Migrations are append-only and a later file can replace a function, so a
 * fixed filename would guard a superseded signature.
 */
function liveParams(fn: string): string[] {
  // Both spellings, and the public-qualified form: admin_mark_new_entries_sent
  // ships as a plain `create function`, so matching only `create or replace`
  // silently found no definition and reported a non-existent problem.
  const markers = [
    `create or replace function ${fn}(`,
    `create or replace function public.${fn}(`,
    `create function ${fn}(`,
    `create function public.${fn}(`,
  ];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .filter((sql) => markers.some((m) => sql.includes(m)));
  if (files.length === 0) return [];
  const sql = files[files.length - 1];
  const at = markers
    .map((m) => ({ m, i: sql.lastIndexOf(m) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => b.i - a.i)[0];
  const open = at.i + at.m.length - 1;
  // Strip SQL line comments first. admin_apply_lynne_import documents one
  // parameter with `-- [{entry_id, result}] pre-screened: matched, no
  // variance`, and the comma inside that comment split the parameter after it
  // in half — so the list came back one short and the guard reported a
  // transposition that did not exist.
  const params = balanced(sql, open).replace(/--[^\n]*/g, "");
  return splitTopLevel(params)
    .map((p) => p.split(/\s+/)[0])
    .filter((p) => p.startsWith("p_"));
}

/** The text between `open` and its matching close bracket. */
function balancedBracket(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced brackets from index ${open}`);
}

/** Every `select fn($1,…)` in the local backend, with the array it passes. */
function positionalCalls(): { fn: string; args: string[]; raw: string }[] {
  const calls: { fn: string; args: string[]; raw: string }[] = [];
  // Both call shapes. admin_deadline_sweep returns a set and is called as
  // `select * from admin_deadline_sweep($1,…)`; a regex anchored on
  // `select admin_` skipped it silently, which is the same failure this file
  // was written to stop — a guard that looks like coverage and is not.
  const re = /select (?:\* from )?(admin_[a-z_]+)\(\$1[^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SOURCE)) !== null) {
    const open = SOURCE.indexOf("[", m.index);
    if (open === -1) continue;
    const raw = balancedBracket(SOURCE, open);
    calls.push({ fn: m[1], raw, args: splitTopLevel(raw) });
  }
  return calls;
}

const CALLS = positionalCalls();

describe("the local backend's positional args match the RPC signature", () => {
  it("finds EVERY positional call site, not just most of them", () => {
    // A loose lower bound is how the set-returning call went missing: the
    // count still cleared the bar, so nothing said a call was unguarded.
    // Count the call sites independently of the parser that extracts them.
    const declared = SOURCE.match(/admin_[a-z_]+\(\$1/g) ?? [];
    expect(CALLS.map((c) => c.fn).sort()).toEqual(
      declared.map((d) => d.replace("($1", "")).sort(),
    );
    expect(CALLS.length).toBeGreaterThan(10);
  });

  for (const { fn, args, raw } of CALLS) {
    const params = liveParams(fn);
    // Names line up only where the SQL parameter and the TS field agree.
    // Several predate any such convention (admin_merge_owner takes p_source
    // for a.sourceId, admin_update_week p_early for a.earlyDeadlineAt), and
    // admin_apply_lynne_import passes JSON.stringify(...) rather than a bare
    // field. Those still get the arity check, which is what catches a
    // dropped or duplicated argument; renaming them to buy the stronger
    // check is a change to shipped RPCs, not to this test.
    const byName =
      args.every((a) => /^a\.[A-Za-z0-9_]+$/.test(a)) &&
      params.length === args.length &&
      params.every((p) => args.includes(`a.${toCamel(p)}`));

    it(`${fn} — ${byName ? "argument order matches parameter order" : "argument count matches (names differ by convention)"}`, () => {
      expect(params.length, `no migration defines ${fn}`).toBeGreaterThan(0);
      expect(
        args.length,
        `${fn} takes ${params.length} parameters but is called with ${args.length} arguments: ${raw.trim()}`,
      ).toBe(params.length);
      if (byName) {
        // Whole lists rather than pairwise, so a failure prints the
        // transposition instead of just the first index that differs.
        expect(args.map((a) => a.replace(/^a\./, ""))).toEqual(
          params.map(toCamel),
        );
      }
    });
  }

  it("checks the money path by NAME, not just by count", () => {
    // A transposition of a.paidOn and a.venmoTxnId files a payment under a
    // bogus transaction id on a bogus date and keeps the same arity, so the
    // count check alone would not see it. This is the one that has to be
    // order-checked.
    const call = CALLS.find((c) => c.fn === "admin_record_payment");
    expect(call, "admin_record_payment is not called positionally any more").toBeDefined();
    expect(call!.args.map((a) => a.replace(/^a\./, ""))).toEqual(
      liveParams("admin_record_payment").map(toCamel),
    );
  });

  it("checks the owner path by NAME too", () => {
    const call = CALLS.find((c) => c.fn === "admin_update_owner");
    expect(call).toBeDefined();
    expect(call!.args.map((a) => a.replace(/^a\./, ""))).toEqual(
      liveParams("admin_update_owner").map(toCamel),
    );
  });

  it("and the entry path, where the gift fields sit after lynneNumber", () => {
    const call = CALLS.find((c) => c.fn === "admin_update_entry");
    expect(call).toBeDefined();
    expect(call!.args.map((a) => a.replace(/^a\./, ""))).toEqual(
      liveParams("admin_update_entry").map(toCamel),
    );
  });

  it("reads the LAST definition, so a replaced signature is what is checked", () => {
    // admin_update_owner has been redefined four times: 58 added p_cc_email,
    // 59 restored the grant it dropped, 62 retired the column again. Reading
    // any definition but the last would still see p_cc_email, so its ABSENCE
    // is the proof — and it is the stronger direction, because a stale read
    // here means every name-order assertion above is checking a dead shape.
    expect(liveParams("admin_update_owner")).not.toContain("p_cc_email");
    expect(liveParams("admin_update_owner")).toContain("p_phone");

    // Same for entries: 60 introduced the gift fields, 61 replaced the whole
    // function again to fix name_is_default.
    expect(liveParams("admin_update_entry")).toContain("p_player_email");
  });
});
