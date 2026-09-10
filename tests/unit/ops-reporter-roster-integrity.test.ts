import { describe, expect, it } from "vitest";
import { renderReport } from "../../scripts/ops/lib/report";
import { reportRosterIntegrity } from "../../scripts/ops/reporters/roster-integrity";
import type {
  EntrySnapshot,
  GameSnapshot,
  OpsSnapshot,
  WeekSnapshot,
} from "../../scripts/ops/reporters/types";

// Three weeks in EDT (UTC-4), so noon ET is 16:00 UTC: Wednesday noon is the
// early boundary and Friday noon the late one, exactly as the weeks table
// stores them. Every "locks" line below comes out of these through deadlineFor
// and etLabel, never written by hand in the reporter - the shifted-week test
// at the bottom is what holds it to that.
const WEEKS: WeekSnapshot[] = [
  { week: 1, earlyDeadlineAt: "2026-09-09T16:00:00Z", lateDeadlineAt: "2026-09-11T16:00:00Z" },
  { week: 2, earlyDeadlineAt: "2026-09-16T16:00:00Z", lateDeadlineAt: "2026-09-18T16:00:00Z" },
  { week: 3, earlyDeadlineAt: "2026-09-23T16:00:00Z", lateDeadlineAt: "2026-09-25T16:00:00Z" },
];

const GAMES: GameSnapshot[] = [1, 2, 3].flatMap((week) => [
  { week, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE", kickoffAt: "2026-09-10T00:20:00Z" },
  { week, dayOfWeek: "Sunday", homeTeam: "DAL", awayTeam: "PHI", kickoffAt: "2026-09-13T17:00:00Z" },
]);

/** Thursday 2026-09-17, 11:00 AM ET: Week 1 has locked, Week 2 is open. */
const NOW = new Date("2026-09-17T15:00:00Z");
/** The lock the roster lines are tied to, spelled as etLabel renders it. */
const LOCK = "Week 2 locks Fri 12:00 PM ET";

/** Two addresses, and the gate set to exactly them, so the base snapshot is quiet. */
const ADDRESSES = ["chas.flaster@example.com", "tom@example.com"];

function snap(over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  return {
    now: NOW,
    weeks: WEEKS,
    games: GAMES,
    entries: [entry()],
    picks: [],
    herRows: [],
    herSheet: null,
    herMail: [],
    owners: [],
    payments: [],
    recipientAddresses: [...ADDRESSES],
    expectedRosterAddresses: ADDRESSES.length,
    freeEntryCount: 0,
    recruitedCount: 0,
    lynneRateCents: 2500,
    ...over,
  };
}

/** A live entry with nothing wrong with it: numbered, not gifted, uniquely named. */
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
    submittedToLynneAt: "2026-08-24T23:23:18Z",
    submittedAsName: "Tommybrads #1",
    ...over,
  };
}

function texts(s: OpsSnapshot): string[] {
  return reportRosterIntegrity(s).items.map((i) => i.text);
}

/** The one line that mentions `needle`, for a test that wants to read it whole. */
function lineWith(s: OpsSnapshot, needle: string): string {
  const found = texts(s).filter((t) => t.includes(needle));
  expect(found).toHaveLength(1);
  return found[0];
}

describe("roster-integrity: the job it reports as", () => {
  it("names itself roster-integrity, which is what daily.ts prints and notify posts", () => {
    expect(reportRosterIntegrity(snap()).job).toBe("roster-integrity");
  });
});

describe("roster-integrity: a roster with nothing wrong", () => {
  it("is NO ACTION - an empty item list, never a line saying there is nothing to report", () => {
    const r = reportRosterIntegrity(snap());
    expect(r.items).toEqual([]);
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });
});

