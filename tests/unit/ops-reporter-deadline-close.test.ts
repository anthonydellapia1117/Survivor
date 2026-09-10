import { describe, expect, it } from "vitest";
import { renderReport } from "../../scripts/ops/lib/report";
import { reportDeadlineClose } from "../../scripts/ops/reporters/deadline-close";
import type {
  EntrySnapshot,
  GameSnapshot,
  OpsSnapshot,
  PickSnapshot,
  WeekSnapshot,
} from "../../scripts/ops/reporters/types";

// Three weeks of the real shape, in EDT (UTC-4): noon ET is 16:00 UTC. The
// early boundary is Wednesday noon and the late boundary Friday noon, and
// deadlineFor derives the Wednesday tier a day below early and the Friday tier
// a day above it - so in Week 2 a Seattle pick closes Tue 12:00 PM ET and a
// Dallas pick closes Fri 12:00 PM ET, two days apart in the same week. That
// gap is what makes "its own team's deadline" testable at all.
const WEEKS: WeekSnapshot[] = [
  { week: 1, earlyDeadlineAt: "2026-09-09T16:00:00Z", lateDeadlineAt: "2026-09-11T16:00:00Z" },
  { week: 2, earlyDeadlineAt: "2026-09-16T16:00:00Z", lateDeadlineAt: "2026-09-18T16:00:00Z" },
  { week: 3, earlyDeadlineAt: "2026-09-23T16:00:00Z", lateDeadlineAt: "2026-09-25T16:00:00Z" },
];

const GAMES: GameSnapshot[] = [1, 2, 3].flatMap((week) => [
  { week, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE", kickoffAt: "2026-09-10T00:20:00Z" },
  { week, dayOfWeek: "Thursday", homeTeam: "LAR", awayTeam: "SF", kickoffAt: "2026-09-11T00:20:00Z" },
  { week, dayOfWeek: "Sunday", homeTeam: "DAL", awayTeam: "PHI", kickoffAt: "2026-09-13T17:00:00Z" },
]);

/** Thursday 2026-09-17, 11:00 AM ET: Week 1 has locked, Week 2 is the open week. */
const NOW_WEEK_2 = new Date("2026-09-17T15:00:00Z");
/** The same hour a week on: Week 3 is open and Weeks 1 and 2 are behind it. */
const NOW_WEEK_3 = new Date("2026-09-24T15:00:00Z");
/** Everything has locked. */
const NOW_AFTER_SEASON = new Date("2026-10-01T15:00:00Z");

const SENT_TO_LYNNE = "2026-08-24T23:23:18Z";

function snap(over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  return {
    now: NOW_WEEK_2,
    weeks: WEEKS,
    games: GAMES,
    entries: [],
    picks: [],
    herRows: [],
    herSheet: null,
    herMail: null,
    owners: [],
    payments: [],
    recipientAddresses: [],
    expectedRosterAddresses: 39,
    freeEntryCount: 0,
    recruitedCount: 0,
    lynneRateCents: 2500,
    ...over,
  };
}

function entry(over: Partial<EntrySnapshot> = {}): EntrySnapshot {
  return {
    id: "e1",
    entryName: "Tommybrads #1",
    lynneNumber: 972,
    ownerName: "Tom Bradshaw",
    ownerEmail: "tom@example.com",
    playerEmail: null,
    isFreeEntry: false,
    isGifted: false,
    submittedToLynneAt: SENT_TO_LYNNE,
    submittedAsName: "Tommybrads #1",
    ...over,
  };
}

/** Week 2, Seattle (Wednesday game, so a Tue 12:00 PM ET deadline), in time. */
function pick(over: Partial<PickSnapshot> = {}): PickSnapshot {
  return {
    entryId: "e1",
    week: 2,
    team: "SEA",
    submittedAt: "2026-09-14T14:00:00Z",
    late: false,
    source: "email",
    ...over,
  };
}

const text = (s: OpsSnapshot) => reportDeadlineClose(s).items.map((i) => i.text).join("\n");

describe("deadline-close: the job and the empty run", () => {
  it("names itself deadline-close", () => {
    expect(reportDeadlineClose(snap()).job).toBe("deadline-close");
  });

  it("is NO ACTION when every pick is in time and she holds every entry", () => {
    const s = snap({ entries: [entry()], picks: [pick()] });
    const r = reportDeadlineClose(s);
    expect(r.items).toEqual([]);
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });
});

describe("deadline-close: late picks", () => {
  it("reports a pick that arrived after ITS OWN team's deadline, with both times", () => {
    // Seattle plays Wednesday, so this closed Tue noon - not at the week's
    // Friday boundary, which this pick beat by three days.
    const s = snap({ entries: [entry()], picks: [pick({ submittedAt: "2026-09-15T17:00:00Z" })] });
    const r = reportDeadlineClose(s);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toContain("Tommybrads #1");
    expect(r.items[0].text).toContain("SEA");
    expect(r.items[0].text).toContain("arrived Tue 1:00 PM ET");
    expect(r.items[0].text).toContain("after its Tue 12:00 PM ET deadline");
    expect(r.items[0].names).toEqual(["Tommybrads #1"]);
  });

  it("leaves a weekend pick alone until the Friday boundary it actually has", () => {
    // Dallas plays Sunday: Thursday morning is late for Seattle and in time
    // for Dallas. A reporter reading one deadline per week would flag this.
    const s = snap({ entries: [entry()], picks: [pick({ team: "DAL", submittedAt: "2026-09-17T14:00:00Z" })] });
    expect(reportDeadlineClose(s).items).toEqual([]);
  });

  it("reports a pick the app flagged late even when the clock says it was in time, and says the two disagree", () => {
    const s = snap({ entries: [entry()], picks: [pick({ late: true })] });
    const r = reportDeadlineClose(s);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toContain("arrived Mon 10:00 AM ET");
    expect(r.items[0].text).toContain("before its Tue 12:00 PM ET deadline");
    expect(r.items[0].text).toContain("flagged late");
    expect(r.items[0].text).toContain("the flag and the deadline disagree; both values stand as recorded");
  });

  it("says so when the clock is past the deadline and the flag is not set", () => {
    const s = snap({ entries: [entry()], picks: [pick({ submittedAt: "2026-09-15T17:00:00Z", late: false })] });
    expect(text(s)).toContain("not flagged late");
    expect(text(s)).toContain("the flag and the deadline disagree; both values stand as recorded");
  });

  it("does not claim a disagreement when the flag and the clock agree", () => {
    const s = snap({ entries: [entry()], picks: [pick({ submittedAt: "2026-09-15T17:00:00Z", late: true })] });
    const r = reportDeadlineClose(s);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toContain("flagged late");
    expect(r.items[0].text).not.toContain("disagree");
  });

  it("names a pick whose entry is not on the snapshot as unknown rather than guessing one", () => {
    const s = snap({ entries: [], picks: [pick({ entryId: "e-gone", submittedAt: "2026-09-15T17:00:00Z" })] });
    expect(text(s)).toContain("unknown entry e-gone");
  });

  it("says once, in the preamble, that accepting or refusing is Anthony's call", () => {
    const s = snap({ entries: [entry()], picks: [pick({ submittedAt: "2026-09-15T17:00:00Z" })] });
    const r = reportDeadlineClose(s);
    expect(r.preamble).toBeDefined();
    expect(r.preamble).toMatch(/accept, refuse or sweep/);
    expect(r.preamble).toMatch(/decides nothing/);
    expect(r.items[0].text).not.toMatch(/accept, refuse or sweep/);
  });

  it("carries no preamble when nothing arrived late", () => {
    const s = snap({ entries: [entry({ submittedToLynneAt: null })], picks: [] });
    const r = reportDeadlineClose(s);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.preamble).toBeUndefined();
  });

  it("reports late picks for the open week only - a locked week is not reopened", () => {
    const s = snap({
      entries: [entry()],
      picks: [pick({ week: 1, submittedAt: "2026-09-11T17:00:00Z", late: true })],
    });
    expect(reportDeadlineClose(s).items).toEqual([]);
  });
});

