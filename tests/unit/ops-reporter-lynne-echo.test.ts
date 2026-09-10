import { describe, expect, it } from "vitest";
import { renderReport } from "../../scripts/ops/lib/report";
import { reportLynneEcho } from "../../scripts/ops/reporters/lynne-echo";
import type {
  EntrySnapshot,
  HerRowSnapshot,
  OpsSnapshot,
  PickSnapshot,
  SheetSnapshot,
  WeekSnapshot,
} from "../../scripts/ops/reporters/types";

// Two weeks of the real shape, in EDT (UTC-4): noon ET is 16:00 UTC. Early is
// Wednesday noon, late is Friday noon, and deadlineFor derives the Wednesday
// tier a day below early. So in Week 2 a Seattle pick (Wednesday game) closes
// Tue 12:00 PM ET and a Dallas pick (Sunday game) closes Fri 12:00 PM ET - two
// days apart in one week, which is what makes "the earliest of the two teams"
// testable at all.
const WEEKS: WeekSnapshot[] = [
  { week: 1, earlyDeadlineAt: "2026-09-09T16:00:00Z", lateDeadlineAt: "2026-09-11T16:00:00Z" },
  { week: 2, earlyDeadlineAt: "2026-09-16T16:00:00Z", lateDeadlineAt: "2026-09-18T16:00:00Z" },
];

