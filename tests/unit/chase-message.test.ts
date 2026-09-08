import { describe, expect, it } from "vitest";
import { CONTACT_PHONE } from "../../src/lib/emails/pick-request";
import { earliestOpenDeadline, type OpenDeadline } from "../../scripts/lib/roster";
import type { GameLite, WeekBounds } from "../../scripts/picks/lib/deadline";
import {
  bccBody,
  chaseSubject,
  deadlineParagraph,
  dedupeAddresses,
  earliestOf,
  joinOr,
  mergeTiers,
  openTiers,
  recipientBody,
  reconcile,
  weekLine,
} from "../../scripts/chase/lib/message";

const WEEK1: WeekBounds = {
  week: 1,
  earlyDeadlineAt: "2026-09-09T16:00:00+00:00",
  lateDeadlineAt: "2026-09-11T16:00:00+00:00",
};
const GAMES: GameLite[] = [
  { week: 1, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE" },
  { week: 1, dayOfWeek: "Thursday", homeTeam: "LAR", awayTeam: "SF" },
  { week: 1, dayOfWeek: "Sunday", homeTeam: "PHI", awayTeam: "WAS" },
  { week: 1, dayOfWeek: "Monday", homeTeam: "KC", awayTeam: "DEN" },
];
/** Tuesday 1:55 PM ET: the Wednesday game has closed, the Thursday game has not. */
const TUE_AFTERNOON = new Date("2026-09-08T17:55:00Z");
/** Wednesday 1:00 PM ET: only the Friday noon deadline is left. */
const WED_AFTERNOON = new Date("2026-09-09T17:00:00Z");
/** Monday evening: every tier is still open. */
const MON_EVENING = new Date("2026-09-08T00:00:00Z");

/** Names with the odd case and punctuation the roster really carries. */
const NAMES = ["tommybrads #2", "E.A.T.", "Ernie DellaPia Jr. #1", "black and blue attack"];
const DASHES = /[–—]/;

function tuesdayTiers() {
  return openTiers(GAMES, WEEK1, TUE_AFTERNOON);
}

describe("reconcile", () => {
  it("passes when the three buckets add up to the live count", () => {
    const r = reconcile({ liveUnpicked: 7, mailable: 4, ownersWithoutEmail: 2, giftedWithoutEmail: 1 });
    expect(r.ok).toBe(true);
    expect(r.accounted).toBe(7);
    expect(r.unmailable).toBe(3);
  });

  it("refuses a mismatch and shows every term and the live count", () => {
    const r = reconcile({ liveUnpicked: 8, mailable: 4, ownersWithoutEmail: 2, giftedWithoutEmail: 1 });
    expect(r.ok).toBe(false);
    expect(r.accounted).toBe(7);
    const text = r.lines.join("\n");
    expect(text).toMatch(/recipients' messages:\s+4/);
    expect(text).toMatch(/no email:\s+2/);
    expect(text).toMatch(/no address:\s+1/);
    expect(text).toMatch(/accounted for:\s+7/);
    expect(text).toMatch(/no pick:\s+8/);
  });

  it("does not let an unmailable count hide a missing entry", () => {
    // 4 mailable + 3 unmailable = 7, but 9 have no pick: refused.
    expect(reconcile({ liveUnpicked: 9, mailable: 4, ownersWithoutEmail: 3, giftedWithoutEmail: 0 }).ok).toBe(false);
  });
});

describe("subject", () => {
  it("contains Survivor and the week", () => {
    const s = chaseSubject(3);
    expect(s).toContain("Survivor");
    expect(s).toContain("Week 3");
    expect(s).not.toMatch(DASHES);
  });
});

describe("recipientBody", () => {
  it("on a mixed message each gifted entry says who bought it and owned ones stay bare", () => {
    const body = recipientBody({
      week: 1,
      greetingName: "Chas",
      entryNames: ["Chas Own #1", "Chas Flaster #1"],
      entryNotes: { "Chas Flaster #1": "bought by Kris Tomasco" },
      tiers: tuesdayTiers(),
      lateDeadlineIso: WEEK1.lateDeadlineAt,
    });
    expect(body).toContain("\n  Chas Own #1\n");
    expect(body).toContain("\n  Chas Flaster #1 (bought by Kris Tomasco)\n");
  });

  it("lists every entry name verbatim, one per line, in roster order", () => {
    const body = recipientBody({ week: 1, greetingName: "Tom", entryNames: NAMES, tiers: tuesdayTiers(), lateDeadlineIso: WEEK1.lateDeadlineAt });
    const lines = body.split("\n");
    const listed = lines.filter((l) => l.startsWith("  ")).map((l) => l.slice(2));
    expect(listed).toEqual(NAMES);
    for (const n of NAMES) expect(body).toContain(`\n  ${n}\n`);
  });

  it("greets by the name it was given and signs off as AD with the phone number", () => {
    const body = recipientBody({ week: 1, greetingName: "Chas Flaster #1 and Chas Flaster #2", entryNames: NAMES.slice(0, 2), tiers: tuesdayTiers(), lateDeadlineIso: WEEK1.lateDeadlineAt });
    expect(body.startsWith("Chas Flaster #1 and Chas Flaster #2,\n")).toBe(true);
    expect(body).toContain(`text them to ${CONTACT_PHONE}.`);
    expect(body.trimEnd().endsWith("\nAD")).toBe(true);
    expect(body).toContain("I do not have a Week 1 pick yet for:");
    expect(body).toContain("A missed pick is a loss, and a team can only be used once all season.");
  });

  it("uses the singular reply line for one entry", () => {
    const body = recipientBody({ week: 2, greetingName: "Nicco", entryNames: ["Nicco E"], tiers: [], lateDeadlineIso: WEEK1.lateDeadlineAt });
    expect(body).toContain(`Reply to this email with your pick, or text it to ${CONTACT_PHONE}.`);
    expect(body).not.toContain("one team per entry");
  });
});

describe("deadline paragraph", () => {
  it("names the earliest open tier's teams in full, its game day, and the late deadline", () => {
    const body = recipientBody({ week: 1, greetingName: "Kris", entryNames: NAMES, tiers: tuesdayTiers(), lateDeadlineIso: WEEK1.lateDeadlineAt });
    expect(body).toContain(
      "Deadline: Wed Sep 9 12:00 PM ET if you take Los Angeles Rams or San Francisco 49ers (Thursday game). Everything else this week closes Fri Sep 11 12:00 PM ET.",
    );
    // The closed Wednesday game is not offered, and abbreviations never reach a player.
    expect(body).not.toContain("Seahawks");
    expect(body).not.toMatch(/\bLAR\b|\bSF\b/);
  });

  it("is one sentence when the earliest open deadline is the late deadline", () => {
    const tiers = openTiers(GAMES, WEEK1, WED_AFTERNOON);
    expect(tiers).toHaveLength(1);
    expect(deadlineParagraph(tiers, WEEK1.lateDeadlineAt)).toBe("Deadline: Fri Sep 11 12:00 PM ET.");
    const body = recipientBody({ week: 1, greetingName: "Kris", entryNames: NAMES, tiers, lateDeadlineIso: WEEK1.lateDeadlineAt });
    expect(body).not.toContain("Everything else");
    expect(body).not.toContain("if you take");
  });

  it("on Monday names both early tiers rather than calling the Thursday game 'everything else'", () => {
    const tiers = openTiers(GAMES, WEEK1, MON_EVENING);
    expect(tiers.map((t) => t.teams)).toEqual([["NE", "SEA"], ["LAR", "SF"], ["DEN", "KC", "PHI", "WAS"]]);
    // The late tier spans Sunday and Monday, so it has no one game day.
    expect(tiers.map((t) => t.gameDay)).toEqual(["Wednesday", "Thursday", null]);
    expect(deadlineParagraph(tiers, WEEK1.lateDeadlineAt)).toBe(
      "Deadline: Tue Sep 8 12:00 PM ET if you take New England Patriots or Seattle Seahawks (Wednesday game), or Wed Sep 9 12:00 PM ET if you take Los Angeles Rams or San Francisco 49ers (Thursday game). Everything else this week closes Fri Sep 11 12:00 PM ET.",
    );
  });

  it("leaves out an early tier whose only teams the entry has already used", () => {
    const tiers = openTiers(GAMES, WEEK1, TUE_AFTERNOON, ["LAR", "SF"]);
    expect(deadlineParagraph(tiers, WEEK1.lateDeadlineAt)).toBe("Deadline: Fri Sep 11 12:00 PM ET.");
  });

  it("joins three or more teams with commas and a final or", () => {
    expect(joinOr(["A"])).toBe("A");
    expect(joinOr(["A", "B"])).toBe("A or B");
    expect(joinOr(["A", "B", "C"])).toBe("A, B or C");
  });
});

describe("bccBody", () => {
  it("contains no entry name and goes plural when anyone has more than one entry", () => {
    const body = bccBody({ week: 1, entryCounts: [1, 4, 2], tiers: tuesdayTiers(), lateDeadlineIso: WEEK1.lateDeadlineAt });
    expect(body).not.toContain("for:");
    expect(body).toContain("I do not have your Week 1 picks yet.");
    expect(body).toContain("one team per entry");
    expect(body).toContain("Deadline: Wed Sep 9 12:00 PM ET if you take Los Angeles Rams or San Francisco 49ers (Thursday game).");
    expect(body.trimEnd().endsWith("\nAD")).toBe(true);
  });

  it("stays singular when every recipient has one entry", () => {
    const body = bccBody({ week: 5, entryCounts: [1, 1], tiers: [], lateDeadlineIso: WEEK1.lateDeadlineAt });
    expect(body).toContain("I do not have your Week 5 pick yet.");
    expect(body).toContain(`Reply to this email with your pick, or text it to ${CONTACT_PHONE}.`);
  });
});

describe("hyphens only", () => {
  it("no output carries an em dash or an en dash", () => {
    const outputs = [
      chaseSubject(12),
      recipientBody({ week: 1, greetingName: "Ernie DellaPia Jr.", entryNames: NAMES, tiers: openTiers(GAMES, WEEK1, MON_EVENING), lateDeadlineIso: WEEK1.lateDeadlineAt }),
      bccBody({ week: 1, entryCounts: [2], tiers: tuesdayTiers(), lateDeadlineIso: WEEK1.lateDeadlineAt }),
      deadlineParagraph([], WEEK1.lateDeadlineAt),
      weekLine(1, 3, 5, 2),
      ...reconcile({ liveUnpicked: 1, mailable: 0, ownersWithoutEmail: 0, giftedWithoutEmail: 0 }).lines,
    ];
    for (const o of outputs) expect(o).not.toMatch(DASHES);
  });
});

describe("recipient deadline", () => {
  it("is the minimum across the recipient's entries", () => {
    // Entry A has used both Thursday teams, so its next deadline is Friday; entry B has used nothing.
    const a = earliestOpenDeadline(GAMES, WEEK1, TUE_AFTERNOON, ["LAR", "SF"]);
    const b = earliestOpenDeadline(GAMES, WEEK1, TUE_AFTERNOON);
    expect(a?.deadlineIso).toBe(WEEK1.lateDeadlineAt);
    expect(b?.deadlineIso).toBe(WEEK1.earlyDeadlineAt);
    expect(earliestOf([a, b])?.deadlineIso).toBe(WEEK1.earlyDeadlineAt);
    expect(earliestOf([b, a])?.deadlineIso).toBe(WEEK1.earlyDeadlineAt);
    expect(earliestOf([a, null])?.deadlineIso).toBe(WEEK1.lateDeadlineAt);
    expect(earliestOf([null, null])).toBeNull();
    expect(earliestOf([])).toBeNull();
  });

  it("keeps the whole OpenDeadline object, teams included", () => {
    const b = earliestOpenDeadline(GAMES, WEEK1, TUE_AFTERNOON);
    const chosen = earliestOf([null, b]);
    expect(chosen).toBe(b);
    expect((chosen as OpenDeadline).teams).toEqual(["LAR", "SF"]);
  });

  it("merges tiers across entries so a used team on one entry does not hide the tier from another", () => {
    const usedThursday = openTiers(GAMES, WEEK1, TUE_AFTERNOON, ["LAR", "SF"]);
    const fresh = openTiers(GAMES, WEEK1, TUE_AFTERNOON, ["PHI"]);
    const merged = mergeTiers([usedThursday, fresh]);
    expect(merged.map((t) => t.deadlineIso)).toEqual([WEEK1.earlyDeadlineAt, WEEK1.lateDeadlineAt]);
    expect(merged[0].teams).toEqual(["LAR", "SF"]);
    expect(merged[1].teams).toEqual(["DEN", "KC", "PHI", "WAS"]);
  });
});

describe("weekLine", () => {
  it("counts recipients and mailable entries, naming the unmailable only when there are any", () => {
    expect(weekLine(1, 3, 5, 0)).toBe("Week 1: 3 recipients, 5 entries with no pick");
    expect(weekLine(1, 1, 1, 2)).toBe("Week 1: 1 recipient, 1 entry with no pick, plus 2 unmailable");
  });
});

describe("dedupeAddresses", () => {
  it("drops case-insensitive repeats and blanks but prints the first spelling as stored", () => {
    expect(dedupeAddresses(["Chas.Flaster@gmail.com", "chas.flaster@gmail.com", "", " kris@x.com ", "KRIS@x.com"])).toEqual([
      "Chas.Flaster@gmail.com",
      " kris@x.com ",
    ]);
  });
});

import { entryNotesFor } from "../../scripts/chase/lib/message";

describe("entryNotesFor", () => {
  const buyers = new Map([["e1", "Kris Tomasco"], ["e2", "Kris Tomasco"], ["e3", "Ray Vassallo"]]);
  it("names the buyer of each gifted entry only on a mixed message", () => {
    const mixed = { kind: "mixed" as const, entries: [{ id: "e9", entryName: "Chas Own #1", isGifted: false }, { id: "e2", entryName: "Chas Flaster #1", isGifted: true }] };
    expect(entryNotesFor(mixed, buyers)).toEqual({ "Chas Flaster #1": "bought by Kris Tomasco" });
    expect(entryNotesFor({ kind: "owner", entries: mixed.entries }, buyers)).toBeUndefined();
    expect(entryNotesFor({ kind: "player", entries: [{ id: "e3", entryName: "Johnvas #1", isGifted: true }] }, buyers)).toBeUndefined();
  });
});