describe("deadline-close: a duplicate team is an elimination", () => {
  const dup = (over: Partial<OpsSnapshot> = {}) =>
    snap({
      entries: [entry()],
      picks: [pick({ week: 1, team: "SEA" }), pick({ week: 2, team: "SEA" })],
      ...over,
    });

  it("names the entry, the team, both weeks and calls it an ELIMINATION, not a warning", () => {
    const r = reportDeadlineClose(dup());
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toContain("Tommybrads #1");
    expect(r.items[0].text).toContain("SEA");
    expect(r.items[0].text).toContain("Week 1");
    expect(r.items[0].text).toContain("Week 2");
    expect(r.items[0].text).toContain("a duplicate team is an ELIMINATION in her pool, not a warning");
  });

  it("names the deadline that pick still closes at", () => {
    expect(reportDeadlineClose(dup()).items[0].text).toContain("Week 2 closes for SEA at Tue 12:00 PM ET");
  });

  it("matches case-insensitively - her sheet and ours do not agree on case", () => {
    const s = dup({ picks: [pick({ week: 1, team: "sea" }), pick({ week: 2, team: "SEA" })] });
    expect(text(s)).toContain("ELIMINATION");
  });

  it("never matches fuzzily - SEA and SEAHAWKS are two strings", () => {
    const s = dup({ picks: [pick({ week: 1, team: "SEA" }), pick({ week: 2, team: "SEAHAWKS" })] });
    expect(reportDeadlineClose(s).items).toEqual([]);
  });

  it("does not call two byes a duplicate team", () => {
    const s = dup({ picks: [pick({ week: 1, team: "SKIP_WEEK" }), pick({ week: 2, team: "SKIP_WEEK" })] });
    expect(reportDeadlineClose(s).items).toEqual([]);
  });

  it("looks back over the whole season, not just the week before", () => {
    const s = dup({
      now: NOW_WEEK_3,
      picks: [pick({ week: 1, team: "SEA" }), pick({ week: 2, team: "DAL" }), pick({ week: 3, team: "SEA" })],
    });
    const r = reportDeadlineClose(s);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toContain("SEA in Week 3 is already this entry's Week 1 pick");
  });

  it("reports a duplicate between two locked weeks too - the check is not scoped to the open week", () => {
    const s = dup({ now: NOW_WEEK_3 });
    expect(text(s)).toContain("SEA in Week 2 is already this entry's Week 1 pick");
  });

  it("is the first line when there is also a late pick", () => {
    const s = dup({
      entries: [entry(), entry({ id: "e2", entryName: "Nicco E" })],
      picks: [
        pick({ entryId: "e2", submittedAt: "2026-09-15T17:00:00Z" }),
        pick({ week: 1, team: "SEA" }),
        pick({ week: 2, team: "SEA" }),
      ],
    });
    const r = reportDeadlineClose(s);
    expect(r.items).toHaveLength(2);
    expect(r.items[0].text).toContain("ELIMINATION");
    expect(r.items[1].text).toContain("Nicco E");
  });
});

