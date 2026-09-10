import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// An actor string is a claim about WHO DID IT, and the audit log is the only
// place that claim is ever checked. Two of those claims have been false here:
//
//   audit_log 653  actor "migration:20260909000064_all_deadlines_2pm_et"
//                  naming a migration file that did not exist. The SQL was
//                  typed at production by hand.
//   audit_log 681  actor "ops-routine", on a row `npm run ops` did not write:
//                  the Routine's agent called admin_stage_pending through its
//                  Supabase connector, with a kind the CLI cannot produce and
//                  a payload shaped nothing like the CLI's.
//
// Both are the same mistake: a row that names an automation as its author when
// the automation did not run. It is worse than an anonymous row, because it
// reads as evidence the machinery worked.
//
// This holds the repository to the two rules that would have caught them.

const ROOT = path.join(__dirname, "../..");

/**
 * Words that name a SCHEDULE or an AUTOMATION rather than a person or the
 * mechanism that actually performed the write. A trigger may say what rule it
 * is ("system (free-entry rule)") because the trigger genuinely wrote the row
 * in that transaction; a routine may not say it ran, because the row proves
 * nothing about whether it did.
 */
const NAMES_A_ROUTINE = /\b(routine|cron|tick|scheduled?|automation|autopilot|agent|bot)\b|^migration[:\s]/i;

/**
 * The only audit actor literals this repository is allowed to contain, each
 * with the reason it is honest. Adding one is a reviewed change here.
 */
const ALLOWED: Record<string, string> = {
  "system (free-entry rule)":
    "the mint_free_entries trigger, which really does write the row, inside the same transaction as the write that earned it",
  "dev-admin":
    "src/lib/auth.ts, the local development fallback identity; it never reaches production",
};

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const TS_FILES = [
  ...walk(path.join(ROOT, "scripts"), [".ts"]),
  ...walk(path.join(ROOT, "src"), [".ts", ".tsx"]),
];
const SQL_FILES = walk(path.join(ROOT, "supabase/migrations"), [".sql"]);

interface Found {
  file: string;
  line: number;
  value: string;
}

/** `actor: "x"` / `p_actor: 'x'` - an actor given as a LITERAL, in TypeScript. */
function tsActorLiterals(files: string[]): Found[] {
  const out: Found[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const m of text.matchAll(/\b(?:p_)?actor\s*:\s*(['"`])([^'"`]*)\1/g)) {
        out.push({ file: path.relative(ROOT, file), line: i + 1, value: m[2] });
      }
    });
  }
  return out;
}

/** The first value of an `insert into audit_log (actor, ...) values (...)`. */
function sqlActorLiterals(files: string[]): Found[] {
  const out: Found[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/into\s+audit_log\s*\([^)]*\)([\s\S]{0,400}?)values\s*\(\s*('([^']*)'|[A-Za-z_][\w.]*)/gi)) {
      const raw = m[3];
      if (raw === undefined) continue; // an identifier such as p_actor, not a literal
      out.push({ file: path.relative(ROOT, file), line: src.slice(0, m.index).split("\n").length, value: raw });
    }
  }
  return out;
}

const TS_FOUND = tsActorLiterals(TS_FILES);
const SQL_FOUND = sqlActorLiterals(SQL_FILES);
const ALL = [...TS_FOUND, ...SQL_FOUND];

describe("no audit actor in this repository names a routine", () => {
  it("finds the actor literals at all, EACH SCANNER SEPARATELY", () => {
    // If a scanner breaks, everything below passes vacuously. Asserting on the
    // combined list is not enough and this test used to do exactly that: the
    // TypeScript scanner could be made to return nothing and the SQL scanner's
    // one hit still satisfied it. So each side is named on its own, by the
    // literal that is actually in the tree today.
    expect(SQL_FOUND.map((f) => f.value), "the SQL scanner found nothing").toContain("system (free-entry rule)");
    expect(TS_FOUND.map((f) => f.value), "the TypeScript scanner found nothing").toContain("dev-admin");
    expect(SQL_FILES.length).toBeGreaterThan(20);
    expect(TS_FILES.length).toBeGreaterThan(50);
  });

  it("no literal names a schedule, a routine or an agent", () => {
    const offenders = ALL.filter((f) => NAMES_A_ROUTINE.test(f.value));
    expect(
      offenders.map((f) => `${f.file}:${f.line} ${JSON.stringify(f.value)}`),
      "an actor that names a routine claims the routine wrote the row; only the thing that actually performed the write may be named",
    ).toEqual([]);
  });

  it("every literal is one of the two that are allowed, by name and reason", () => {
    const unknown = ALL.filter((f) => !(f.value in ALLOWED));
    expect(
      unknown.map((f) => `${f.file}:${f.line} ${JSON.stringify(f.value)}`),
      "a new audit actor literal is a reviewed change to ALLOWED in this file",
    ).toEqual([]);
    for (const reason of Object.values(ALLOWED)) expect(reason.length).toBeGreaterThan(30);
  });

  it("the pattern actually rejects the two strings that were wrong in production", () => {
    // Break-proofing the matcher itself, not the tree: a pattern that matched
    // nothing would make the test above pass for the wrong reason.
    expect(NAMES_A_ROUTINE.test("ops-routine")).toBe(true);
    expect(NAMES_A_ROUTINE.test("migration:20260909000064_all_deadlines_2pm_et")).toBe(true);
    expect(NAMES_A_ROUTINE.test("system (scheduled sweep)")).toBe(true);
    expect(NAMES_A_ROUTINE.test("ops daily")).toBe(false);
    // And it does not reject what is legitimate.
    for (const ok of Object.keys(ALLOWED)) expect(NAMES_A_ROUTINE.test(ok)).toBe(false);
    expect(NAMES_A_ROUTINE.test("anthonydellapia@gmail.com")).toBe(false);
  });
});

describe("nothing under scripts/ hardcodes an actor at all", () => {
  // The commands sign in and then pass the actor adminClient() returned, which
  // is the admin's own address. A literal there is how a command starts
  // claiming to be something other than the person who ran it - and it is the
  // exact shape of audit_log 681, whose p_actor was a hand-chosen string.
  const inScripts = ALL.filter((f) => f.file.startsWith("scripts/"));

  it("passes the actor through, never a string", () => {
    expect(
      inScripts.map((f) => `${f.file}:${f.line} ${JSON.stringify(f.value)}`),
      "pass the actor from adminClient(), which is ADMIN_EMAIL; do not name the caller yourself",
    ).toEqual([]);
  });

  it("and the writers it calls take an actor argument rather than inventing one", () => {
    const db = readFileSync(path.join(ROOT, "scripts/lib/db.ts"), "utf8");
    expect(db).toContain("return { client, actor: email };");
    for (const fn of ["recordAudit", "stagePending", "submitPick"]) {
      expect(db, `${fn} must take the actor from its caller`).toMatch(
        new RegExp(`export async function ${fn}[\\s\\S]{0,600}?actor`),
      );
    }
  });
});
