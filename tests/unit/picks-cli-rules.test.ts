import { describe, expect, it } from "vitest";
import { pendingKind, pickSourceFor } from "../../scripts/picks/lib/resolve";

describe("pickSourceFor", () => {
  it("records mail read from Gmail as email whatever the flag says", () => {
    expect(pickSourceFor("gmail", null)).toBe("email");
    expect(pickSourceFor("gmail", "text")).toBe("email");
    expect(pickSourceFor("gmail", "email")).toBe("email");
  });

  it("records pasted text as text unless the flag names an email body", () => {
    expect(pickSourceFor("paste", null)).toBe("text");
    expect(pickSourceFor("paste", "text")).toBe("text");
    expect(pickSourceFor("paste", "email")).toBe("email");
  });
});

describe("pendingKind", () => {
  it("is identity when there is no sender at all", () => {
    expect(pendingKind(null, 0)).toBe("identity");
    expect(pendingKind(null, 3)).toBe("identity");
  });

  it("is identity when the sender matches nobody on the roster", () => {
    expect(pendingKind("stranger@example.com", 0)).toBe("identity");
  });

  it("is player_question only when the sender is a known person", () => {
    expect(pendingKind("chas.flaster@gmail.com", 2)).toBe("player_question");
  });
});

import { effectiveSubmitTime, leadingLines, scopeCheck, weekNamedIn } from "../../scripts/picks/lib/resolve";

describe("weekNamedIn", () => {
  it("reads the week a subject or first line names", () => {
    expect(weekNamedIn("Re: Week 1 picks - Kris - 2 entries")).toBe(1);
    expect(weekNamedIn("WEEK 12 picks")).toBe(12);
    expect(weekNamedIn("week #3: Eagles")).toBe(3);
  });

  it("is null when no week is named or the number is not a week", () => {
    expect(weekNamedIn("Eagles this week")).toBeNull();
    expect(weekNamedIn("Week 99")).toBeNull();
    expect(weekNamedIn("Week 0")).toBeNull();
    expect(weekNamedIn("")).toBeNull();
  });

  it("looks only at the leading lines of a body", () => {
    const body = "Kris Tomasco #1 - Eagles\n\nweek 2 next time\nlots\nof\nlines\nWeek 7 deep down";
    expect(weekNamedIn(leadingLines(body))).toBe(2);
    expect(weekNamedIn(leadingLines("a\nb\nc\nd\ne\nWeek 7"))).toBeNull();
  });
});

describe("scopeCheck", () => {
  it("lets a known sender pick only for their own entries", () => {
    const scope = new Set(["e1", "e2"]);
    expect(scopeCheck("e1", scope)).toBe("ok");
    expect(scopeCheck("e9", scope)).toBe("outside");
  });

  it("is open when there is no sender scope", () => {
    expect(scopeCheck("e9", new Set())).toBe("ok");
  });
});

describe("effectiveSubmitTime", () => {
  const now = new Date("2026-09-11T18:00:00Z");
  it("uses the mail's receipt time when there is one", () => {
    expect(effectiveSubmitTime("2026-09-11T15:00:00Z", now).toISOString()).toBe("2026-09-11T15:00:00.000Z");
  });
  it("falls back to now for pasted text or an unreadable time", () => {
    expect(effectiveSubmitTime(null, now)).toBe(now);
    expect(effectiveSubmitTime("not a date", now)).toBe(now);
  });
});
