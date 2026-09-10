import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// scripts/ops/snapshot.ts is the one read behind `npm run ops -- daily`, and it
// runs where nobody watches it. A wrong column name there is neither a type
// error nor a lint error - PostgREST answers 400 at run time and the whole
// daily report is a stack trace. tests/sql/17_ops_snapshot_reads.sql asserts
// the columns exist; this holds that list to what the file actually selects,
// so the two cannot drift apart into a pair of green tests guarding nothing.

const SNAPSHOT = readFileSync("scripts/ops/snapshot.ts", "utf8");
/** Comments stripped, the same way tests/unit/ops.test.ts reads source: the file
 *  EXPLAINS why it uses no embed, and the explanation must not fail the check. */
const CODE = SNAPSHOT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const SQL = readFileSync("tests/sql/17_ops_snapshot_reads.sql", "utf8");

/** Every `.from("x") ... .select("a, b")` pair in the snapshot, as rel.col strings. */
function readsInSnapshot(): Set<string> {
  const out = new Set<string>();
  const re = /\.from\("([a-z_]+)"\)([\s\S]*?)\.select\("([^"]+)"\)/g;
  for (const m of SNAPSHOT.matchAll(re)) {
    const [, rel, between, cols] = m;
    // A `.from` whose own `.select` is further away than the next `.from` would
    // pair the wrong two; there is no such shape in the file and this catches
    // one being introduced.
    expect(between, `${rel}: a .from was matched to a distant .select`).not.toMatch(/\.from\("/);
    for (const c of cols.split(",")) out.add(`${rel}.${c.trim()}`);
  }
  return out;
}

/** The (rel, col) pairs the SQL suite asserts. */
function pairsInSql(): Set<string> {
  const block = /with want\(rel, col\) as \(values([\s\S]*?)\n  \)/.exec(SQL);
  expect(block, "the SQL suite must declare its want(rel, col) list").not.toBeNull();
  const out = new Set<string>();
  for (const m of block![1].matchAll(/\('([a-z_]+)','([a-z_0-9]+)'\)/g)) out.add(`${m[1]}.${m[2]}`);
  return out;
}

describe("the daily snapshot's reads", () => {
  it("selects something from every table it names", () => {
    const reads = readsInSnapshot();
    expect(reads.size).toBeGreaterThan(20);
  });

  it("is covered column for column by the SQL suite", () => {
    const missing = [...readsInSnapshot()].filter((r) => !pairsInSql().has(r)).sort();
    expect(missing, "these columns are read but never asserted to exist").toEqual([]);
  });

  it("uses no PostgREST embed - every read in scripts/ is flat", () => {
    // `owners!inner(...)` was the first embed in this repo and would have been
    // the only untested query shape in a job nobody watches run.
    expect(CODE).not.toMatch(/!inner|!left/);
  });

  it("reads payments.paid_on, never paid_at", () => {
    expect(CODE).not.toMatch(/paid_at/);
    expect(CODE).toMatch(/paid_on/);
  });

  it("takes the owner's name from owners, not from v_owner_finance", () => {
    const finance = /\.from\("v_owner_finance"\)[\s\S]*?\.select\("([^"]+)"\)/.exec(SNAPSHOT)?.[1] ?? "";
    expect(finance).not.toMatch(/first_name|last_name|email/);
  });

  it("derives the recipient set live, never from a saved list", () => {
    // A stale list sent one morning's message to 27 addresses instead of 39.
    expect(SNAPSHOT).toMatch(/recipientAddresses = Array\.from\(\s*\n?\s*new Set\(/);
    expect(SNAPSHOT).toMatch(/expectedRosterAddresses: config\.expectedRosterAddresses/);
  });

  it("pages her sheet rather than taking PostgREST's capped first page", () => {
    // Her sheet is 1,319 rows and the cap is 1,000: one read silently returns
    // a short roster, and every reporter downstream believes it.
    expect(SNAPSHOT).toMatch(/fetchAllPages<[\s\S]*?>\(async \(from, to\)/);
    expect(SNAPSHOT).toMatch(/\.range\(from, to\)/);
    expect(SNAPSHOT).not.toMatch(/\.range\(\s*\d+\s*,\s*\d+\s*\)/);
  });
});