describe("roster-integrity: the recipient count gate", () => {
  it("is silent when the derived count equals the constant exactly", () => {
    expect(texts(snap())).toEqual([]);
  });

  it("names BOTH numbers and the shortfall when the derived list is short - the 27-of-39 shape", () => {
    const line = lineWith(snap({ expectedRosterAddresses: 5 }), "derived from the live roster");
    expect(line).toContain("2 addresses derived from the live roster");
    expect(line).toContain("5 expected");
    expect(line).toContain("3 fewer than expected");
  });

  it("names BOTH numbers and the surplus when the derived list is long", () => {
    const line = lineWith(snap({ expectedRosterAddresses: 1 }), "derived from the live roster");
    expect(line).toContain("2 addresses derived from the live roster");
    expect(line).toContain("1 expected");
    expect(line).toContain("1 more than expected");
  });

  it("prints every derived address on the line, because a bare count cannot say which one moved", () => {
    const line = lineWith(snap({ expectedRosterAddresses: 5 }), "derived from the live roster");
    for (const a of ADDRESSES) expect(line).toContain(a);
    expect(line).toContain("a bare count cannot say which address moved");
  });

  it("carries every derived address in names, so a collapse keeps them", () => {
    const r = reportRosterIntegrity(snap({ expectedRosterAddresses: 5 }));
    expect(r.items[0].names).toEqual(ADDRESSES);
  });

  it("says the messages stop, and that the constant is a reviewed change and never a flag", () => {
    const line = lineWith(snap({ expectedRosterAddresses: 5 }), "derived from the live roster");
    expect(line).toContain("Whole-roster messages stop on this");
    expect(line).toContain("reviewed change, never a flag");
  });

  it("leads the report - a mismatch means nothing goes out at all, so it is read first", () => {
    const s = snap({
      expectedRosterAddresses: 5,
      entries: [entry({ lynneNumber: null })],
      freeEntryCount: 3,
      recruitedCount: 0,
    });
    const all = texts(s);
    expect(all.length).toBeGreaterThan(2);
    expect(all[0]).toContain("derived from the live roster");
  });
});

describe("roster-integrity: the free-entry entitlement", () => {
  it("is silent when held equals FLOOR(recruited / 10)", () => {
    expect(texts(snap({ recruitedCount: 110, freeEntryCount: 11 }))).toEqual([]);
  });

  it("is silent on the remainder - 119 recruited still earns 11", () => {
    expect(texts(snap({ recruitedCount: 119, freeEntryCount: 11 }))).toEqual([]);
  });

  it("reports a shortfall with both numbers and the recruited count behind them", () => {
    const line = lineWith(snap({ recruitedCount: 110, freeEntryCount: 9 }), "free entries held");
    expect(line).toContain("9 free entries held");
    expect(line).toContain("11 earned on 110 recruited");
    expect(line).toContain("FLOOR(recruited / 10)");
    expect(line).toContain("2 short");
  });

  it("sends a shortfall to the trigger, never to an app-layer mint", () => {
    const line = lineWith(snap({ recruitedCount: 110, freeEntryCount: 9 }), "free entries held");
    expect(line).toContain("mint_free_entries trigger");
    expect(line).toContain("do not mint in the app");
  });

  it("reports a surplus as Anthony's call and never a trigger's, because the mint never un-mints", () => {
    const line = lineWith(snap({ recruitedCount: 90, freeEntryCount: 11 }), "free entries held");
    expect(line).toContain("11 free entries held");
    expect(line).toContain("9 earned on 90 recruited");
    expect(line).toContain("a surplus of 2");
    expect(line).toContain("never un-mints");
    expect(line).toContain("Anthony's call and never a trigger's");
  });

  it("ties neither line to a deadline - an unminted entry owes nobody a pick", () => {
    for (const free of [9, 11]) {
      const line = lineWith(snap({ recruitedCount: 100, freeEntryCount: free }), "free entries held");
      expect(line).not.toContain("locks");
    }
  });
});