const GAMES = [1, 2].flatMap((week) => [
  { week, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE", kickoffAt: "2026-09-10T00:20:00Z" },
  { week, dayOfWeek: "Sunday", homeTeam: "DAL", awayTeam: "PHI", kickoffAt: "2026-09-13T17:00:00Z" },
]);

/** Monday 2026-09-14, 11:00 AM ET: Week 1 has locked, Week 2 is the open week. */
const NOW = new Date("2026-09-14T15:00:00Z");

const SHEET: SheetSnapshot = {
  sha256: "cc7a987c",
  sourceFile: "Football 2026-3.xlsx",
  gmailMessageId: "1a082df163b5a6e6",
  loadedAt: "2026-09-08T23:10:00Z",
  rowCount: 1319,
};

function snap(over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  return {
    now: NOW,
    weeks: WEEKS,
    games: GAMES,
    entries: [entry()],
    picks: [],
    herRows: [],
    herSheet: SHEET,
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
    submittedToLynneAt: "2026-08-24T23:23:18Z",
    submittedAsName: "Tommybrads #1",
    ...over,
  };
}

function herRow(over: Partial<HerRowSnapshot> = {}): HerRowSnapshot {
  return {
    rowNo: 972,
    names: "Tommybrads #1",
    cells: {},
    cellSources: {},
    ...over,
  };
}

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

const lines = (s: OpsSnapshot) => reportLynneEcho(s).items.map((i) => i.text);
const text = (s: OpsSnapshot) => lines(s).join("\n");

describe("reportLynneEcho", () => {
  it("reports itself as lynne-echo", () => {
    expect(reportLynneEcho(snap()).job).toBe("lynne-echo");
  });

  it("compares nothing when no sheet of hers is loaded", () => {
    // The rows are a plain variance: only the missing sheet keeps them quiet.
    const s = snap({
      herSheet: null,
      herRows: [herRow({ cells: { 2: "Dallas" } })],
      picks: [pick({ team: "SEA" })],
    });
    expect(reportLynneEcho(s).items).toEqual([]);
    expect(renderReport(reportLynneEcho(s))).toEqual(["NO ACTION"]);
  });

  it("says nothing when her cell and our pick are the same team", () => {
    const s = snap({ herRows: [herRow({ cells: { 2: "Seattle" } })], picks: [pick({ team: "SEA" })] });
    expect(reportLynneEcho(s).items).toEqual([]);
    expect(reportLynneEcho(s).preamble).toBeUndefined();
  });

  it("matches her word case-insensitively, so her casing alone is not a variance", () => {
    const s = snap({ herRows: [herRow({ cells: { 2: "SEATTLE" } })], picks: [pick({ team: "sea" })] });
    expect(reportLynneEcho(s).items).toEqual([]);
  });

  it("never matches fuzzily: SEAHOWEVER is not SEA", () => {
    // Her "Seattle" maps to SEA; our SEAHAWKS is a different string and must
    // read as a difference, not as a near-enough match.
    const s = snap({ herRows: [herRow({ cells: { 2: "Seattle" } })], picks: [pick({ team: "SEAHAWKS" })] });
    expect(text(s)).toContain('she has "Seattle" (SEA), we hold SEAHAWKS');
  });

  it("carries both values on a mismatch and says which is right about neither", () => {
    // The Week 1 pick is one she has left blank, so it adds no line: the count
    // here is the silence rule as much as the variance.
    const s = snap({
      herRows: [herRow({ cells: { 2: "Dallas" } })],
      picks: [pick({ week: 1, team: "DAL" }), pick({ week: 2, team: "SEA" })],
    });
    const r = reportLynneEcho(s);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toContain("Tommybrads #1 (her NO. 972) Week 2");
    expect(r.items[0].text).toContain('she has "Dallas" (DAL), we hold SEA');
    expect(r.preamble).toBe("compare on /admin/import; neither side is corrected here.");
  });

  it("reports a week she has filled that this group holds no pick for", () => {
    const s = snap({ herRows: [herRow({ cells: { 2: "Dallas" } })], picks: [] });
    expect(text(s)).toContain('she has "Dallas" (DAL), this group holds no pick for it');
  });

  it("says nothing when we hold a pick and she has left the week blank", () => {
    // Her list is partial and her sheet shrinks: silence from her is not a
    // variance and is never an elimination.
    const s = snap({ herRows: [herRow({ cells: { 1: "Seattle" } })], picks: [pick({ week: 1, team: "SEA" }), pick({ week: 2, team: "DAL" })] });
    expect(reportLynneEcho(s).items).toEqual([]);
  });

  it("treats a blank cell of hers as a week she has not filled", () => {
    const s = snap({ herRows: [herRow({ cells: { 2: "   " } })], picks: [pick({ team: "SEA" })] });
    expect(reportLynneEcho(s).items).toEqual([]);
  });

  it("quotes a word of hers that maps to nothing exactly, and guesses no team", () => {
    const s = snap({ herRows: [herRow({ cells: { 2: " Seatle " } })], picks: [pick({ team: "SEA" })] });
    const t = text(s);
    expect(t).toContain('her cell reads " Seatle " and is not one of her team names');
    expect(t).toContain("we hold SEA");
    expect(t).not.toMatch(/\(SEA\)/);
  });

  it("says so when a word of hers maps to nothing and this group holds no pick either", () => {
    const s = snap({ herRows: [herRow({ cells: { 2: "OUT" } })], picks: [] });
    expect(text(s)).toContain('her cell reads "OUT" and is not one of her team names - this group holds no pick');
  });

  it("never reports a row of hers that carries none of our numbers", () => {
    const s = snap({ herRows: [herRow({ rowNo: 9999, names: "Somebody Else", cells: { 2: "Dallas" } })], picks: [pick({ team: "SEA" })] });
    expect(reportLynneEcho(s).items).toEqual([]);
  });

  it("matches on her NO. only - never on her NAMES text", () => {
    // Her row carries our entry name exactly and a number that is not ours.
    // Matching that by name is what the number is there to prevent.
    const s = snap({
      herRows: [herRow({ rowNo: 1311, names: "Tommybrads #1", cells: { 2: "Dallas" } })],
      picks: [pick({ team: "SEA" })],
    });
    expect(reportLynneEcho(s).items).toEqual([]);
  });

  it("names the earlier of the two tiers on the line, and whose it is", () => {
    // She has Dallas (Sunday, Fri noon); we hold Seattle (Wednesday, Tue noon).
    const s = snap({ herRows: [herRow({ cells: { 2: "Dallas" } })], picks: [pick({ team: "SEA" })] });
    expect(text(s)).toContain("Week 2 closes for SEA at Tue 12:00 PM ET");
  });

  it("names no team when both sides close in the same tier", () => {
    const s = snap({ herRows: [herRow({ cells: { 2: "Dallas" } })], picks: [pick({ team: "PHI" })] });
    const t = text(s);
    expect(t).toContain("Week 2 closes at Fri 12:00 PM ET");
    expect(t).not.toContain("closes for");
  });

  it("says closed, not closes, for a week already behind us", () => {
    const s = snap({
      herRows: [herRow({ cells: { 1: "Dallas" } })],
      picks: [pick({ week: 1, team: "PHI" })],
    });
    expect(text(s)).toContain("Week 1 closed at Fri 12:00 PM ET");
  });

  it("says a week has no deadline on record rather than printing one", () => {
    const s = snap({
      weeks: [],
      herRows: [herRow({ cells: { 2: "Dallas" } })],
      picks: [pick({ team: "SEA" })],
    });
    expect(text(s)).toContain("Week 2 has no deadline on record");
  });

  it("leads with the open week", () => {
    const s = snap({
      herRows: [herRow({ cells: { 1: "Dallas", 2: "Dallas" } })],
      picks: [pick({ week: 1, team: "SEA" }), pick({ week: 2, team: "SEA" })],
    });
    expect(lines(s)[0]).toContain("Week 2");
    expect(lines(s)[1]).toContain("Week 1");
  });

  it("keeps every name when the list collapses past the cap", () => {
    const entries = Array.from({ length: 14 }, (_, i) =>
      entry({ id: `e${i}`, entryName: `Entry #${i}`, lynneNumber: 900 + i }),
    );
    const s = snap({
      entries,
      herRows: entries.map((e, i) => herRow({ rowNo: 900 + i, names: e.entryName, cells: { 2: "Dallas" } })),
      picks: entries.map((e) => pick({ entryId: e.id, team: "SEA" })),
    });
    const r = reportLynneEcho(s);
    expect(r.items).toHaveLength(14);
    const rendered = renderReport(r).join("\n");
    for (const e of entries) expect(rendered).toContain(e.entryName);
  });
});