describe("deadline-close: picks she does not hold the entry for", () => {
  it("leads with the count, names every entry and names the lock", () => {
    const s = snap({
      entries: [
        entry({ id: "e1", entryName: "Rayvas #1", submittedToLynneAt: null }),
        entry({ id: "e2", entryName: "Johnvas #1", submittedToLynneAt: null }),
      ],
      picks: [pick({ entryId: "e1", team: "DAL" }), pick({ entryId: "e2", team: "LAR" })],
    });
    const line = reportDeadlineClose(s).items.find((i) => i.text.includes("not on her sheet"));
    expect(line).toBeDefined();
    expect(line?.text).toMatch(/^2 entries with a Week 2 pick are not on her sheet: /);
    expect(line?.text).toContain("Johnvas #1");
    expect(line?.text).toContain("Rayvas #1");
    expect(line?.text).toContain("Week 2 locks Fri 12:00 PM ET");
    expect(line?.names).toEqual(["Johnvas #1", "Rayvas #1"]);
  });

  it("counts only the entries she does not hold", () => {
    const s = snap({
      entries: [entry({ id: "e1" }), entry({ id: "e2", entryName: "Nicco E", submittedToLynneAt: null })],
      picks: [pick({ entryId: "e1" }), pick({ entryId: "e2", team: "DAL" })],
    });
    const line = reportDeadlineClose(s).items.find((i) => i.text.includes("not on her sheet"));
    expect(line?.text).toMatch(/^1 entry with a Week 2 pick is not on her sheet: Nicco E/);
    expect(line?.text).not.toContain("Tommybrads #1");
  });

  it("reads the open week off s.now and nowhere else", () => {
    const both = {
      entries: [entry({ submittedToLynneAt: null })],
      picks: [pick({ week: 1, team: "DAL" }), pick({ week: 2, team: "SEA" })],
    };
    const inWeek1 = text(snap({ ...both, now: new Date("2026-09-10T15:00:00Z") }));
    const inWeek2 = text(snap({ ...both, now: NOW_WEEK_2 }));
    expect(inWeek1).toContain("1 entry with a Week 1 pick is not on her sheet");
    expect(inWeek2).toContain("1 entry with a Week 2 pick is not on her sheet");
  });
});

describe("deadline-close: roster drift", () => {
  it("reports an entry she has never been sent even when it has no pick at all", () => {
    const s = snap({ entries: [entry({ entryName: "Mike Cia", submittedToLynneAt: null })], picks: [] });
    const r = reportDeadlineClose(s);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toBe(
      "1 live entry has never been sent to Lynne - she does not hold it: Mike Cia - send before Week 2 locks Fri 12:00 PM ET",
    );
  });

  it("keeps every name on the item so the collapse cannot drop one", () => {
    const names = Array.from({ length: 20 }, (_, i) => `AAA #${i + 1}`);
    const s = snap({
      entries: names.map((entryName, i) => entry({ id: `e${i}`, entryName, submittedToLynneAt: null })),
    });
    const line = reportDeadlineClose(s).items.find((i) => i.text.includes("never been sent"));
    expect(line?.names).toHaveLength(20);
    for (const n of names) expect(line?.names).toContain(n);
  });

  it("spans the season: it still reports once every week has locked, and invents no deadline", () => {
    const s = snap({
      now: NOW_AFTER_SEASON,
      entries: [entry({ entryName: "Mike Cia", submittedToLynneAt: null })],
      picks: [pick({ submittedAt: "2026-09-15T17:00:00Z", late: true })],
    });
    const r = reportDeadlineClose(s);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toContain("never been sent to Lynne");
    expect(r.items[0].text).not.toContain("locks");
  });

  it("says nothing about drift when she holds every entry", () => {
    expect(text(snap({ entries: [entry(), entry({ id: "e2" })] }))).not.toContain("never been sent");
  });
});
