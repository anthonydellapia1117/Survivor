import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MarkResultsPlan } from "../../src/lib/lynne/mark-results";
import {
  BACKFILL_AUDIT_ACTION,
  backfillNote,
  backfillResults,
  LYNNE_RESULT_SOURCE,
  type BackfillDeps,
} from "../../scripts/results/lib/backfill";

// The Week 1 backfill: her Final Sheet was imported on 2026-09-15 with 0
// applies, before the derivation existed, and admin_apply_lynne_import
// cannot take the same sha256 twice. --backfill derives the same plan and
// applies each result through admin_set_result with result_source lynne,
// then writes ONE summary row on the import - and only when it wrote
// something, so a re-run that finds everything on file writes nothing.
//
// The loop is driven with a fake database and what came out is asserted;
// the CLI wiring is held by guards scoped to the one block each concerns.

const DERIVED: MarkResultsPlan = {
  applies: [
    { entry_id: "e1", result: "win" },
    { entry_id: "e2", result: "loss" },
    { entry_id: "e3", result: "loss" },
  ],
  byResult: { win: 1, loss: 2, bye: 0, missed: 0 },
  lossesByTeam: { LAC: 2 },
  alreadyApplied: 4,
  conflicts: [
    { type: "result_conflict", entryId: "e9", entryName: "Nicco E", lynne: { team: "Dallas", result: "loss (her mark: 1 loss/bye)" }, local: { team: "DAL", result: "win" } },
  ],
  unknown: 0,
  undecidable: 0,
  priorUnscored: 0,
  noCurrentPick: 0,
  cellDiffers: 0,
};

const INPUT = {
  week: 1,
  filename: "Football 2026-9.xlsx",
  sha256: "8b1806d4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  importId: "428c6f4b-c3b3-4c2b-b77b-e16fd3100016",
  derived: DERIVED,
  actor: "admin@example.test",
};

interface Fake {
  deps: BackfillDeps;
  results: Parameters<BackfillDeps["setResult"]>[0][];
  audits: Parameters<BackfillDeps["recordAudit"]>[0][];
}

function fakeDb(failOn: number | null = null): Fake {
  const results: Fake["results"] = [];
  const audits: Fake["audits"] = [];
  return {
    results,
    audits,
    deps: {
      async setResult(p) {
        if (failOn !== null && results.length === failOn) throw new Error("admin_set_result: connection lost");
        results.push(p);
      },
      async recordAudit(a) {
        audits.push(a);
        return 4800 + audits.length;
      },
    },
  };
}

