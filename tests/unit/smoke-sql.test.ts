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

const raises = (text: string) =>
  normalize(text).match(/raise\s+(?:notice|exception)[^;]*;/gi) ?? [];

// Any money-ish variable, not only the four spelled out today: a v_due_cents
// added later leaks exactly the same. Only the two booleans may be printed.
const MONEY = /\bv_[a-z_]*(?:due|paid)[a-z_]*\b/gi;
const PRINTABLE = new Set(["v_due_moved", "v_paid_moved"]);

describe("smoke check", () => {
  it("never prints a money total in a notice or an exception", () => {
    const found = raises(sql());
    expect(found.length).toBeGreaterThan(0);
    const leaked = found
      .flatMap((r) => r.match(MONEY) ?? [])
      .filter((name) => !PRINTABLE.has(name.toLowerCase()));
    expect(leaked).toEqual([]);
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
