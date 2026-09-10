import { describe, expect, it } from "vitest";
import { renderReport } from "../../scripts/ops/lib/report";
import { reportSheetWatch } from "../../scripts/ops/reporters/sheet-watch";
import type {
  EntrySnapshot,
  GameSnapshot,
  HerMailSnapshot,
  HerRowSnapshot,
  OpsSnapshot,
  SheetSnapshot,
  WeekSnapshot,
} from "../../scripts/ops/reporters/types";

// Three weeks in EDT (UTC-4), so noon ET is 16:00 UTC: Wednesday noon is the
// early boundary and Friday noon the late one, exactly as the weeks table
// stores them. Every "locks" line below is derived from these through
// deadlineFor and etLabel, never written out by hand in the reporter.
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
/** The lock every sheet line is tied to, spelled as etLabel renders it. */
const WEEK_2_LOCK = "Week 2 locks Fri 12:00 PM ET";

/** Her sheet as loaded: Tuesday 2026-09-15 at 6:00 PM ET. */
const SHEET: SheetSnapshot = {
  sha256: "cc7a987c",
  sourceFile: "Football 2026-3.xlsx",
  gmailMessageId: "1a082df163b5a6e6",
  loadedAt: "2026-09-15T22:00:00Z",
  rowCount: 1319,
};