describe("backfillResults", () => {
  it("applies every derived result through admin_set_result with result_source lynne, the week and the actor", async () => {
    const db = fakeDb();
    const out = await backfillResults(db.deps, INPUT);
    expect(LYNNE_RESULT_SOURCE).toBe("lynne");
    expect(db.results).toEqual([
      { entryId: "e1", week: 1, result: "win", resultSource: "lynne", actor: "admin@example.test" },
      { entryId: "e2", week: 1, result: "loss", resultSource: "lynne", actor: "admin@example.test" },
      { entryId: "e3", week: 1, result: "loss", resultSource: "lynne", actor: "admin@example.test" },
    ]);
    expect(out).toEqual({ written: 3, summaryAuditId: 4801 });
  });

  it("writes ONE summary row on the existing import, naming the week, the file, the sha256 prefix, the counts and that the import predates the derivation", async () => {
    const db = fakeDb();
    await backfillResults(db.deps, INPUT);
    expect(db.audits).toHaveLength(1);
    const a = db.audits[0];
    expect(a.action).toBe(BACKFILL_AUDIT_ACTION);
    expect(BACKFILL_AUDIT_ACTION).toBe("lynne_results_backfill");
    expect(a.targetTable).toBe("lynne_imports");
    expect(a.targetId).toBe(INPUT.importId);
    expect(a.actor).toBe("admin@example.test");
    expect(a.after).toMatchObject({
      week: 1,
      filename: "Football 2026-9.xlsx",
      written: 3,
      by_result: { win: 1, loss: 2, bye: 0, missed: 0 },
      losses_by_team: { LAC: 2 },
      already_applied: 4,
      conflicts: 1,
      // Every conflict with both values rides on this row: there is no
      // import row for the backfill's conflicts to be recorded with.
      conflict_rows: [
        {
          type: "result_conflict",
          entry_id: "e9",
          entry_name: "Nicco E",
          lynne: { team: "Dallas", result: "loss (her mark: 1 loss/bye)" },
          local: { team: "DAL", result: "win" },
        },
      ],
      result_source: "lynne",
    });
    expect(a.note).toBe(backfillNote(INPUT, 3));
    expect(a.note).toContain("week 1: 3 results derived from her fill marks on Football 2026-9.xlsx (sha256 8b1806d4)");
    expect(a.note).toContain("admin_set_result with result_source lynne");
    expect(a.note).toContain("1 win, 2 loss (LAC 2), 0 bye, 0 missed");
    expect(a.note).toContain("4 already on file, 1 conflicts not applied");
    expect(a.note).toContain("predates the derivation");
    // No em dash and no en dash in anything a human reads (the note is one).
    expect(a.note).not.toMatch(/[\u2013\u2014]/);
  });

  it("writes no summary row when nothing was written, so a re-run that finds everything on file is a no-op", async () => {
    const db = fakeDb();
    const out = await backfillResults(db.deps, { ...INPUT, derived: { ...DERIVED, applies: [], alreadyApplied: 7 } });
    expect(db.results).toEqual([]);
    expect(db.audits).toEqual([]);
    expect(out).toEqual({ written: 0, summaryAuditId: null });
  });

  it("never applies a conflict: only the applies are written, whatever the conflicts say", async () => {
    const db = fakeDb();
    await backfillResults(db.deps, INPUT);
    expect(db.results.map((r) => r.entryId)).not.toContain("e9");
  });

  it("leaves the picks already written when one fails mid-run, writes no summary, and lets the error out", async () => {
    // Each pick is its own audited transaction in the database; a re-run
    // derives the same results, finds these on file and applies the rest.
    const db = fakeDb(2);
    await expect(backfillResults(db.deps, INPUT)).rejects.toThrow("admin_set_result: connection lost");
    expect(db.results.map((r) => r.entryId)).toEqual(["e1", "e2"]);
    expect(db.audits).toEqual([]);
  });
});

/** The text of the balanced `{ ... }` that opens at the first `{` at or after `from`. */
function block(src: string, from: number): string {
  const open = src.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced block");
}

