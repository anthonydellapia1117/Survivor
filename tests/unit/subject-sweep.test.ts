import { describe, expect, it } from "vitest";
import type { InboundMessage } from "../../scripts/lib/gmail";
import { isSweptSubject, strangerMessages, subjectSweepQuery } from "../../scripts/picks/lib/subject-sweep";

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
