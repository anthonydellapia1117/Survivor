// The smoke check runs attended against production, inside the migration's
// transaction and rolled back to its savepoint. A person reads its output and
// routinely pastes it into a report or a PR, so it must never print a money
// total: the totals are admin-only (CLAUDE.md). It reads them and compares
// them, and raises only whether they moved.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const sql = () => unwrapDoBlocks(readFileSync(here("../../scripts/db/smoke.sql"), "utf8"));

// The whole PL/pgSQL body is itself a dollar-quoted string, `do $smoke$ ...
// $smoke$`. Unwrap it so the statements inside are read as SQL; every
// dollar-quoted run that remains is a literal, and PostgreSQL accepts one
// wherever a single-quoted one goes - `raise notice $msg$money 284000$msg$;`
// is a valid message with no quote in sight.
function unwrapDoBlocks(text: string): string {
  return text.replace(/\bdo\s+(\$[a-z_]?[a-z0-9_]*\$)([\s\S]*?)\1/gi, (_all, _tag, body) => body);
}

// SQL block comments nest, and one can carry an apostrophe just as a line
// comment can. Skipping to the first `*/` would stop inside a nested pair,
// so the depth is counted.
function blockComment(text: string, i: number): number | null {
  if (!text.startsWith("/*", i)) return null;
  let depth = 0;
  let j = i;
  while (j < text.length) {
    if (text.startsWith("/*", j)) {
      depth += 1;
      j += 2;
      continue;
    }
    if (text.startsWith("*/", j)) {
      depth -= 1;
      j += 2;
      if (depth === 0) return j;
      continue;
    }
    j += 1;
  }
  return text.length;
}

// Where a dollar-quoted literal starts here, and where its content ends.
function dollarQuote(text: string, i: number): { content: string; next: number } | null {
  // The tag grammar is a letter or underscore then letters, digits and
  // underscores, or nothing at all: $$, $msg$ and $msg1$ are all valid, and
  // a pattern that stops at letters misses the third.
  const open = /^\$[a-z_]?[a-z0-9_]*\$/i.exec(text.slice(i));
  if (!open) return null;
  const close = text.indexOf(open[0], i + open[0].length);
  const from = i + open[0].length;
  if (close < 0) return { content: text.slice(from), next: text.length };
  return { content: text.slice(from, close), next: close + open[0].length };
}

// A raise ends at a semicolon, but two things put semicolons and quotes where
// a naive scan trips on them: a message string can CONTAIN a semicolon
// ("(% recruited);" in the first notice does), and a comment can contain a
// lone apostrophe ("the migration's transaction" in the header does, which
// pairs with the next real quote and swallows whole statements). So walk the
// text once, dropping comments and emptying literals, and only then look for
// statements. A format string prints no value on its own; only the arguments
// after it can, and those are what has to be read.
// PostgreSQL's E'...' strings take backslash escapes, so the apostrophe in
// E'the migration\'s check' does NOT close the literal. Plain '...' strings do
// not take them: standard_conforming_strings has been on by default since 9.1
// and is on here, so a backslash in one is an ordinary character. Verified
// against postgres 16: E'the migration\'s check' and the lowercase e'...' form
// both return "the migration's check", while the same without the prefix is a
// syntax error, and U&'a\'b' is one too - only the E form needs this.
//
// The prefix has to START a token. `select 1 as typee'x'` is the identifier
// typee followed by a plain string, not an escape string, so the character
// before it must not be one an identifier can carry.
const IDENT = /[A-Za-z0-9_$]/;

// Where a single-quoted literal ends, and what it says. A doubled quote is an
// escaped quote in both forms; a backslash escapes the next character only in
// the E form. The escaped character is taken literally rather than decoded -
// this exists to pair the quotes correctly, and `\n` reading as "n" cannot
// turn a message into a money total or hide one.
function singleQuoted(text: string, quote: number, escapes: boolean) {
  let j = quote + 1;
  let content = "";
  while (j < text.length) {
    if (escapes && text[j] === "\\" && j + 1 < text.length) {
      content += text[j + 1];
      j += 2;
      continue;
    }
    if (text[j] !== "'") {
      content += text[j];
      j += 1;
      continue;
    }
    if (text[j + 1] === "'") {
      content += "'";
      j += 2;
      continue;
    }
    j += 1;
    break;
  }
  return { content, next: j, quoteAt: quote };
}

// A quoted literal starting at i, in either form. `quoteAt` is the opening
// QUOTE rather than the start of the token, because that is what the
// concatenation rule measures from: postgres joins E'due ' to a following
// '200' across a newline, but refuses to join 'due ' to a following E'200',
// and only the quote position tells those apart.
function stringAt(text: string, i: number) {
  const ch = text[i];
  if ((ch === "E" || ch === "e") && text[i + 1] === "'" && !IDENT.test(text[i - 1] ?? "")) {
    return singleQuoted(text, i + 1, true);
  }
  if (ch === "'") return singleQuoted(text, i, false);
  return null;
}

