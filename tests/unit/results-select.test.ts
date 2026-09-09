import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MessageMeta } from "../../scripts/lib/gmail";
import { footballAttachment, isFootballXlsx, refuseUnverifiedLegacy, refuseWeekMismatch, selectFootballMessage } from "../../scripts/results/lib/select";

function msg(id: string, internalMs: number, files: string[]): MessageMeta {
  return {
    id,
    threadId: "t1",
    from: "Lynne <lynnepiazza10@gmail.com>",
    fromAddress: "lynnepiazza10@gmail.com",
    subject: `sheet ${id}`,
    date: "",
    internalMs,
    attachments: files.map((filename, i) => ({
      filename,
      mimeType: "application/octet-stream",
      attachmentId: `${id}-att-${i}`,
      size: 10,
    })),
  };
}

describe("isFootballXlsx", () => {
  it("takes Football and .xlsx in any case", () => {
    expect(isFootballXlsx("Football_2026-3.xlsx")).toBe(true);
    expect(isFootballXlsx("FOOTBALL week 3.XLSX")).toBe(true);
    expect(isFootballXlsx("2026 football pool.xlsx")).toBe(true);
  });

  it("refuses a .csv, an .xls, a wrapped name and a non-Football xlsx", () => {
    expect(isFootballXlsx("Football_2026-3.csv")).toBe(false);
    expect(isFootballXlsx("Football_2026-3.xls")).toBe(false);
    expect(isFootballXlsx("Football_2026-3.xlsx.pdf")).toBe(false);
    expect(isFootballXlsx("Standings.xlsx")).toBe(false);
  });
});

describe("footballAttachment", () => {
  it("finds the Football xlsx among other attachments on one message", () => {
    const m = msg("a", 1, ["image001.png", "Football_2026-3.xlsx", "notes.pdf"]);
    expect(footballAttachment(m)?.filename).toBe("Football_2026-3.xlsx");
    expect(footballAttachment(m)?.attachmentId).toBe("a-att-1");
  });

  it("is null when the message has no Football xlsx", () => {
    expect(footballAttachment(msg("a", 1, ["image001.png", "Football.csv"]))).toBeNull();
    expect(footballAttachment(msg("b", 1, []))).toBeNull();
  });
});

describe("selectFootballMessage", () => {
  it("picks the newest by internalMs, whatever order the search returned", () => {
    const sel = selectFootballMessage([
      msg("old", 1000, ["Football_2026-1.xlsx"]),
      msg("newest", 3000, ["Football_2026-3.xlsx"]),
      msg("middle", 2000, ["Football_2026-2.xlsx"]),
    ]);
    expect(sel?.message.id).toBe("newest");
    expect(sel?.attachment.filename).toBe("Football_2026-3.xlsx");
  });

  it("ignores a newer xlsx that is not a Football file", () => {
    const sel = selectFootballMessage([
      msg("football", 1000, ["Football_2026-2.xlsx"]),
      msg("standings", 5000, ["Standings.xlsx"]),
    ]);
    expect(sel?.message.id).toBe("football");
  });

  it("ignores a newer .csv even when it is named Football", () => {
    const sel = selectFootballMessage([
      msg("xlsx", 1000, ["Football_2026-2.xlsx"]),
      msg("csv", 5000, ["Football_2026-3.csv"]),
    ]);
    expect(sel?.message.id).toBe("xlsx");
    expect(sel?.attachment.filename).toBe("Football_2026-2.xlsx");
  });

  it("returns null when no message carries a Football xlsx", () => {
    expect(selectFootballMessage([])).toBeNull();
    expect(
      selectFootballMessage([msg("a", 1, ["Standings.xlsx"]), msg("b", 2, ["Football.csv"]), msg("c", 3, [])]),
    ).toBeNull();
  });

  it("measures newest on internalMs, not on the Date header", () => {
    const a = { ...msg("a", 9000, ["Football_a.xlsx"]), date: "Mon, 1 Sep 2026 10:00:00 -0400" };
    const b = { ...msg("b", 1000, ["Football_b.xlsx"]), date: "Tue, 8 Sep 2026 10:00:00 -0400" };
    expect(selectFootballMessage([b, a])?.message.id).toBe("a");
  });
});

