import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REPORTERS, renderDaily, runReporters, type DailyOutcome } from "../../scripts/ops/daily";
import type { OpsSnapshot } from "../../scripts/ops/reporters/types";
import { validateOpsConfig } from "../../scripts/ops/lib/config";

const NOW = new Date("2026-09-10T14:00:00Z");

function snapshot(over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  return {
    now: NOW,
    weeks: [{ week: 1, earlyDeadlineAt: "2026-09-09T18:00:00Z", lateDeadlineAt: "2026-09-11T18:00:00Z" }],
    games: [{ week: 1, dayOfWeek: "Sunday", homeTeam: "PHI", awayTeam: "DAL", kickoffAt: "2026-09-13T17:00:00Z" }],
    entries: [],
    picks: [],
    herRows: [],
    herSheet: null,
    herMail: [],
    owners: [],
    payments: [],
    recipientAddresses: [],
    expectedRosterAddresses: 0,
    freeEntryCount: 0,
    recruitedCount: 0,
    lynneRateCents: 2500,
    ...over,
  };
}

describe("the daily entry point", () => {
  it("runs all six reporters", () => {
    expect(REPORTERS.map((r) => r.name)).toEqual([
      "roster-integrity", "pick-gap", "deadline-close", "lynne-echo", "sheet-watch", "money-watch",
    ]);
  });

  it("leads with roster-integrity, because the count gate stops every message", () => {
    // A mismatch there means nobody is being mailed at all, so it is not a
    // line to find at the bottom of six reports.
    expect(REPORTERS[0].name).toBe("roster-integrity");
  });

  it("gives every reporter the same instant", () => {
    const seen: Date[] = [];
    const s = snapshot();
    for (const r of REPORTERS) {
      // The contract is that a reporter reads s.now and never the clock; if one
      // took its own the two would drift across a deadline mid-run.
      expect(() => r.run({ ...s, now: (seen.push(s.now), s.now) })).not.toThrow();
    }
    expect(new Set(seen.map((d) => d.getTime())).size).toBe(1);
  });

  it("keeps the other five when one reporter throws", () => {
    const s = snapshot();
    // A snapshot missing `weeks` entirely is the shape a broken loader hands
    // over; whatever any single reporter does with it, the run still reports.
    const out = runReporters({ ...s, weeks: null as never });
    expect(out).toHaveLength(6);
    for (const o of out) {
      expect(o.lines.length, `${o.name} produced no lines`).toBeGreaterThan(0);
      if (o.error) {
        expect(o.lines[0]).toBe("NEEDS ANTHONY");
        expect(o.lines[1]).toContain("could not run");
        expect(o.summary).toBe(`${o.name}: FAILED`);
      }
    }
  });

  it("is NO ACTION per reporter on an empty pool, never silence", () => {
    const out = runReporters(snapshot());
    for (const o of out) {
      expect(o.lines.length, `${o.name} said nothing at all`).toBeGreaterThan(0);
    }
  });

  it("renders one titled block per reporter", () => {
    const outcomes: DailyOutcome[] = [
      { name: "a", lines: ["NO ACTION"], summary: "a: NO ACTION" },
      { name: "b", lines: ["NEEDS ANTHONY", "x"], summary: "b: 1 for Anthony" },
    ];
    const lines = renderDaily(outcomes, NOW);
    expect(lines[0]).toContain(NOW.toISOString());
    expect(lines).toContain("## a");
    expect(lines).toContain("## b");
    expect(lines).toContain("NO ACTION");
  });
});

