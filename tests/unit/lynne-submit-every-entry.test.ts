// What goes to Lynne every week.
//
// Set by Anthony: /admin/lynne-submit emits EVERY live entry, NO PICK where
// there is none, OUT and BYE where they apply, and the row count equals the
// live entry count.
//
// It did not. buildSubmitRows dropped any entry without a current pick, so a
// week with one missed pick sent her a SHORTER list than the roster and
// nothing said which rows had gone. Week 1 hid it - all 121 had picks - and
// from Week 2, with eliminations, it would not have.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NO_PICK,
  OUT_OF_POOL,
  buildSubmissionBlock,
  buildSubmissionCsv,
  buildSubmitRows,
  cellText,
} from "@/lib/lynne/submit";
import { SKIP_WEEK } from "@/lib/standing";
import type { EntryStatus } from "@/lib/data/types";

const entry = (id: string, name: string, status: EntryStatus = "active") => ({
  id,
  entryName: name,
  status,
});

// One of each shape the week can produce.
const LIVE = [
  entry("a", "Picked"),
  entry("b", "Missed"),
  entry("c", "OnBye"),
  entry("d", "Dead", "eliminated"),
  entry("e", "AtRisk", "at_risk"),
];
const PICKS = new Map([
  ["a", "KC"],
  ["b", "MISSED"],
  ["c", SKIP_WEEK],
  // "Dead" has NO pick this week, which is what a dead entry looks like:
  // nobody chases one for a pick.
  ["e", "DET"],
]);
const NUMBERS = new Map<string, number | null>([
  ["a", 972],
  ["b", 973],
  ["c", 974],
  ["d", 975],
  ["e", 976],
]);

describe("every live entry gets a row", () => {
  const res = buildSubmitRows(LIVE, PICKS, NUMBERS);

  it("ROW COUNT EQUALS LIVE ENTRY COUNT", () => {
    expect(res.ready).toHaveLength(LIVE.length);
    expect(res.ready.map((r) => r.lynneNumber)).toEqual([972, 973, 974, 975, 976]);
  });

  it("says what is true in each cell", () => {
    const by = new Map(res.ready.map((r) => [r.lynneNumber, r.team]));
    expect(by.get(972), "a pick is the team").toBe("KC");
    expect(by.get(973), "a missed week is NO PICK").toBe(NO_PICK);
    expect(by.get(974), "a bye is the bye sentinel").toBe(SKIP_WEEK);
    expect(by.get(975), "eliminated and no pick this week is OUT").toBe(OUT_OF_POOL);
    expect(by.get(976), "at_risk is still alive and still picks").toBe("DET");
  });

  it("does NOT rewrite a week the entry really did pick", () => {
    // THE HISTORY RULE. `status` is the standing TODAY, and this function
    // serves an explicitly chosen week. An entry eliminated in Week 2 still
    // picked in Week 1, so re-running Week 1 must show that team - letting
    // the status win outright replaced it with OUT (Copilot on #91).
    const withPick = buildSubmitRows(
      [entry("d", "Dead", "eliminated")],
      new Map([["d", "SF"]]),
      new Map<string, number | null>([["d", 975]]),
    );
    expect(withPick.ready[0].team, "the week's real pick, not OUT").toBe("SF");
  });

  it("still reports a missing pick, as a gap to chase", () => {
    expect(res.missingPick).toEqual(["Missed"]);
    // An eliminated entry is not a gap - nobody is chasing it for a pick.
    expect(res.missingPick).not.toContain("Dead");
  });

  it("counts the ALIVE ones for the screen, which is a different number", () => {
    expect(res.aliveCount).toBe(4);
  });
});

describe("only a missing Lynne number can keep an entry off the list", () => {
  it("drops it and names it, because there is no number to file it under", () => {
    const res = buildSubmitRows(
      [entry("a", "Numbered"), entry("z", "Unnumbered")],
      new Map([["a", "KC"]]),
      new Map<string, number | null>([["a", 972], ["z", null]]),
    );
    expect(res.ready).toHaveLength(1);
    expect(res.missingNumber).toEqual(["Unnumbered"]);
  });
});

describe("the cell TEXT, written once", () => {
  it("renders every sentinel as a word and never raw", () => {
    expect(cellText(SKIP_WEEK)).toBe("BYE");
    expect(cellText(NO_PICK)).toBe("NO PICK");
    expect(cellText(OUT_OF_POOL)).toBe("OUT");
    expect(cellText("KC")).toBe("Kansas City");
  });

  it("keeps the CSV and the copy block saying the SAME thing", () => {
    // They had a teamText each; only one would have learned a new case, which
    // is the shape that put SKIP_WEEK on a screen once already.
    const rows = buildSubmitRows(LIVE, PICKS, NUMBERS).ready;
    const csv = buildSubmissionCsv(2, rows);
    const block = buildSubmissionBlock(2, rows);
    for (const word of ["BYE", "NO PICK", "OUT", "Kansas City"]) {
      expect(csv, `csv says ${word}`).toContain(word);
      expect(block, `block says ${word}`).toContain(word);
    }
    // And no sentinel leaks in either direction.
    for (const raw of [SKIP_WEEK, NO_PICK, OUT_OF_POOL]) {
      expect(csv).not.toContain(raw);
      expect(block).not.toContain(raw);
    }
  });

  it("emits one CSV line per entry plus the header", () => {
    const rows = buildSubmitRows(LIVE, PICKS, NUMBERS).ready;
    const lines = buildSubmissionCsv(2, rows).trimEnd().split("\n");
    expect(lines).toHaveLength(LIVE.length + 1);
    expect(lines[0]).toBe("NO.,NAMES,Week 2");
  });
});

describe("both screens pass EVERY live entry, not just the alive ones", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("lynne-submit and the week cockpit both hand over `entries`", () => {
    for (const f of [
      "src/app/admin/(protected)/lynne-submit/page.tsx",
      "src/app/admin/(protected)/week/[n]/page.tsx",
    ]) {
      const src = read(f);
      expect(src, `${f} passes entries`).toMatch(/buildSubmitRows\(\s*\n?\s*(\/\/[^\n]*\n\s*)*entries,/);
    }
  });
});
