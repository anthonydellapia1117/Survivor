import { describe, expect, it } from "vitest";
import { buildSubmissionBlock } from "@/lib/lynne/submit";
import { fromLynneTeamName, LYNNE_TEAM_NAME, lynneBucket } from "@/lib/lynne/names";
import { duplicateTeamRisks } from "@/lib/alive";
import { lynneRemittanceCents } from "@/lib/pool";
import { contrastRatio, DARK_SURFACE, TEAM_PALETTE } from "@/lib/team-colors";
import type { GridCell } from "@/lib/data/types";

describe("Lynne submission block", () => {
  it("renders her exact three-column format, sorted by number", () => {
    const block = buildSubmissionBlock(13, [
      { lynneNumber: 984, entryName: "Cheeky 2k", team: "LAR" },
      { lynneNumber: 977, entryName: "Anthony DellaPia 2", team: "SF" },
      { lynneNumber: 1037, entryName: "Nolan Lawrence 1", team: "JAX" },
    ]);
    const lines = block.split("\n");
    expect(lines[0]).toBe("NO.     NAMES                 Week 13");
    expect(lines[1]).toBe("977     Anthony DellaPia 2    San Francisco");
    expect(lines[2]).toBe("984     Cheeky 2k             LA Rams");
    expect(lines[3]).toBe("1037    Nolan Lawrence 1      Jacksonville");
  });

  it("keeps apostrophes verbatim and renders byes as BYE", () => {
    const block = buildSubmissionBlock(2, [
      { lynneNumber: 12, entryName: "thedrick's picks", team: "SKIP_WEEK" },
    ]);
    expect(block).toContain("thedrick's picks");
    expect(block.split("\n")[1]).toMatch(/BYE$/);
  });

  it("uses her team vocabulary for every abbreviation", () => {
    expect(LYNNE_TEAM_NAME.SF).toBe("San Francisco");
    expect(LYNNE_TEAM_NAME.LAC).toBe("LA Chargers");
    expect(LYNNE_TEAM_NAME.LV).toBe("LV Raiders");
    expect(Object.keys(LYNNE_TEAM_NAME)).toHaveLength(32);
    expect(fromLynneTeamName("la rams")).toBe("LAR");
    expect(fromLynneTeamName("Kansas City")).toBe("KC");
    expect(fromLynneTeamName("nowhere")).toBeNull();
  });
});

describe("Lynne buckets — her words", () => {
  it("maps statuses to No Losses / Loss/Bye / Out", () => {
    expect(lynneBucket({ status: "active", losses: 0, byeUsed: false })).toBe("No Losses");
    expect(lynneBucket({ status: "bye_eligible", losses: 0, byeUsed: false })).toBe("No Losses");
    expect(lynneBucket({ status: "at_risk", losses: 1, byeUsed: false })).toBe("Loss/Bye");
    expect(lynneBucket({ status: "active", losses: 0, byeUsed: true })).toBe("Loss/Bye");
    expect(lynneBucket({ status: "eliminated", losses: 2, byeUsed: false })).toBe("Out");
  });
});

describe("duplicate team detection", () => {
  const cell = (entryId: string, week: number, team: string): GridCell => ({
    entryId, week, team, result: null, late: false,
    submittedAt: "2026-09-01T00:00:00Z", source: "admin", resultSource: null,
  });

  it("catches a repeat across non-adjacent weeks", () => {
    const risks = duplicateTeamRisks([
      cell("e1", 9, "LAC"),
      cell("e1", 11, "KC"),
      cell("e1", 13, "LAC"),
    ]);
    expect(risks).toEqual([{ entryId: "e1", team: "LAC", weeks: [9, 13] }]);
  });

  it("ignores byes, missed picks, and locked cells; distinct teams are clean", () => {
    expect(
      duplicateTeamRisks([
        cell("e1", 8, "SKIP_WEEK"),
        cell("e1", 9, "SKIP_WEEK"),
        cell("e1", 10, "MISSED"),
        cell("e1", 11, "MISSED"),
        cell("e1", 12, "KC"),
        cell("e1", 13, "LOCKED"),
        cell("e1", 14, "LOCKED"),
      ]),
    ).toEqual([]);
  });
});

describe("remittance excludes free entries", () => {
  it("her arithmetic: 66 paid at $25 = $1,650, the 6 free excluded", () => {
    // 72 total entries, 6 free -> remit on 66.
    expect(lynneRemittanceCents(66)).toBe(165000);
  });
});

describe("team palette", () => {
  it("all 32 display colors clear WCAG 4.5:1 on the dark surface", () => {
    const abbrs = Object.keys(TEAM_PALETTE);
    expect(abbrs).toHaveLength(32);
    for (const abbr of abbrs) {
      const ratio = contrastRatio(TEAM_PALETTE[abbr].display, DARK_SURFACE);
      expect(ratio, `${abbr} (${TEAM_PALETTE[abbr].display})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps primary and secondary brand hexes for every team", () => {
    for (const p of Object.values(TEAM_PALETTE)) {
      expect(p.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(p.secondary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("apostrophe round-trip through Excel", () => {
  it("thedrick's picks survives xlsx write + read", async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["NAMES"], ["thedrick's picks"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const back = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<string[]>(
      back.Sheets[back.SheetNames[0]],
      { header: 1 },
    );
    expect(rows[1][0]).toBe("thedrick's picks");
  });
});