describe("the ops CLI's two entry points", () => {
  const cli = readFileSync("scripts/ops/cli.ts", "utf8");

  it("accepts daily, hourly, and tick as the old name for hourly", () => {
    expect(cli).toMatch(/x === TICK_ALIAS\) target = "hourly"/);
    expect(cli).toMatch(/x === "hourly" \|\| x === "daily"/);
  });

  it("routes daily to the reporters and never to the job dispatcher", () => {
    expect(cli).toMatch(/if \(args\.target === "daily"\) \{\s*\n\s*await runDailyReport\(now, args\.dryRun\);\s*\n\s*return;/);
  });

  it("still sends only what the config allows - daily added no send path", () => {
    expect(cli).not.toMatch(/messages\.send/);
    expect(cli).toMatch(/if \(cfg\.sends && !autosendEnabled\(\)\) \{/);
  });

  it("reports a missing Gmail rather than reporting nothing", () => {
    // The sheet watch is the reporter that goes blind without it, and a silent
    // run would read as "no new sheet is waiting" (ops issue #40, same shape).
    expect(cli).toMatch(/Gmail is not configured for this run/);
  });

  it("a daily dry run reaches nothing", () => {
    // Scoped to runDailyReport. Anchoring on the first `if (dryRun) {` in the
    // file catches the one in extraArgs and drags in its own adminClient call,
    // which is a different function and a passing-for-the-wrong-reason match.
    const fn = /async function runDailyReport\([\s\S]*?\n\}/.exec(cli)?.[0] ?? "";
    expect(fn, "runDailyReport must exist").not.toBe("");
    const block = /if \(dryRun\) \{[\s\S]*?\n  \}/.exec(fn)?.[0] ?? "";
    expect(block).toMatch(/Nothing read, nothing written/);
    expect(block).not.toMatch(/adminClient\(\)/);
    expect(block).not.toMatch(/gmailClient\(\)/);
    // and the dry-run return happens before either is reached
    expect(fn.indexOf("if (dryRun) {")).toBeLessThan(fn.indexOf("await adminClient()"));
    expect(fn.indexOf("if (dryRun) {")).toBeLessThan(fn.indexOf("gmailClient()"));
  });
});

describe("the daily schedule is checked in, not a Routine setting", () => {
  it("config.json carries dailySchedule beside tickSchedule", () => {
    const cfg = JSON.parse(readFileSync("scripts/ops/config.json", "utf8")) as Record<string, unknown>;
    expect(cfg.dailySchedule).toBe("30 12 * * *");
    expect(cfg.tickSchedule).toBe("43 7-23,0-3 * * *");
  });

  it("refuses a daily schedule that would send several identical reports", () => {
    // The reporters are read by a person. A schedule naming three hours sends
    // three copies of the same twelve lines.
    const raw = JSON.parse(readFileSync("scripts/ops/config.json", "utf8")) as Record<string, unknown>;
    expect(() => validateOpsConfig({ ...raw, dailySchedule: "30 12,13,14 * * *" })).toThrow(
      /one minute of one hour/,
    );
    expect(() => validateOpsConfig({ ...raw, dailySchedule: "30 12 * *" })).toThrow(
      /dailySchedule must be 5 cron fields/,
    );
  });

  it("the doc's schedule is the one in the config", () => {
    const doc = readFileSync("docs/ROUTINES.md", "utf8");
    const cfg = JSON.parse(readFileSync("scripts/ops/config.json", "utf8")) as Record<string, unknown>;
    expect(doc).toContain(String(cfg.dailySchedule));
    expect(doc).toContain(String(cfg.tickSchedule));
  });
});

describe("the config and the doc agree on the two Routines", () => {
  it("the Routines doc names both entry points and no third", () => {
    const doc = readFileSync("docs/ROUTINES.md", "utf8");
    expect(doc).toMatch(/npm run ops -- hourly/);
    expect(doc).toMatch(/npm run ops -- daily/);
  });

  it("the doc carries the click path, because a Routine cannot be made from a session", () => {
    const doc = readFileSync("docs/ROUTINES.md", "utf8");
    expect(doc).toMatch(/claude\.ai > Settings > Routines > \*\*New Routine\*\*/);
    expect(doc).toMatch(/Do not create these\s*\n?\s*from the API/);
  });
});