describe("roster-integrity: Lynne numbers", () => {
  it("leads with the count and names every live entry that has none", () => {
    const s = snap({
      entries: [
        entry({ id: "a", entryName: "AAA #11", lynneNumber: null, ownerName: "Anthony DellaPia" }),
        entry({ id: "b", entryName: "Mario 3rd #1", lynneNumber: null, ownerName: "Mario Tropea III" }),
        entry({ id: "c", entryName: "Rayvas #1", lynneNumber: 1001, ownerName: "Ray Vassallo" }),
      ],
    });
    const line = lineWith(s, "no Lynne number");
    expect(line).toContain("2 live entries with no Lynne number");
    expect(line).toContain("AAA #11 (Anthony DellaPia)");
    expect(line).toContain("Mario 3rd #1 (Mario Tropea III)");
    expect(line).not.toContain("Rayvas #1");
    expect(line).toContain(LOCK);
  });

  it("counts a free entry in - free entries still get numbers, they just do not bill", () => {
    const s = snap({ entries: [entry({ isFreeEntry: true, entryName: "AAA #11", lynneNumber: null })] });
    expect(lineWith(s, "no Lynne number")).toContain("1 live entry with no Lynne number");
  });

  it("reports one number held by two live entries, naming the number and both entries", () => {
    const s = snap({
      entries: [
        entry({ id: "a", entryName: "Johnvas #1", lynneNumber: 1001, ownerName: "Ray Vassallo" }),
        entry({ id: "b", entryName: "Rayvas #1", lynneNumber: 1001, ownerName: "Ray Vassallo" }),
      ],
    });
    const line = lineWith(s, "is held by");
    expect(line).toContain("Lynne number 1001 is held by 2 live entries");
    expect(line).toContain("Johnvas #1 (Ray Vassallo)");
    expect(line).toContain("Rayvas #1 (Ray Vassallo)");
    expect(line).toContain(LOCK);
  });

  it("says nothing when every number is held once", () => {
    const s = snap({
      entries: [
        entry({ id: "a", entryName: "Johnvas #1", lynneNumber: 1001 }),
        entry({ id: "b", entryName: "Rayvas #1", lynneNumber: 1002 }),
      ],
    });
    expect(texts(s)).toEqual([]);
  });
});

describe("roster-integrity: gifted with no address", () => {
  it("says plainly that it goes on nobody's pick request, and names the deadline to chase it by", () => {
    const s = snap({
      entries: [entry({ entryName: "Chas Flaster #1", isGifted: true, playerEmail: null, ownerName: "Kris Tomasco" })],
    });
    const line = lineWith(s, "gifted");
    expect(line).toContain("1 gifted entry with no address on file");
    expect(line).toContain("Chas Flaster #1 (bought by Kris Tomasco)");
    expect(line).toContain("NOBODY's pick request, not the buyer's");
    expect(line).toContain(LOCK);
  });

  it("asks whether it is an alias before it is chased, and names the entries that made that rule", () => {
    const s = snap({ entries: [entry({ entryName: "Lou Direnzo #1", isGifted: true, playerEmail: null })] });
    expect(lineWith(s, "gifted")).toContain("Lou Direnzo #1-#2, which are Nick DiVirgilio's own");
  });

  it("is silent on a gift that HAS an address - that one is on its giftee's own request", () => {
    const s = snap({ entries: [entry({ isGifted: true, playerEmail: "chas.flaster@example.com" })] });
    expect(texts(s)).toEqual([]);
  });

  it("is silent on an entry with no address that is not gifted at all - an alias is just a name", () => {
    const s = snap({ entries: [entry({ entryName: "Lou Direnzo #1", isGifted: false, playerEmail: null })] });
    expect(texts(s)).toEqual([]);
  });
});

describe("roster-integrity: entry-name collisions", () => {
  it("reports two names that differ only by case, both spellings verbatim", () => {
    const s = snap({
      entries: [
        entry({ id: "a", entryName: "Pumpy321", lynneNumber: 1001, ownerName: "Bill P" }),
        entry({ id: "b", entryName: "pumpy321", lynneNumber: 1002, ownerName: "Bill P" }),
      ],
    });
    const line = lineWith(s, "share one name");
    expect(line).toContain("2 live entries share one name");
    expect(line).toContain('"Pumpy321" (Bill P)');
    expect(line).toContain('"pumpy321" (Bill P)');
    expect(line).toContain(LOCK);
  });

  it("reports two names that differ only by edge whitespace, keeping the space inside the quotes", () => {
    const s = snap({
      entries: [
        entry({ id: "a", entryName: "Ernie DellaPia Jr. #1", lynneNumber: 1001 }),
        entry({ id: "b", entryName: "Ernie DellaPia Jr. #1 ", lynneNumber: 1002 }),
      ],
    });
    const line = lineWith(s, "share one name");
    expect(line).toContain('"Ernie DellaPia Jr. #1 "');
  });

  it("reports two identical names", () => {
    const s = snap({
      entries: [
        entry({ id: "a", entryName: "E.A.T.", lynneNumber: 1001, ownerName: "Ed T" }),
        entry({ id: "b", entryName: "E.A.T.", lynneNumber: 1002, ownerName: "Ed A" }),
      ],
    });
    const line = lineWith(s, "share one name");
    expect(line).toContain('"E.A.T." (Ed T)');
    expect(line).toContain('"E.A.T." (Ed A)');
  });

  it("gives three spellings of one name ONE line, not three pairs", () => {
    const s = snap({
      entries: [
        entry({ id: "a", entryName: "Amy 1", lynneNumber: 1001 }),
        entry({ id: "b", entryName: "amy 1", lynneNumber: 1002 }),
        entry({ id: "c", entryName: "AMY 1", lynneNumber: 1003 }),
      ],
    });
    const lines = texts(s);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("3 live entries share one name");
  });

  it("leaves an edit-1 pair to the collision detector - Tommybrads #1 and tommybrads #2 are not a daily line", () => {
    const s = snap({
      entries: [
        entry({ id: "a", entryName: "Tommybrads #1", lynneNumber: 1001 }),
        entry({ id: "b", entryName: "tommybrads #2", lynneNumber: 1002 }),
      ],
    });
    expect(texts(s)).toEqual([]);
  });

  it("leaves a plain numbered set alone", () => {
    const s = snap({
      entries: [
        entry({ id: "a", entryName: "Nick&Kels #1", lynneNumber: 1001 }),
        entry({ id: "b", entryName: "Nick&Kels #2", lynneNumber: 1002 }),
        entry({ id: "c", entryName: "Nick&Kels #3", lynneNumber: 1003 }),
      ],
    });
    expect(texts(s)).toEqual([]);
  });
});

