// The smoke check runs attended against production, inside the migration's
// transaction and rolled back to its savepoint. A person reads its output and
// routinely pastes it into a report or a PR, so it must never print a money
// total: the totals are admin-only (CLAUDE.md). It reads them and compares
// them, and raises only whether they moved.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const sql = () => readFileSync(here("../../scripts/db/smoke.sql"), "utf8");

// A raise ends at a semicolon, but two things put semicolons and quotes where
// a naive scan trips on them: a message string can CONTAIN a semicolon
// ("(% recruited);" in the first notice does), and a comment can contain a
// lone apostrophe ("the migration's transaction" in the header does, which
// pairs with the next real quote and swallows whole statements). So walk the
// text once, dropping comments and emptying literals, and only then look for
// statements. A format string prints no value on its own; only the arguments
// after it can, and those are what has to be read.
function normalize(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("--", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (text[i] === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] !== "'") {
          i += 1;
          continue;
        }
        if (text[i + 1] === "'") {
          i += 2;
          continue;
        }
        i += 1;
        break;
      }
      out += "''";
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

// EVERY raise, not the two severities this file happens to use today.
// WARNING, INFO, LOG and DEBUG all reach the log, and a bare `raise` defaults
// to EXCEPTION, so the statement is matched by its keyword and not by a list
// of levels that would silently exclude the rest.
const raises = (text: string) => normalize(text).match(/\braise\b[^;]*;/gi) ?? [];

// An allowlist, not a blocklist. Naming a few money-ish variables to forbid
// only holds while the money keeps those names: a total parked in
// v_amount_cents or v_total_cents would print and the guard would stay
// green. So the rule is inverted - these are the only values the check may
// print, and anything else fails until it is added here deliberately. The
// two booleans say WHETHER the totals moved; the totals themselves are not
// on the list and cannot be added without this line changing.
const PRINTABLE = new Set([
  "v_entries",
  "v_entries_after",
  "v_entries + 1",
  "v_recruited",
  "v_entry.entry_name",
  "v_team",
  "v_week",
  "v_due_moved",
  "v_paid_moved",
]);

// WHOLE arguments, not the identifiers inside them. Pulling out names that
// start with v_ finds nothing at all in `raise notice 'money %', 284000;` or
// in `raise notice 'money %', total_owed();`, so the allowlist passes over a
// printed total by matching nothing. Each complete argument has to BE on the
// list: a literal, a function call and an unfamiliar variable all fail alike.
function printed(raise: string): string[] {
  const at = raise.indexOf("''");
  // No format string means no arguments: a bare `raise;` re-raises the
  // current error and prints nothing new.
  if (at < 0) return [];
  const args = raise.slice(at + 2).replace(/;\s*$/, "");
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of args) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out
    .map((a) => a.trim().replace(/\s+/g, " ").toLowerCase())
    .filter((a) => a !== "");
}

describe("smoke check", () => {
  it("prints only the arguments on the allowlist, so no money total can reach the log", () => {
    const found = raises(sql());
    expect(found.length).toBeGreaterThan(0);
    const unlisted = found.flatMap(printed).filter((name) => !PRINTABLE.has(name));
    expect(unlisted).toEqual([]);
  });

  it("reads every raise through to its arguments", () => {
    // Guards the guard. Both hazards above, and then the real file: if the
    // scan ever stops short again, the assertion above passes against the
    // leak it exists for and this one fails instead.
    expect(raises("raise notice 'a; b', v_recruited;").join("")).toContain("v_recruited");
    expect(raises("-- the migration's note\nraise notice 'x', v_recruited;").join("")).toContain("v_recruited");
    expect(raises(sql()).some((r) => /\bv_recruited\b/.test(r))).toBe(true);
  });
});
