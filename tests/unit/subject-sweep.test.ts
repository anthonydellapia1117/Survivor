import { describe, expect, it } from "vitest";
import type { InboundMessage } from "../../scripts/lib/gmail";
import { readFileSync } from "node:fs";
import { isSweptSubject, strangerIdentityRow, strangerMessages, subjectSweepQuery } from "../../scripts/picks/lib/subject-sweep";

// The Gmail filter's subject rule, in code: "Survivor" or "picks" in the
// subject brings a stranger's mail into the sweep as a question for Anthony.

const msg = (from: string, subject: string): InboundMessage => ({
  id: `m-${from}-${subject}`,
  threadId: "t",
  from,
  fromAddress: from,
  subject,
  date: "Wed, 9 Sep 2026 10:00:00 -0400",
  receivedAt: "2026-09-09T14:00:00Z",
  body: "x",
});

describe("the subject sweep", () => {
  it("searches unread, non-draft mail whose subject carries any of the words", () => {
    expect(subjectSweepQuery(["survivor", "picks"])).toBe("is:unread -in:draft subject:(survivor OR picks)");
    expect(() => subjectSweepQuery([" "])).toThrow(/no terms/);
  });

  it("matches the words whole and in any case, and nothing else", () => {
    const terms = ["survivor", "picks"];
    expect(isSweptSubject("Re: SURVIVOR week 1", terms)).toBe(true);
    expect(isSweptSubject("my picks", terms)).toBe(true);
    expect(isSweptSubject("Picks!", terms)).toBe(true);
    expect(isSweptSubject("toothpicks order", terms)).toBe(false);
    expect(isSweptSubject("survivors of the storm", terms)).toBe(false);
    expect(isSweptSubject("", terms)).toBe(false);
  });

  it("keeps strangers only: known players, the admin and the runner are dropped, as is a subject that does not match", () => {
    const terms = ["survivor", "picks"];
    const msgs = [
      msg("Stranger@example.com", "Survivor picks"),
      msg("known@example.com", "Survivor picks"),
      msg("anthonydellapia@gmail.com", "Survivor - sent to myself"),
      msg("lynnepiazza10@gmail.com", "Survivor sheet"),
      msg("other@example.com", "lunch"),
    ];
    const out = strangerMessages(msgs, ["KNOWN@example.com"], ["anthonydellapia@gmail.com", "lynnepiazza10@gmail.com"], terms);
    expect(out.map((m) => m.fromAddress)).toEqual(["Stranger@example.com"]);
  });
});

describe("a stranger whose message parses to nothing", () => {
  it("becomes one identity row, so it is staged once and marked instead of returning every hour", () => {
    // An empty body, a bare greeting, anything unparsedReason calls noise:
    // the message used to yield no row at all, so nothing was staged, nothing
    // was marked, and the next sweep found it again (issue #42).
    expect(strangerIdentityRow(true, 0)).toEqual({
      kind: "identity",
      reason: "unknown sender, subject matched, nothing recognised in the message",
      line: "(no pick found in the body)",
    });
  });

  it("adds nothing when the message already produced a row, or when the sender is known", () => {
    expect(strangerIdentityRow(true, 1)).toBeNull();
    expect(strangerIdentityRow(true, 4)).toBeNull();
    // A known player's silent message is not a stranger's: they are on the
    // roster, their mail is read by address, and there is no identity to ask.
    expect(strangerIdentityRow(false, 0)).toBeNull();
  });

  it("is wired into the sweep, counting only the rows this message produced, and never as a pick", () => {
    // Comments stripped first: a source assertion that matches the comment
    // explaining a rule instead of the code keeping it is the 2026-09-04 trap.
    const src = readFileSync("scripts/picks/cli.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // The row is STAGED, not merely computed. Without this line the whole fix
    // reverts with the suite green: the value is unused, which eslint reports
    // as a warning (CI passes warnings) and tsc does not check at all.
    expect(src).toMatch(/if \(nothingHeard\) unresolved\.push\(\{ \.\.\.nothingHeard, candidates: \[\], item \}\);/);
    // The count is this item's own, not the run's total: a stranger after a
    // player who picked would otherwise look like it had produced rows.
    expect(src).toMatch(/const rowsBefore = unresolved\.length \+ proposals\.length;/);
    expect(src).toMatch(/strangerIdentityRow\(item\.stranger, unresolved\.length \+ proposals\.length - rowsBefore\)/);
    // Only the subject-swept messages are strangers.
    expect(src).toMatch(/stranger: strangerIds\.has\(m\.id\)/);
    expect(src).toMatch(/stranger: false/);
    // Staging a row is what marks the message, which is the whole fix.
    expect(src).toMatch(/for \(const u of unresolved\)[\s\S]{0,80}?stagePending\(/);
    expect(src).toMatch(/if \(u\.item\.messageId\) touched\.add\(u\.item\.messageId\);/);
  });
});