describe("roster-integrity: the deadline every tied line names", () => {
  it("derives the lock from the weeks table rather than printing a fixed string", () => {
    const shifted: WeekSnapshot[] = [
      { week: 1, earlyDeadlineAt: "2026-09-09T16:00:00Z", lateDeadlineAt: "2026-09-11T16:00:00Z" },
      // Thursday 6:00 PM ET instead of Friday noon: a line that hardcodes the
      // Friday text cannot follow this.
      { week: 2, earlyDeadlineAt: "2026-09-15T16:00:00Z", lateDeadlineAt: "2026-09-17T22:00:00Z" },
    ];
    const s = snap({ weeks: shifted, entries: [entry({ lynneNumber: null })] });
    expect(lineWith(s, "no Lynne number")).toContain("Week 2 locks Thu 6:00 PM ET");
  });

  it("names no lock at all once every week has locked, rather than inventing one", () => {
    const s = snap({ now: new Date("2027-02-01T12:00:00Z"), entries: [entry({ lynneNumber: null })] });
    const line = lineWith(s, "no Lynne number");
    expect(line).not.toContain("locks");
    expect(line.endsWith("ask her for it")).toBe(true);
  });

  it("reads the clock off s.now and nothing else - the same snapshot at an earlier now names Week 1", () => {
    const s = snap({ now: new Date("2026-09-10T15:00:00Z"), entries: [entry({ lynneNumber: null })] });
    expect(lineWith(s, "no Lynne number")).toContain("Week 1 locks Fri 12:00 PM ET");
  });
});

describe("roster-integrity: the output contract", () => {
  it("collapses past twelve lines and keeps every name it carried", () => {
    const entries: EntrySnapshot[] = [];
    for (let n = 1; n <= 12; n++) {
      // Twelve numbers, each held twice: twelve items, two lines over the cap.
      entries.push(entry({ id: `a${n}`, entryName: `Owner ${n} #1`, lynneNumber: 1000 + n }));
      entries.push(entry({ id: `b${n}`, entryName: `Owner ${n} #2`, lynneNumber: 1000 + n }));
    }
    const r = reportRosterIntegrity(snap({ entries }));
    expect(r.items).toHaveLength(12);
    const lines = renderReport(r);
    expect(lines).toHaveLength(12);
    expect(lines[0]).toBe("NEEDS ANTHONY");
    // Every entry in the folded tail survives into the collapsed line.
    const collapsed = lines[lines.length - 1];
    for (const e of r.items.slice(9).flatMap((i) => i.names ?? [])) {
      expect(collapsed).toContain(e);
    }
  });

  it("prints the preamble only when there is something to say", () => {
    expect(reportRosterIntegrity(snap()).preamble).toBeUndefined();
    const r = reportRosterIntegrity(snap({ expectedRosterAddresses: 5 }));
    expect(r.preamble).toContain("question for Anthony");
    expect(r.preamble).toContain("corrects nothing");
  });
});