function snap(over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  return {
    now: NOW,
    weeks: WEEKS,
    games: GAMES,
    entries: [],
    picks: [],
    herRows: [],
    herSheet: SHEET,
    herMail: [],
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

/** One of her rows, carrying a team name so it is quiet by default. */
function herRow(over: Partial<HerRowSnapshot> = {}): HerRowSnapshot {
  return {
    rowNo: 972,
    names: "Tommybrads #1",
    cells: { 1: "Seattle" },
    cellSources: { 1: "sheet" },
    ...over,
  };
}

/** The message her loaded sheet came in on: before loadedAt, so it is quiet. */
function loadedMail(over: Partial<HerMailSnapshot> = {}): HerMailSnapshot {
  return {
    messageId: SHEET.gmailMessageId!,
    subject: "Sheet",
    receivedAt: "2026-09-15T20:00:00Z",
    filenames: ["Football 2026-3.xlsx"],
    hasAttachment: true,
    ...over,
  };
}

function texts(s: OpsSnapshot): string[] {
  return reportSheetWatch(s).items.map((i) => i.text);
}

describe("sheet-watch: the job it reports as", () => {
  it("names itself sheet-watch, which is what daily.ts prints and notify posts", () => {
    expect(reportSheetWatch(snap()).job).toBe("sheet-watch");
  });
});

describe("sheet-watch: her mail unreadable", () => {
  it("says the watch is blind rather than NO ACTION, which would read as nothing waiting", () => {
    const r = reportSheetWatch(snap({ herMail: null }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toContain("blind");
    expect(r.items[0].text).toContain("could not be read");
    expect(renderReport(r)).not.toEqual(["NO ACTION"]);
  });

  it("still reports what the database knows: Gmail being off hides no dropped row", () => {
    const lines = texts(
      snap({
        herMail: null,
        entries: [entry({ lynneNumber: 973 })],
        herRows: [herRow()],
      }),
    );
    expect(lines.some((t) => t.includes("blind"))).toBe(true);
    expect(lines.some((t) => t.includes("not on her newest sheet"))).toBe(true);
  });
});

describe("sheet-watch: a newer sheet of hers sitting unloaded", () => {
  const waiting = loadedMail({
    messageId: "19f2c0a1b2c3d4e5",
    receivedAt: "2026-09-16T12:12:00Z",
    filenames: ["Football 2026-4.xlsx"],
  });

  it("names the message id, the filename and the ET arrival, and says it is not loaded", () => {
    const lines = texts(snap({ herMail: [loadedMail(), waiting] }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("19f2c0a1b2c3d4e5");
    expect(lines[0]).toContain("Football 2026-4.xlsx");
    expect(lines[0]).toContain("Wed 8:12 AM ET");
    expect(lines[0]).toContain("not loaded");
  });

  it("names the sheet that IS loaded, so the two are comparable on one line", () => {
    const lines = texts(snap({ herMail: [waiting] }));
    expect(lines[0]).toContain("Football 2026-3.xlsx");
    expect(lines[0]).toContain("Tue 6:00 PM ET");
  });

  it("says nothing when her newest Football xlsx is the one already loaded", () => {
    const r = reportSheetWatch(snap({ herMail: [loadedMail()] }));
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("says nothing about an older Football sheet of hers still sitting in the mailbox", () => {
    // Last week's sheet, on its own message, that loadedAt is already past.
    // Reporting it would send Anthony to load a sheet older than the one in
    // the table - the watch asks about newer mail, not about all of it.
    const r = reportSheetWatch(
      snap({
        herMail: [
          loadedMail(),
          loadedMail({ messageId: "older", receivedAt: "2026-09-08T18:00:00Z", filenames: ["Football 2026-2.xlsx"] }),
        ],
      }),
    );
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("says nothing about the loaded message even when its Gmail time is after loadedAt", () => {
    // Her sheet is loaded from the attachment on that message, so the id is
    // the exact answer; the clock is the approximate one.
    const r = reportSheetWatch(snap({ herMail: [loadedMail({ receivedAt: "2026-09-16T12:12:00Z" })] }));
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("ignores mail of hers carrying no Football xlsx", () => {
    const r = reportSheetWatch(
      snap({
        herMail: [
          loadedMail({ messageId: "aaa", receivedAt: "2026-09-16T12:12:00Z", filenames: ["Football 2026-4.pdf"] }),
          loadedMail({ messageId: "bbb", receivedAt: "2026-09-16T13:12:00Z", filenames: ["DellaPia_Week1_Picks.csv"] }),
          loadedMail({ messageId: "ccc", receivedAt: "2026-09-16T14:12:00Z", filenames: [], hasAttachment: false }),
          // A spreadsheet of hers that is not the Final Sheet. The watch is
          // for the Football file the roster loader reads, not every .xlsx.
          loadedMail({ messageId: "ddd", receivedAt: "2026-09-16T15:12:00Z", filenames: ["Payouts 2026.xlsx"] }),
        ],
      }),
    );
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("carries every filename and message id through a collapse - no waiting sheet is dropped to fit", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      loadedMail({
        messageId: `m${i}`,
        receivedAt: `2026-09-16T12:${String(i).padStart(2, "0")}:00Z`,
        filenames: [`Football 2026-${i + 4}.xlsx`],
      }),
    );
    const lines = renderReport(reportSheetWatch(snap({ herMail: many })));
    expect(lines.length).toBeLessThanOrEqual(12);
    const whole = lines.join("\n");
    for (const m of many) {
      expect(whole).toContain(m.filenames[0]);
      expect(whole).toContain(`message ${m.messageId}`);
    }
  });
});

describe("sheet-watch: nothing of hers loaded at all", () => {
  it("says so", () => {
    const lines = texts(snap({ herSheet: null, herMail: [] }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("No sheet of hers is loaded");
  });

  it("treats every Football xlsx of hers as waiting when none has been loaded", () => {
    const lines = texts(
      snap({
        herSheet: null,
        herMail: [loadedMail({ messageId: "zzz", filenames: ["Football 2026-3.xlsx"] })],
      }),
    );
    expect(lines.some((t) => t.includes("zzz") && t.includes("not loaded"))).toBe(true);
  });

  it("calls nothing dropped when her table is empty - 121 findings would be the reporter inventing them", () => {
    const lines = texts(snap({ herSheet: null, herMail: [], entries: [entry(), entry({ id: "e2", lynneNumber: 973 })] }));
    expect(lines.some((t) => t.includes("not on her newest sheet"))).toBe(false);
  });
});

describe("sheet-watch: rows of ours she has dropped", () => {
  const rows = [herRow({ rowNo: 972 }), herRow({ rowNo: 974, names: "AAA #1" })];

  it("leads with the count and names every entry with its NO.", () => {
    const lines = texts(
      snap({
        herRows: rows,
        entries: [
          entry({ id: "e1", entryName: "Tommybrads #1", lynneNumber: 972 }),
          entry({ id: "e2", entryName: "Nicco E", lynneNumber: 973 }),
          entry({ id: "e3", entryName: "E.A.T.", lynneNumber: 975 }),
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^2 of ours are not on her newest sheet/);
    expect(lines[0]).toContain("Nicco E (NO. 973)");
    expect(lines[0]).toContain("E.A.T. (NO. 975)");
    expect(lines[0]).not.toContain("Tommybrads");
  });

  it("says her sheet shrinking is not a data error and not a row to re-add", () => {
    const lines = texts(snap({ herRows: rows, entries: [entry({ lynneNumber: 973 })] }));
    expect(lines[0]).toContain("not a data error");
    expect(lines[0]).toContain("not a row to re-add");
  });

  it("names the deadline it is tied to, derived from the weeks table and not written out", () => {
    const lines = texts(snap({ herRows: rows, entries: [entry({ lynneNumber: 973 })] }));
    expect(lines[0]).toContain(WEEK_2_LOCK);
    // A week on, the same snapshot names Week 3's boundary: the line follows
    // openWeek and deadlineFor, so a hardcoded lock could not say both.
    const later = texts(
      snap({ now: new Date("2026-09-24T15:00:00Z"), herRows: rows, entries: [entry({ lynneNumber: 973 })] }),
    );
    expect(later[0]).toContain("Week 3 locks Fri 12:00 PM ET");
  });

  it("carries the entry and its NO. as names, so a collapse keeps them", () => {
    const r = reportSheetWatch(
      snap({
        herRows: rows,
        entries: [entry({ id: "e2", entryName: "Nicco E", lynneNumber: 973 }), entry({ id: "e3", entryName: "E.A.T.", lynneNumber: 975 })],
      }),
    );
    expect(r.items[0].names).toEqual(["Nicco E (NO. 973)", "E.A.T. (NO. 975)"]);
  });

  it("does not call an entry with no Lynne number dropped - she never had it", () => {
    const r = reportSheetWatch(snap({ herRows: rows, entries: [entry({ lynneNumber: null })] }));
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("matches by NO. only: her NAMES text never decides whether one of ours is on her sheet", () => {
    // Her row 973 is named for somebody else entirely. Ours at 973 is on her
    // sheet all the same, because the NO. is the match.
    const r = reportSheetWatch(
      snap({
        herRows: [herRow({ rowNo: 973, names: "somebody else" })],
        entries: [entry({ entryName: "Nicco E", lynneNumber: 973 })],
      }),
    );
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });
});

describe("sheet-watch: cells of hers that are not team names", () => {
  it("quotes her text exactly and names the entry, the NO. and the week", () => {
    const lines = texts(
      snap({
        herRows: [herRow({ cells: { 1: "Seattle", 2: "OUT " }, cellSources: { 1: "sheet", 2: "sheet" } })],
        entries: [entry()],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('her Week 2 cell reads "OUT "');
    expect(lines[0]).toContain("Tommybrads #1 (NO. 972)");
    expect(lines[0]).toContain(WEEK_2_LOCK);
  });

  it("reports a note of hers as her text, never as a decision", () => {
    const lines = texts(
      snap({
        herRows: [herRow({ cells: { 2: "dup - see wk 1" }, cellSources: { 2: "email" } })],
        entries: [entry()],
      }),
    );
    expect(lines[0]).toContain('"dup - see wk 1"');
  });

  it("says nothing about a cell holding one of her team names", () => {
    const r = reportSheetWatch(
      snap({
        herRows: [herRow({ cells: { 1: "Seattle", 2: "LA Rams", 3: "san francisco" }, cellSources: {} })],
        entries: [entry()],
      }),
    );
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("never reads silence as an elimination: a week she has left blank says nothing", () => {
    const r = reportSheetWatch(
      snap({
        herRows: [herRow({ cells: { 1: "Seattle", 2: "", 3: "   " }, cellSources: {} })],
        entries: [entry()],
      }),
    );
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("reads only our NO.s - her other 1,198 entries are never listed", () => {
    const r = reportSheetWatch(
      snap({
        herRows: [herRow({ rowNo: 972, cells: { 2: "Seattle" } }), herRow({ rowNo: 5, names: "Amy  1", cells: { 2: "OUT" } })],
        entries: [entry({ lynneNumber: 972 })],
      }),
    );
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("puts the newest week first - an earlier OUT stays on her sheet all season", () => {
    const lines = texts(
      snap({
        herRows: [herRow({ cells: { 1: "OUT", 3: "OUT", 2: "OUT" }, cellSources: {} })],
        entries: [entry()],
      }),
    );
    expect(lines.map((t) => /Week (\d+) cell/.exec(t)?.[1])).toEqual(["3", "2", "1"]);
  });

  it("keeps every entry, NO., week and quoted text when the lines collapse", () => {
    const herRows = Array.from({ length: 15 }, (_, i) => herRow({ rowNo: 972 + i, cells: { 2: "OUT" }, cellSources: {} }));
    const entries = Array.from({ length: 15 }, (_, i) =>
      entry({ id: `e${i}`, entryName: `AAA #${i + 1}`, lynneNumber: 972 + i }),
    );
    const lines = renderReport(reportSheetWatch(snap({ herRows, entries })));
    expect(lines.length).toBeLessThanOrEqual(12);
    const whole = lines.join("\n");
    for (let i = 0; i < 15; i++) expect(whole).toContain(`AAA #${i + 1} (NO. ${972 + i})`);
    expect(lines[lines.length - 1]).toContain('AAA #15 (NO. 986) Week 2 "OUT"');
  });
});

describe("sheet-watch: the standing rule sits above the lines", () => {
  it("says her sheet decides who is out and that this is a question, not a correction", () => {
    const r = reportSheetWatch(
      snap({ herRows: [herRow({ cells: { 2: "OUT" }, cellSources: {} })], entries: [entry()] }),
    );
    expect(r.preamble).toContain("Her sheet decides who is out");
    expect(r.preamble).toContain("never a correction to make here");
    expect(renderReport(r)[1]).toBe(r.preamble);
  });

  it("carries no preamble when only a mail line is standing", () => {
    const r = reportSheetWatch(snap({ herMail: null }));
    expect(r.preamble).toBeUndefined();
  });
});

describe("sheet-watch: a quiet run", () => {
  it("is NO ACTION when her newest sheet is loaded and carries all of ours with team names", () => {
    const r = reportSheetWatch(
      snap({
        herMail: [loadedMail()],
        herRows: [herRow({ rowNo: 972, cells: { 1: "Seattle" } }), herRow({ rowNo: 973, cells: { 1: "Dallas" } })],
        entries: [entry({ id: "e1", lynneNumber: 972 }), entry({ id: "e2", lynneNumber: 973 })],
      }),
    );
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });
});