// What counts as the gap that joins two string constants. Not "whitespace":
// a `--` comment is whitespace for this purpose and a `/* */` comment is not.
// scan.l builds it as {horiz_whitespace}*{newline}{special_whitespace}*, and
// the {comment} in both of those is the `--` form only - a block comment is
// consumed by a separate start condition and never reaches the rule. Checked
// against postgres 16 rather than read off the grammar: `select 'due ' -- why`
// newline `'200'` returns "due 200", and so do the comment-after-the-newline,
// apostrophe-in-the-comment, tab, CRLF and three-fragment shapes, while every
// `/* why */` variant is a syntax error. So this is matched to the real
// grammar rather than to "whitespace with a newline", which missed the comment
// forms, or to "whitespace once comments are stripped", which would join a
// pair postgres refuses and fail on SQL that cannot exist.
const JOINS = /^[ \t\f\v]*(?:--[^\n\r]*)?[\n\r](?:[ \t\n\r\f\v]|--[^\n\r]*[\n\r])*$/;

// The same walk, keeping what the literals SAY. normalize() blanks them, so
// a total typed straight into a message - `raise notice 'money total 284000'`
// - leaves no argument to check and would pass a guard that only reads
// arguments. The text has to be looked at before it is thrown away.
function messageText(text: string): string[] {
  const out: string[] = [];
  // PostgreSQL joins two string constants separated by whitespace containing
  // a NEWLINE into one string: `raise notice 'due '\n'200';` emits "due 200".
  // Collected apart, neither half looks like money. `end` is where the last
  // literal stopped, so the gap before the next one can be measured.
  let end = -1;
  const push = (literal: string, from: number) => {
    const gap = end < 0 ? null : text.slice(end, from);
    if (gap !== null && out.length > 0 && JOINS.test(gap)) {
      out[out.length - 1] += literal;
      return;
    }
    out.push(literal);
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("--", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    const block = blockComment(text, i);
    if (block !== null) {
      i = block;
      continue;
    }
    const dollar = text[i] === "$" ? dollarQuote(text, i) : null;
    if (dollar) {
      push(dollar.content, i);
      end = dollar.next;
      i = dollar.next;
      continue;
    }
    const quoted = stringAt(text, i);
    if (quoted) {
      push(quoted.content, quoted.quoteAt);
      end = quoted.next;
      i = quoted.next;
      continue;
    }
    i += 1;
  }
  return out;
}

// A figure that reads as money. Shape alone is not enough: `due 200 cents`
// is a total and 200 is three digits, so context counts too - a number
// standing near a money word fails whatever its size. A bare week number or
// an entry count has neither the shape nor the company.
const MONEY_WORD = "(?:cents?|dollars?|due|paid|owed|balance|money|amount|totals?|remit\\w*)";
const MONEY_SHAPED = new RegExp(
  [
    "[$\\u00a3\\u20ac]\\s*\\d", // $2840
    "\\d[\\d,]{3,}", // 284000, 2,840
    "\\b\\d+\\.\\d{2}\\b", // 28.40
    `\\d[^.]{0,24}?${MONEY_WORD}`, // 200 cents
    `${MONEY_WORD}[^.]{0,24}?\\d`, // due is 200
  ].join("|"),
  "i",
);

function normalize(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("--", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    const block = blockComment(text, i);
    if (block !== null) {
      i = block;
      continue;
    }
    const dollar = text[i] === "$" ? dollarQuote(text, i) : null;
    if (dollar) {
      // Emptied to the same '' a single-quoted one becomes, so a format
      // string written this way is still seen as one and a semicolon inside
      // it cannot end the statement early.
      out += "''";
      i = dollar.next;
      continue;
    }
    const quoted = stringAt(text, i);
    if (quoted) {
      // The whole token, prefix included, becomes the same '' a plain literal
      // does, so a legitimate E'text' argument reads as an allowlisted '' and
      // not as the unknown value `E''`.
      out += "''";
      i = quoted.next;
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

// Why this file does not chase every remaining lexical form. A quoted
// identifier can carry an apostrophe too - `declare "it's" int` is valid, and
// this walker does not treat `"` as a quote - but the allowlist makes that
// fail closed rather than open: a mis-parse shifts the quotes and the
// arguments come out as junk, and junk is not on the list. Three shapes were
// run against postgres 16 to check that rather than assume it - one such
// identifier before a leaking raise, two of them (restoring quote parity, so
// the shift cancels), and one before a quote-free `raise using message =
// v_due::text` - and the guard failed on all three, reporting the leaked
// argument or the junk. So the forms handled above are handled because a
// mis-parse there can leave NO raise matchable at all, which is the one mode
// that passes silently; a shift that leaves the statement matchable catches
// itself.

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

  it("types no money figure into a message either", () => {
    // The arguments are checked above; this is the other half of the same
    // promise. A total hardcoded in the message text reaches the log just as
    // surely, and blanking literals to find statement ends is exactly what
    // would hide it.
    const typed = messageText(sql()).filter((t) => MONEY_SHAPED.test(t));
    expect(typed).toEqual([]);
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
