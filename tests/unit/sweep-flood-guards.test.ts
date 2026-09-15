import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { InboundMessage } from "../../scripts/lib/gmail";
import { sweepFromQueries } from "../../scripts/lib/gmail";
import { MAX_NOISE_ROWS_PER_RUN, MAX_ROSTER_ROWS_PER_RUN, SWEEP_WINDOW_DAYS } from "../../scripts/lib/constants";
import { rowClassOf, stagingCeiling, unparsedLinesToAsk, type RowClass } from "../../scripts/picks/lib/resolve";
import { isSweptSubject, strangerMessages, subjectSweepQuery } from "../../scripts/picks/lib/subject-sweep";
import { BARE_TERMS_REFUSED, loadOpsConfig } from "../../scripts/ops/lib/config";

// THE 2026-09-10 SWEEP FLOOD, AND THE FOUR GUARDS THAT STOP IT RECURRING.
//
// The first run with credentials read five months of unread mail, matched 65
// messages on the bare words "survivor" and "picks", and staged one pending
// row per LINE of each body - 1,951 rows in four minutes. Nothing was written
// (identity has no write arm in admin_approve_pending), but 1,951 rows is not
// a queue anybody reviews.
//
// Two independent defects: what got IN (breadth) and how many rows each
// message became (duplication). The guards below are Anthony's priority
// order, and the ceiling is first because it is the one that turns any future
// version of this into one line instead of a flood.

