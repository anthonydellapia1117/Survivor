import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { InboundMessage } from "../../scripts/lib/gmail";
import { unreadFromQueries } from "../../scripts/lib/gmail";
import { MAX_STAGED_PER_RUN, SWEEP_WINDOW_DAYS } from "../../scripts/lib/constants";
import { stagingCeiling, unparsedLinesToAsk } from "../../scripts/picks/lib/resolve";
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

describe("1. the ceiling - the guard that must survive even if the others slip", () => {
  it("passes at the limit and fails one over it, and never trims to fit", () => {
    const at = stagingCeiling(Array.from({ length: MAX_STAGED_PER_RUN }, () => "a@b.com"), MAX_STAGED_PER_RUN);
    expect(at.ok).toBe(true);
    expect(at.staged).toBe(MAX_STAGED_PER_RUN);
    const over = stagingCeiling(Array.from({ length: MAX_STAGED_PER_RUN + 1 }, () => "a@b.com"), MAX_STAGED_PER_RUN);
    expect(over.ok).toBe(false);
    expect(over.staged).toBe(MAX_STAGED_PER_RUN + 1);
    // The real run: 1,951 rows against a limit of 25.
    expect(stagingCeiling(Array.from({ length: 1951 }, () => "notifications@github.com"), 25).ok).toBe(false);
  });

  it("names the senders worst first, so the wrong filter identifies itself", () => {
    const c = stagingCeiling(
      ["notifications@github.com", "dan@tldrnewsletter.com", "notifications@github.com", null, "NOTIFICATIONS@github.com"],
      2,
    );
    expect(c.ok).toBe(false);
    expect(c.bySender[0]).toEqual({ sender: "notifications@github.com", rows: 3 });
    expect(c.bySender.map((s) => s.sender)).toContain("(no sender)");
  });

  it("is 25, and refuses a limit that is not a positive integer", () => {
    expect(MAX_STAGED_PER_RUN).toBe(25);
    expect(() => stagingCeiling([], 0)).toThrow(/positive integer/);
  });

  it("stops the run in the CLI before the confirm, before any write and before any message is filed", () => {
    const c = code("scripts/picks/cli.ts");
    const ceiling = c.indexOf("stagingCeiling(");
    const confirm = c.indexOf("await confirm(");
    const write = c.indexOf("await submitPick(");
    const file = c.indexOf("await fileMessages(");
    for (const [name, at] of [["ceiling", ceiling], ["confirm", confirm], ["write", write], ["file", file]] as const) {
      expect(at, `${name} not found in the CLI`).toBeGreaterThan(-1);
    }
    // Order is the guarantee: a run over the ceiling returns before it asks,
    // before it writes and before it marks anything read - so the same mail
    // is still unread and still sweepable once the filter is right.
    expect(ceiling).toBeLessThan(confirm);
    expect(ceiling).toBeLessThan(write);
    expect(ceiling).toBeLessThan(file);
    expect(c).toMatch(/if \(!ceiling\.ok\) \{[\s\S]{0,700}?return;/);
    // It reports and stops; it does not slice the list down to the limit.
    expect(c).not.toMatch(/unresolved\.slice\(/);
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
    expect(c).toMatch(/for \(const ask of unparsedLinesToAsk\(placed, unparsed\)\) fail\(ask\.reason, ask\.line\);/);
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
    for (const q of unreadFromQueries(["a@b.com", "c@d.com"])) expect(q).toContain("newer_than:14d");
  });

  it("chunks the roster and refuses a window that is not a positive integer", () => {
    const many = Array.from({ length: 40 }, (_, i) => `p${i}@x.com`);
    const qs = unreadFromQueries(many, 3);
    expect(qs.length).toBe(3);
    for (const q of qs) expect(q).toContain("newer_than:3d");
    expect(() => unreadFromQueries(["a@b.com"], 0)).toThrow(/positive integer/);
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