describe("the results command's --backfill wiring", () => {
  const cli = readFileSync("scripts/results/cli.ts", "utf8");

  it("prints what her marks give, and every conflict, BEFORE the confirm the operator answers", () => {
    const summary = cli.indexOf("derivedSummaryLine(week, plan.derived)");
    const conflicts = cli.indexOf("derivedConflictLines(plan.derived,");
    const confirmAt = cli.indexOf("await confirm(");
    expect(summary).toBeGreaterThan(0);
    expect(conflicts).toBeGreaterThan(0);
    expect(confirmAt).toBeGreaterThan(0);
    expect(summary).toBeLessThan(confirmAt);
    expect(conflicts).toBeLessThan(confirmAt);
  });

  it("resolves the backfill target through backfillImport under --backfill, which throws on a fresh sha256", () => {
    // backfillImport is the function that refuses a sha256 not yet imported
    // (tests/unit/results-select.test.ts); this holds that the command asks
    // it, under the flag, before anything is loaded or planned.
    const flag = cli.indexOf("if (args.backfill) {");
    expect(flag).toBeGreaterThan(0);
    const body = block(cli, flag);
    expect(body).toContain("backfillImportId = backfillImport(duplicate, week, filename);");
    expect(flag).toBeLessThan(cli.indexOf("buildResultsPlan("));
  });

  it("applies a backfill through backfillResults with the real setResult, and never through applyLynneImport", () => {
    const write = cli.indexOf("// ---- write");
    const branch = cli.indexOf("if (backfillImportId !== null) {", write);
    expect(branch).toBeGreaterThan(write);
    const body = block(cli, branch);
    expect(body).toContain("backfillResults(");
    expect(body).toContain("setResult: (p) => setResult(client, p)");
    expect(body).toContain("recordAudit: (a) => recordAudit(client, a)");
    expect(body).toContain("importId: backfillImportId");
    expect(body).not.toContain("applyLynneImport(");
    // Exactly one audit write path and one result write path in the branch:
    // the two deps lambdas. A second recordAudit call after backfillResults
    // would write a summary row on every run, re-runs that wrote nothing
    // included, and the deps assertion above could not see it (verifier,
    // 2026-09-15). Confirmed to FAIL with such a call added.
    expect(body.match(/recordAudit\(/g)).toHaveLength(1);
    expect(body.match(/setResult\(/g)).toHaveLength(1);
    expect(body.match(/backfillResults\(/g)).toHaveLength(1);
    // And the ordinary path is still the one RPC.
    const rest = cli.slice(branch + body.length);
    expect(rest).toContain("await applyLynneImport(client, {");
    expect(rest).not.toContain("backfillResults(");
  });

  it("names the path the derivation's conflicts are kept on, per run, when it prints them", () => {
    // The header differs by path (format.ts); the CLI has to hand it the path
    // it is on rather than one constant for both.
    expect(cli).toContain('derivedConflictLines(plan.derived, backfillImportId !== null ? "backfill" : "import")');
  });

  it("carries the derived applies into the score comparison, so it reads her mark's result against the score's", () => {
    // compareStoredToScores is handed the current picks with plan.applies
    // laid over them; plan.applies is now what the marks derived.
    expect(cli).toMatch(/const appliedResult = new Map\(plan\.applies\.map\(\(a\) => \[a\.entry_id, a\.result\]\)\);/);
    expect(cli).toMatch(/result: appliedResult\.get\(p\.entry_id\) \?\? p\.result/);
  });

  it("posts NEEDS ANTHONY for a derivation conflict, an unknown fill, an undecidable row and a pending prior", () => {
    expect(cli).toMatch(
      /derived !== null && \(derived\.conflicts\.length > 0 \|\| derived\.unknown > 0 \|\| derived\.undecidable > 0 \|\| derived\.priorUnscored > 0\)/,
    );
  });
});

/** The keys of the object literal passed as the second argument of rpc("<name>", {...}) in `src`, in source order. */
function rpcKeys(src: string, name: string): string[] {
  const call = `rpc("${name}", `;
  const at = src.indexOf(call);
  expect(at, `no rpc("${name}", ...) call in the source`).toBeGreaterThan(-1);
  const literal = block(src, at + call.length);
  return [...literal.matchAll(/^\s*([A-Za-z_]\w*)\s*:/gm)].map((m) => m[1]);
}

/** The parameter names of the LIVE admin_set_result, from the last migration that defines it. */
function liveSetResultParams(): string[] {
  const dir = join(process.cwd(), "supabase/migrations");
  const defines = "create or replace function admin_set_result(";
  const last = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .filter((sql) => sql.includes(defines))
    .pop();
  expect(last, "no migration defines admin_set_result").toBeDefined();
  const from = (last as string).indexOf(defines) + defines.length;
  const params = (last as string).slice(from, (last as string).indexOf(")", from));
  return params
    .split(",")
    .map((x) => x.trim().split(/\s+/)[0])
    .filter((x) => x.length > 0);
}

describe("the setResult seam names admin_set_result's parameters", () => {
  // The client is untyped, so a renamed key compiles, passes every other test
  // and is refused by PostgreSQL on the first call - nothing written, but the
  // backfill cannot run at all (verifier, 2026-09-15). The three copies of
  // the parameter list are held to one another: the script, the app's
  // caller, and the SQL that defines the function. Confirmed to FAIL with
  // p_result_source renamed in the script.
  const EXPECTED = ["p_entry_id", "p_week", "p_result", "p_result_source", "p_actor"];

  it("in scripts/lib/db.ts, exactly and in order", () => {
    expect(rpcKeys(readFileSync("scripts/lib/db.ts", "utf8"), "admin_set_result")).toEqual(EXPECTED);
  });

  it("the same five the app's caller passes", () => {
    expect(rpcKeys(readFileSync("src/lib/data/admin-supabase.ts", "utf8"), "admin_set_result")).toEqual(EXPECTED);
  });

  it("the same five the live SQL function declares", () => {
    expect(liveSetResultParams()).toEqual(EXPECTED);
  });
});
