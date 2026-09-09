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
  // An emptied string literal. normalize() blanks literals, and a fixed
  // string cannot carry a runtime total, so a USING MESSAGE = 'some text' is
  // allowed. Numeric literals are NOT emptied and are not on this list: 284000
  // is exactly the shape a hardcoded total takes.
  "''",
]);

// WHOLE arguments, not the identifiers inside them. Pulling out names that
// start with v_ finds nothing at all in `raise notice 'money %', 284000;` or
// in `raise notice 'money %', total_owed();`, so the allowlist passes over a
// printed total by matching nothing. Each complete argument has to BE on the
// list: a literal, a function call and an unfamiliar variable all fail alike.
//
// What this covers is every value the statement HANDS to the log: the format
// arguments and the USING options. It cannot see a total someone types into
// the message text itself, because normalize() has emptied that literal by
// the time this runs - which is exactly why the totals are read into
// variables and compared, never formatted into a message.

// Split at commas that are not inside parentheses.
function topLevelCommas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
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
  return out;
}

function printed(raise: string): string[] {
  const body = raise.replace(/;\s*$/, "").replace(/^\s*raise\b/i, "");
  // A USING clause carries values with no format string in front of them:
  // `raise warning using message = v_due::text;` prints a total and has no
  // '' at all. Keying the whole parse off the format string returned nothing
  // for that, so the clause is split off first and its options are read as
  // the expressions they are.
  const usingAt = body.search(/\busing\b/i);
  const head = usingAt < 0 ? body : body.slice(0, usingAt);
  const usingClause = usingAt < 0 ? "" : body.slice(usingAt).replace(/^\s*using\b/i, "");

  const at = head.indexOf("''");
  // Nothing but a severity or a condition name before the clause: a bare
  // `raise;` re-raises the current error and hands the log no new value.
  const formatArgs = at < 0 ? [] : topLevelCommas(head.slice(at + 2));

  // option = expression, and the expression is what gets printed.
  const usingValues = usingClause === ""
    ? []
    : topLevelCommas(usingClause).map((opt) => opt.slice(opt.indexOf("=") + 1));

  return [...formatArgs, ...usingValues]
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