import { duplicateImport } from "../../scripts/results/lib/select";

describe("duplicateImport", () => {
  const prior = (week: number | null) => ({ id: "imp-1", week, imported_at: "2026-09-16T14:00:00Z" });

  it("is a no-op only when the prior import is this same week", () => {
    // She sends one file a week and the schedule looks twice, so the newest
    // attachment is usually the one already on file for the week being asked
    // for. Throwing counted a failure on every tick until she sent a new file.
    const d = duplicateImport(prior(2), 2);
    expect(d.kind).toBe("same_week");
    expect(d.kind === "same_week" && d.line).toBe(
      "Already imported 2026-09-16T14:00:00Z as import imp-1 (week 2): seen before, nothing to do.",
    );
    expect(duplicateImport(null, 2)).toEqual({ kind: "none" });
  });

  it("is NOT a no-op when the prior import was another week, or no week at all", () => {
    // The schedule runs with --week <latest locked>. If her sheet for that
    // week has not arrived, the newest attachment is the PREVIOUS week's,
    // already imported. Exiting 0 there would report the week as finished
    // with its standings stale and the tick saying ok - the silent failure
    // the rest of this change exists to remove.
    const d = duplicateImport(prior(1), 2);
    expect(d.kind).toBe("other_week");
    expect(d.kind === "other_week" && d.line).toContain("not week 2");
    expect(d.kind === "other_week" && d.line).toContain("has not arrived");
    // A prior import carrying no week confirms nothing; it is not this week's.
    expect(duplicateImport(prior(null), 2).kind).toBe("other_week");
    expect(duplicateImport(prior(3), 2).kind).toBe("other_week");
  });

  it("ends the run at exit 0 on the same week and throws on another, so a stale week is never reported ok", () => {
    const cli = readFileSync("scripts/results/cli.ts", "utf8");
    expect(cli).toMatch(/const duplicate = duplicateImport\(await importExists\(client, sha256\), week\);/);
    expect(cli).toMatch(/if \(duplicate\.kind === "same_week"\) \{[\s\S]{0,400}?\n    return;\n  \}/);
    expect(cli).toMatch(/if \(duplicate\.kind === "other_week"\) throw new Error\(duplicate\.line\);/);
    // The same-week branch must not throw, and the cross-week one must not return.
    expect(/if \(duplicate\.kind === "same_week"\) \{[\s\S]{0,400}?\n  \}/.exec(cli)?.[0]).not.toMatch(/throw/);
  });
});

describe("refuseWeekMismatch", () => {
  it("accepts the sheet whose latest filled week is the week being imported, or one with no filled week", () => {
    expect(refuseWeekMismatch(2, 2, "Football 2026-3.xlsx")).toBeNull();
    expect(refuseWeekMismatch(null, 2, "Football 2026-3.xlsx")).toBeNull();
  });
  it("refuses an older sheet", () => {
    expect(refuseWeekMismatch(1, 2, "Football 2026-2.xlsx")).toMatch(/latest filled week is 1, not 2: Football 2026-2.xlsx predates Week 2/);
  });
  it("refuses a newer sheet, which is the next week's file and must keep its sha256 for that import", () => {
    expect(refuseWeekMismatch(3, 2, "Football 2026-4.xlsx")).toMatch(/latest filled week is 3, not 2: Football 2026-4.xlsx is a later sheet/);
  });
});

describe("refuseUnverifiedLegacy", () => {
  it("never takes a legacy per-week file by date; it needs --message-id", () => {
    expect(refuseUnverifiedLegacy("legacy", false, 2, "Week2.xlsx")).toMatch(/Week2.xlsx is a per-week file that carries no week of its own.*--message-id.*Week 2/);
    expect(refuseUnverifiedLegacy("legacy", true, 2, "Week2.xlsx")).toBeNull();
  });
  it("leaves the grid to the filled-week check", () => {
    expect(refuseUnverifiedLegacy("grid", false, 2, "Football 2026-3.xlsx")).toBeNull();
  });
});