const ROOT = path.join(__dirname, "../..");
const code = (p: string): string =>
  readFileSync(path.join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/** A Codex review notification, the shape that became 149 rows. */
const REVIEW_BODY = [
  "@chatgpt-codex-connector[bot] commented on this pull request.",
  "Here are some automated review suggestions for this pull request.",
  "### Approval recommended",
  "+  if v_bad is not null then",
  "| src/lib/data/admin-types.ts | Removes ccEmail; adds entry gift fields. |",
  ...Array.from({ length: 144 }, (_, i) => `line ${i} of diff context with prose in it`),
];

// THE CEILING WAS SPLIT BY CLASS ON 2026-09-15, on Anthony's instruction
// with 43 people holding the Week 2 email: "raise it for pick rows only and
// keep it low for unparsed noise". The one count of every row stopped the
// whole run when it tripped, clean picks included. Now: NOISE (identity rows,
// senders with no live entry) is the 25 this file was written for, and over
// it those rows are left unstaged and unfiled while the roster's rows still
// go through; ROSTER (pick and player_question rows from placed senders) is
// the roster size, 121, and over it the whole run still stops dead.
const rows = (n: number, sender: string | null, klass: RowClass) => Array.from({ length: n }, () => ({ sender, klass }));
const LIMITS = { noise: MAX_NOISE_ROWS_PER_RUN, roster: MAX_ROSTER_ROWS_PER_RUN };

describe("1. the ceiling - the guard that must survive even if the others slip", () => {
  it("classes a row by its kind: identity is noise, a pick or a player question is roster", () => {
    expect(rowClassOf("identity")).toBe("noise");
    expect(rowClassOf("player_question")).toBe("roster");
    expect(rowClassOf("pick")).toBe("roster");
  });

  it("noise: passes at 25 and trips at 26, and the roster rows in the same run are untouched", () => {
    const at = stagingCeiling([...rows(MAX_NOISE_ROWS_PER_RUN, "a@b.com", "noise"), ...rows(3, "kris@x.com", "roster")], LIMITS);
    expect(at.ok).toBe(true);
    expect(at.tripped).toBeNull();
    expect(at.noise.staged).toBe(MAX_NOISE_ROWS_PER_RUN);
    // 26 stranger rows plus 3 clean roster rows: the noise class trips, the
    // roster class does not, and the run is told exactly that.
    const over = stagingCeiling([...rows(MAX_NOISE_ROWS_PER_RUN + 1, "a@b.com", "noise"), ...rows(3, "kris@x.com", "roster")], LIMITS);
    expect(over.ok).toBe(false);
    expect(over.tripped).toBe("noise");
    expect(over.noise.ok).toBe(false);
    expect(over.noise.staged).toBe(MAX_NOISE_ROWS_PER_RUN + 1);
    expect(over.roster.ok).toBe(true);
    expect(over.roster.staged).toBe(3);
    // The real run: 1,951 identity rows against a limit of 25.
    expect(stagingCeiling(rows(1951, "notifications@github.com", "noise"), LIMITS).tripped).toBe("noise");
  });

  it("roster: passes at 121 and trips at 122, and a roster trip outranks a noise one", () => {
    expect(stagingCeiling(rows(MAX_ROSTER_ROWS_PER_RUN, "kris@x.com", "roster"), LIMITS).ok).toBe(true);
    const over = stagingCeiling(rows(MAX_ROSTER_ROWS_PER_RUN + 1, "kris@x.com", "roster"), LIMITS);
    expect(over.ok).toBe(false);
    expect(over.tripped).toBe("roster");
    // Both over: the roster trip is the one that decides, because it stops the run.
    const both = stagingCeiling([...rows(122, "kris@x.com", "roster"), ...rows(26, "a@b.com", "noise")], LIMITS);
    expect(both.tripped).toBe("roster");
    expect(both.noise.ok).toBe(false);
  });

  it("names the senders worst first, so the wrong filter identifies itself", () => {
    const c = stagingCeiling(
      [
        { sender: "notifications@github.com", klass: "noise" },
        { sender: "dan@tldrnewsletter.com", klass: "noise" },
        { sender: "notifications@github.com", klass: "noise" },
        { sender: null, klass: "noise" },
        { sender: "NOTIFICATIONS@github.com", klass: "noise" },
      ],
      { noise: 2, roster: 121 },
    );
    expect(c.tripped).toBe("noise");
    expect(c.noise.bySender[0]).toEqual({ sender: "notifications@github.com", rows: 3 });
    expect(c.noise.bySender.map((s) => s.sender)).toContain("(no sender)");
  });

  it("is 25 for noise and 121 for roster, and refuses a limit that is not a positive integer", () => {
    expect(MAX_NOISE_ROWS_PER_RUN).toBe(25);
    expect(MAX_ROSTER_ROWS_PER_RUN).toBe(121);
    expect(() => stagingCeiling([], { noise: 0, roster: 121 })).toThrow(/noise limit must be a positive integer/);
    expect(() => stagingCeiling([], { noise: 25, roster: 1.5 })).toThrow(/roster limit must be a positive integer/);
  });

  it("in the CLI: a roster trip stops the run before the confirm, any write and any filing; a noise trip drops only the noise rows and goes on", () => {
    const c = code("scripts/picks/cli.ts");
    const ceiling = c.indexOf("stagingCeiling(");
    const confirm = c.indexOf("await confirm(");
    const write = c.indexOf("await submitPick(");
    const file = c.indexOf("await fileMessages(");
    for (const [name, at] of [["ceiling", ceiling], ["confirm", confirm], ["write", write], ["file", file]] as const) {
      expect(at, `${name} not found in the CLI`).toBeGreaterThan(-1);
    }
    expect(ceiling).toBeLessThan(confirm);
    expect(ceiling).toBeLessThan(write);
    expect(ceiling).toBeLessThan(file);
    // Roster: return, before anything else.
    expect(c).toMatch(/if \(ceiling\.tripped === "roster"\) \{[\s\S]{0,900}?return;\s*\}/);
    // Noise: the identity rows come OUT of unresolved and the run continues -
    // no return in that branch. The senders are printed on the terminal.
    const noise = c.match(/if \(ceiling\.tripped === "noise"\) \{([\s\S]*?)\n  \}\n/);
    expect(noise, "the noise branch").not.toBeNull();
    expect(noise![1]).toMatch(/rowClassOf\(u\.kind\) !== "noise"/);
    expect(noise![1]).toMatch(/unresolved\.length = 0;\s*unresolved\.push\(\.\.\.kept\);/);
    expect(noise![1]).toMatch(/ceilingSenderLines\(ceiling\.noise\)/);
    expect(noise![1]).not.toMatch(/\breturn\b/);
    // Neither branch slices a list down to its limit.
    expect(c).not.toMatch(/unresolved\.slice\(/);
    // The noise rows never reach the write loop or the filing set: what is
    // filed is `touched`, built from the rows still in `unresolved`.
    expect(c).toMatch(/for \(const u of unresolved\)[\s\S]{0,80}?stagePending\(/);
    expect(c).toMatch(/if \(u\.item\.messageId\) touched\.add\(u\.item\.messageId\);/);
  });
});

describe("2. one row per message, never one per line", () => {
  it("asks nothing line by line when the sender resolves to no live entry", () => {
    expect(unparsedLinesToAsk(false, REVIEW_BODY)).toEqual([]);
    expect(REVIEW_BODY.length).toBe(149);
  });

  it("still asks line by line for a sender who has entries to pick for", () => {
    // These are the lines parsePickLines could NOT read as a pick. A greeting
    // and a bare "thanks" are noise; a real question is not.
    const asked = unparsedLinesToAsk(true, ["hi", "what happens if I miss one?", "thanks"]);
    expect(asked.map((a) => a.line)).toEqual(["what happens if I miss one?"]);
    expect(asked[0].reason).toBe("no team recognised on this line");
    // And the flood body, from a placed sender, is still every prose line -
    // which is why the ceiling above exists as well as this.
    expect(unparsedLinesToAsk(true, REVIEW_BODY).length).toBeGreaterThan(100);
  });

  it("is the only path the CLI takes for unparsed lines, and the unplaced pick line asks once", () => {
    const c = code("scripts/picks/cli.ts");
    expect(c).toMatch(/for \(const ask of unparsedLinesToAsk\(placed, unparsed, signatures\)\) fail\(ask\.reason, ask\.line\);/);
    // The old per-line loop must be gone, not merely bypassed.
    expect(c).not.toMatch(/for \(const u of unparsed\)/);
    // A sender with no live entry that DID name a team asks once for the
    // message, not once per line: GitHub diffs carry SKIP_WEEK and "bye".
    expect(c).toMatch(/askOnce\("sender matches no live entry on the roster"\)/);
    expect(c).toMatch(/if \(askedForThisItem\) return;/);
    expect(c).toMatch(/strangerIdentityRow\(!placed,/);
  });
});

describe("3. the date floor", () => {
  it("is 14 days and is on BOTH queries, not just the subject one", () => {
    expect(SWEEP_WINDOW_DAYS).toBe(14);
    expect(subjectSweepQuery(["survivor"])).toContain("newer_than:14d");
    for (const q of sweepFromQueries(["a@b.com", "c@d.com"])) expect(q).toContain("newer_than:14d");
  });

  it("chunks the roster and refuses a window that is not a positive integer", () => {
    const many = Array.from({ length: 40 }, (_, i) => `p${i}@x.com`);
    const qs = sweepFromQueries(many, 3);
    expect(qs.length).toBe(3);
    for (const q of qs) expect(q).toContain("newer_than:3d");
    expect(() => sweepFromQueries(["a@b.com"], 0)).toThrow(/positive integer/);
  });
});

describe("4. no bare subject term, and no machine senders", () => {
  it("refuses the bare word picks in the config loader, by name", () => {
    expect(BARE_TERMS_REFUSED).toContain("picks");
    expect(loadOpsConfig().sweepSubjectTerms).not.toContain("picks");
    for (const t of loadOpsConfig().sweepSubjectTerms) expect(BARE_TERMS_REFUSED).not.toContain(t);
  });

  it("rejects the newsletters that flooded the queue and keeps real pool mail", () => {
    const terms = loadOpsConfig().sweepSubjectTerms;
    for (const junk of [
      "Free stock picks from MarketBeat",
      "How to Draft from Picks 1-3",
      "Meta Picks Slack, AI Gets Metered, Google Workspace",
      "Discover more great picks for your dog.",
      "Valentine's Day Top Picks",
    ]) {
      expect(isSweptSubject(junk, terms), `${junk} must not be swept`).toBe(false);
    }
    for (const real of ["Re: SURVIVOR | Last Call & Week 1", "Survivor - DellaPia | Week 1", "my picks for week 3"]) {
      expect(isSweptSubject(real, terms), `${real} must be swept`).toBe(true);
    }
  });

  it("keeps the machine senders out of the query itself", () => {
    const q = subjectSweepQuery(loadOpsConfig().sweepSubjectTerms, loadOpsConfig().sweepExcludeSenders);
    expect(q).toContain("-from:notifications@github.com");
    expect(q).toContain("-from:noreply@github.com");
    // A phrase is quoted whole, or Gmail reads it as two words.
    expect(q).toContain('"my picks"');
  });

  it("drops a GitHub notification even though its subject names the pool", () => {
    const msg = (from: string, subject: string): InboundMessage => ({
      id: `m-${from}`, threadId: "t", from, fromAddress: from, subject,
      date: "Thu, 10 Sep 2026 14:00:00 -0400", receivedAt: "2026-09-10T18:00:00Z", body: "x",
    });
    const terms = loadOpsConfig().sweepSubjectTerms;
    const excluded = ["anthonydellapia@gmail.com", "lynnepiazza10@gmail.com", ...loadOpsConfig().sweepExcludeSenders];
    const out = strangerMessages(
      [
        msg("notifications@github.com", "Re: [anthonydellapia1117/Survivor] Colours from the stored result (PR #65)"),
        msg("noreply@github.com", "[anthonydellapia1117/Survivor] Run failed: ci"),
        msg("someone@example.com", "Survivor - can I still get in?"),
      ],
      [],
      excluded,
      terms,
    );
    expect(out.map((m) => m.fromAddress)).toEqual(["someone@example.com"]);
  });
});
