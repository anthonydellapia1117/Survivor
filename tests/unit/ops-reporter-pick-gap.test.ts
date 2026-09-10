import { describe, expect, it } from "vitest";
import { reportPickGap } from "../../scripts/ops/reporters/pick-gap";
import { renderReport } from "../../scripts/ops/lib/report";
import type { EntrySnapshot, OpsSnapshot } from "../../scripts/ops/reporters/types";

// Week 1 as the weeks table holds it: the two stored boundaries and nothing
// else. Early is Wednesday noon ET, late is Friday noon ET, and every tier
// derives from those (CLAUDE.md, Pick deadlines).
const EARLY = "2026-09-09T16:00:00.000Z"; // Wed 12:00 PM ET
const LATE = "2026-09-11T16:00:00.000Z"; // Fri 12:00 PM ET

// The week has a Wednesday game on purpose. Its tier closes Tue 12:00 PM ET,
// so a reporter that named a tier rather than the late boundary - claiming a
// deadline for a team the entry has not chosen - says "Tue" and is caught.
const GAMES = [
  { week: 1, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE", kickoffAt: "2026-09-10T00:20:00.000Z" },
  { week: 1, dayOfWeek: "Thursday", homeTeam: "LAR", awayTeam: "SF", kickoffAt: "2026-09-11T00:15:00.000Z" },
  { week: 1, dayOfWeek: "Sunday", homeTeam: "PHI", awayTeam: "DAL", kickoffAt: "2026-09-13T17:00:00.000Z" },
];

const FAR = new Date("2026-09-09T13:00:00.000Z"); // Wed 9:00 AM ET, two days out
const NEAR = new Date("2026-09-11T04:00:00.000Z"); // Fri 12:00 AM ET, twelve hours out
const ONE_DAY_OUT = new Date("2026-09-10T16:00:00.000Z"); // exactly one day
const JUST_OVER_A_DAY = new Date("2026-09-10T15:59:00.000Z");

function snapshot(over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  return {
    now: FAR,
    weeks: [{ week: 1, earlyDeadlineAt: EARLY, lateDeadlineAt: LATE }],
    games: GAMES,
    entries: [],
    picks: [],
    herRows: [],
    herSheet: null,
    herMail: null,
    owners: [],
    payments: [],
    recipientAddresses: [],
    expectedRosterAddresses: 40,
    freeEntryCount: 0,
    recruitedCount: 0,
    lynneRateCents: 2500,
    ...over,
  };
}

function entry(over: Partial<EntrySnapshot> & { id: string }): EntrySnapshot {
  return {
    entryName: `entry ${over.id}`,
    lynneNumber: null,
    ownerName: "Owner One",
    ownerEmail: "one@example.com",
    playerEmail: null,
    isFreeEntry: false,
    isGifted: false,
    submittedToLynneAt: null,
    submittedAsName: null,
    ...over,
  };
}

/** n entries for one owner, so "k of n" has something to be a fraction of. */
function ownerWith(name: string, email: string | null, count: number, idPrefix: string): EntrySnapshot[] {
  return Array.from({ length: count }, (_, i) =>
    entry({ id: `${idPrefix}${i + 1}`, entryName: `${name} #${i + 1}`, ownerName: name, ownerEmail: email }),
  );
}

const texts = (s: OpsSnapshot) => reportPickGap(s).items.map((i) => i.text);

describe("the open week", () => {
  it("reports nothing once every week has locked", () => {
    const report = reportPickGap(snapshot({
      now: new Date("2026-09-12T00:00:00.000Z"),
      entries: ownerWith("Owner One", "one@example.com", 4, "a"),
    }));
    expect(report.job).toBe("pick-gap");
    expect(report.items).toEqual([]);
  });

  it("works the lowest week still open, not the one whose late boundary has passed", () => {
    const s = snapshot({
      now: new Date("2026-09-15T00:00:00.000Z"),
      weeks: [
        { week: 1, earlyDeadlineAt: EARLY, lateDeadlineAt: LATE },
        { week: 2, earlyDeadlineAt: "2026-09-16T16:00:00.000Z", lateDeadlineAt: "2026-09-18T16:00:00.000Z" },
      ],
      entries: ownerWith("Owner One", "one@example.com", 1, "a"),
      // The pick is for the week that already locked, so week 2 is open and
      // still silent.
      picks: [{ entryId: "a1", week: 1, team: "NE", submittedAt: EARLY, late: false, source: "email" }],
    });
    expect(texts(s)).toEqual([
      "Week 2 - 1 entry with no pick, 1 to chase - closes Fri 12:00 PM ET",
      "Owner One (one@example.com) - 1 of 1 entry with no pick - closes Fri 12:00 PM ET",
    ]);
    expect(reportPickGap(s).preamble).toContain("/admin/week/2");
  });
});

describe("what counts as picked", () => {
  it("is NO ACTION when every live entry holds a current pick for the open week", () => {
    const report = reportPickGap(snapshot({
      entries: ownerWith("Owner One", "one@example.com", 2, "a"),
      picks: [
        { entryId: "a1", week: 1, team: "NE", submittedAt: EARLY, late: false, source: "email" },
        { entryId: "a2", week: 1, team: "SF", submittedAt: EARLY, late: false, source: "text" },
      ],
    }));
    expect(report.items).toEqual([]);
    expect(report.preamble).toBeUndefined();
  });

  it("does not let another week's pick stand in for this one", () => {
    expect(texts(snapshot({
      entries: ownerWith("Owner One", "one@example.com", 1, "a"),
      picks: [{ entryId: "a1", week: 2, team: "NE", submittedAt: EARLY, late: false, source: "email" }],
    }))).toEqual([
      "Week 1 - 1 entry with no pick, 1 to chase - closes Fri 12:00 PM ET",
      "Owner One (one@example.com) - 1 of 1 entry with no pick - closes Fri 12:00 PM ET",
    ]);
  });
});

describe("escalation by how close the lock is", () => {
  const roster = () => [
    ...ownerWith("Owner One", "one@example.com", 4, "a"),
    ...ownerWith("Owner Two", "two@example.com", 4, "b"),
  ];
  // Owner One is missing 1 of 4, Owner Two 3 of 4.
  const partial = [
    { entryId: "a1", week: 1, team: "NE", submittedAt: EARLY, late: false, source: "email" },
    { entryId: "a2", week: 1, team: "SF", submittedAt: EARLY, late: false, source: "email" },
    { entryId: "a3", week: 1, team: "DAL", submittedAt: EARLY, late: false, source: "email" },
    { entryId: "b1", week: 1, team: "PHI", submittedAt: EARLY, late: false, source: "email" },
  ];
  const ownerOneLine = "Owner One (one@example.com) - 1 of 4 entries with no pick - closes Fri 12:00 PM ET";
  const ownerTwoLine = "Owner Two (two@example.com) - 3 of 4 entries with no pick - closes Fri 12:00 PM ET";

  it("gives the count and only the recipients missing more than half, while the lock is over a day off", () => {
    // Owner One's single silent entry is inside the count and off the list:
    // twelve lines do not stretch to everyone two days out.
    expect(texts(snapshot({ now: FAR, entries: roster(), picks: partial }))).toEqual([
      "Week 1 - 4 entries with no pick, 2 to chase - closes Fri 12:00 PM ET",
      ownerTwoLine,
    ]);
  });

  it("leaves a recipient missing exactly half off that list", () => {
    expect(texts(snapshot({
      now: FAR,
      entries: ownerWith("Owner One", "one@example.com", 4, "a"),
      picks: partial.slice(0, 2),
    }))).toEqual(["Week 1 - 2 entries with no pick, 1 to chase - closes Fri 12:00 PM ET"]);
  });

  it("names every recipient inside the last day, because each entry takes an automatic loss", () => {
    expect(texts(snapshot({ now: NEAR, entries: roster(), picks: partial }))).toEqual([
      "Week 1 - 4 entries with no pick, each an automatic loss - closes Fri 12:00 PM ET",
      ownerOneLine,
      ownerTwoLine,
    ]);
  });

  it("is already inside the last day at exactly one day out", () => {
    expect(texts(snapshot({ now: ONE_DAY_OUT, entries: roster(), picks: partial }))).toContain(ownerOneLine);
  });

  it("is still the quiet form one minute earlier - it reads s.now, never a clock of its own", () => {
    expect(texts(snapshot({ now: JUST_OVER_A_DAY, entries: roster(), picks: partial }))).not.toContain(ownerOneLine);
  });
});

describe("who is asked for the entry", () => {
  it("puts a gifted entry on the giftee's line and leaves it off the buyer's", () => {
    const entries = [
      entry({ id: "k1", entryName: "Kris Tomasco #1", ownerName: "Kris Tomasco", ownerEmail: "kris@example.com" }),
      entry({ id: "k2", entryName: "Kris Tomasco #2", ownerName: "Kris Tomasco", ownerEmail: "kris@example.com" }),
      entry({
        id: "c1", entryName: "Chas Flaster #1", ownerName: "Kris Tomasco", ownerEmail: "kris@example.com",
        isGifted: true, playerEmail: "chas@example.com",
      }),
      entry({
        id: "c2", entryName: "Chas Flaster #2", ownerName: "Kris Tomasco", ownerEmail: "kris@example.com",
        isGifted: true, playerEmail: "chas@example.com",
      }),
    ];
    // The buyer keeps the money and the tier and loses the pick, so his line is
    // two and never four, and Chas is greeted by his entry names because the
    // roster stores no name for a giftee (CLAUDE.md, Gifted entries).
    expect(texts(snapshot({ now: NEAR, entries }))).toEqual([
      "Week 1 - 4 entries with no pick, each an automatic loss - closes Fri 12:00 PM ET",
      "Kris Tomasco (kris@example.com) - 2 of 2 entries with no pick - closes Fri 12:00 PM ET",
      "Chas Flaster #1 and Chas Flaster #2 (chas@example.com) - 2 of 2 entries with no pick - closes Fri 12:00 PM ET",
    ]);
  });

  it("gives one person gifted by two buyers a single line", () => {
    const entries = [
      entry({
        id: "r1", entryName: "Johnvas #1", ownerName: "Ray Vassallo", ownerEmail: "ray@example.com",
        isGifted: true, playerEmail: "john@example.com",
      }),
      entry({
        id: "n1", entryName: "Nick gift #1", ownerName: "Nicholas Teti", ownerEmail: "nick@example.com",
        isGifted: true, playerEmail: "john@example.com",
      }),
    ];
    expect(texts(snapshot({ now: NEAR, entries }))).toEqual([
      "Week 1 - 2 entries with no pick, each an automatic loss - closes Fri 12:00 PM ET",
      "Johnvas #1 and Nick gift #1 (john@example.com) - 2 of 2 entries with no pick - closes Fri 12:00 PM ET",
    ]);
  });

  it("surfaces an addressless gift as its own item, on nobody's request", () => {
    const entries = [
      entry({ id: "n1", entryName: "Nick D #1", ownerName: "Nick DiVirgilio", ownerEmail: "nickd@example.com" }),
      entry({ id: "n2", entryName: "Nick D #2", ownerName: "Nick DiVirgilio", ownerEmail: "nickd@example.com" }),
      entry({
        id: "l1", entryName: "Lou Direnzo #1", ownerName: "Nick DiVirgilio", ownerEmail: "nickd@example.com",
        isGifted: true, playerEmail: null,
      }),
      entry({
        id: "l2", entryName: "Lou Direnzo #2", ownerName: "Nick DiVirgilio", ownerEmail: "nickd@example.com",
        isGifted: true, playerEmail: null,
      }),
    ];
    const report = reportPickGap(snapshot({ now: FAR, entries }));
    // All four are in the count; two of them are on nobody's request, and the
    // buyer is asked for his own two and no more.
    expect(report.items.map((i) => i.text)).toEqual([
      "Week 1 - 4 entries with no pick, 1 to chase - closes Fri 12:00 PM ET",
      "2 gifted entries with no pick on nobody's Week 1 request - no address on file - closes Fri 12:00 PM ET",
      "Nick DiVirgilio (nickd@example.com) - 2 of 2 entries with no pick - closes Fri 12:00 PM ET",
    ]);
    expect(report.items[1].names).toEqual([
      "Lou Direnzo #1 (bought by Nick DiVirgilio)",
      "Lou Direnzo #2 (bought by Nick DiVirgilio)",
    ]);
  });

  it("does not report an addressless gift that already holds a pick", () => {
    const report = reportPickGap(snapshot({
      now: FAR,
      entries: [entry({
        id: "l1", entryName: "Lou Direnzo #1", ownerName: "Nick DiVirgilio", ownerEmail: "nickd@example.com",
        isGifted: true, playerEmail: null,
      })],
      picks: [{ entryId: "l1", week: 1, team: "NE", submittedAt: EARLY, late: false, source: "text" }],
    }));
    expect(report.items).toEqual([]);
  });

  it("names an entry nobody can be asked for when the owner has no address", () => {
    const report = reportPickGap(snapshot({
      now: FAR,
      entries: [entry({ id: "x1", entryName: "TNat", ownerName: "Tom Nat", ownerEmail: null })],
    }));
    expect(report.items.map((i) => i.text)).toEqual([
      "Week 1 - 1 entry with no pick, 0 to chase - closes Fri 12:00 PM ET",
      "1 entry with no pick and nobody to ask - no address on file for the owner - closes Fri 12:00 PM ET",
    ]);
    expect(report.items[1].names).toEqual(["TNat (Tom Nat)"]);
  });
});

describe("the deadline every item names", () => {
  const s = snapshot({
    now: NEAR,
    entries: [
      ...ownerWith("Owner One", "one@example.com", 1, "a"),
      entry({
        id: "g1", entryName: "gift", ownerName: "Owner One", ownerEmail: "one@example.com",
        isGifted: true, playerEmail: null,
      }),
    ],
  });

  it("is the week's late boundary, in ET, on every line", () => {
    const lines = texts(s);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toContain("closes Fri 12:00 PM ET");
  });

  it("never names a tier, because the team that would bind one has not been chosen", () => {
    // Tue 12:00 PM ET is the Wednesday game's tier. Printing it beside a
    // missing pick would be claiming a pick nobody has made.
    expect(texts(s).join("\n")).not.toContain("Tue");
  });
});

describe("the report as it prints", () => {
  it("carries no preamble when there is nothing to chase", () => {
    expect(reportPickGap(snapshot({ entries: [] })).preamble).toBeUndefined();
  });

  it("sends Anthony to the week screen before he chases anyone", () => {
    const report = reportPickGap(snapshot({ entries: ownerWith("Owner One", "one@example.com", 1, "a") }));
    expect(report.preamble).toBe("confirm on /admin/week/1 before chasing; Gmail is not the record, the app is.");
  });

  it("keeps every recipient when the cap collapses the list", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry({ id: `e${i}`, entryName: `entry ${i}`, ownerName: `Owner ${i}`, ownerEmail: `owner${i}@example.com` }),
    );
    const joined = renderReport(reportPickGap(snapshot({ now: NEAR, entries }))).join("\n");
    for (let i = 0; i < 30; i++) {
      expect(joined, `owner${i}@example.com was dropped to fit the cap`).toContain(`owner${i}@example.com`);
    }
  });
});
