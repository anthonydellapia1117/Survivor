// Full picks matrix export (spec 6.2).
// Sheet 1: entries down, weeks across, conditional fill by result.
// Sheet 2: flat pick log. Sheet 3: standings.
// Sheet 4: financials — included ONLY for the authenticated admin.

import * as XLSX from "xlsx-js-style";
import { getData } from "@/lib/data";
import { getAdminData } from "@/lib/data/admin";
import { getAdminSession } from "@/lib/auth";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/standing";
import type { EntrySummary, GridCell } from "@/lib/data/types";

const FILLS: Record<string, string> = {
  win: "10B981",
  loss: "EF4444",
  tie_loss: "F59E0B",
  bye: "64748B",
  missed: "EF4444",
};

/* eslint-disable @typescript-eslint/no-explicit-any */

function cellFor(c: GridCell | undefined): any {
  if (!c) return { v: "", t: "s" };
  if (c.team === "LOCKED") {
    // Public download of a pick whose game hasn't kicked off.
    return {
      v: "🔒",
      t: "s",
      s: { font: { color: { rgb: "888888" } }, alignment: { horizontal: "center" } },
    };
  }
  const label = c.team === "SKIP_WEEK" ? "BYE" : c.team;
  const result = c.result ?? "pending";
  const fill = FILLS[result];
  return {
    v: label,
    t: "s",
    s: fill
      ? {
          fill: { fgColor: { rgb: fill } },
          font: { color: { rgb: "FFFFFF" }, bold: true },
          alignment: { horizontal: "center" },
        }
      : {
          font: { color: { rgb: "888888" } },
          alignment: { horizontal: "center" },
        },
  };
}

export async function GET() {
  const data = getData();
  const session = await getAdminSession();
  // Public download gets the public (locked-masked) payload; the admin's
  // download carries the real picks.
  const [entries, weeks, cells] = await Promise.all([
    session ? getAdminData().listEntrySummaries() : data.getEntries(),
    data.getWeeks(),
    session ? getAdminData().listGridCells() : data.getGridCells(),
  ]);

  const sorted = [...entries].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.ownerName.localeCompare(b.ownerName) ||
      a.entryName.localeCompare(b.entryName),
  );
  const cellMap = new Map(cells.map((c) => [`${c.entryId}:${c.week}`, c]));

  const wb = XLSX.utils.book_new();

  // Sheet 1: the matrix.
  const header = [
    { v: "Entry", t: "s", s: { font: { bold: true } } },
    { v: "Owner", t: "s", s: { font: { bold: true } } },
    ...weeks.map((w) => ({
      v: `W${w.week}`,
      t: "s",
      s: { font: { bold: true }, alignment: { horizontal: "center" } },
    })),
  ];
  const matrixRows = sorted.map((e: EntrySummary) => [
    { v: e.entryName, t: "s" },
    { v: e.ownerName, t: "s" },
    ...weeks.map((w) => cellFor(cellMap.get(`${e.id}:${w.week}`))),
  ]);
  const ws1 = XLSX.utils.aoa_to_sheet([header, ...matrixRows]);
  ws1["!cols"] = [
    { wch: 22 },
    { wch: 18 },
    ...weeks.map(() => ({ wch: 6 })),
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "Matrix");

  // Sheet 2: flat pick log.
  const names = new Map(entries.map((e) => [e.id, e]));
  const log = cells
    .filter((c) => names.has(c.entryId))
    .sort(
      (a, b) =>
        a.week - b.week ||
        names
          .get(a.entryId)!
          .entryName.localeCompare(names.get(b.entryId)!.entryName),
    )
    .map((c) => ({
      Week: c.week,
      Entry: names.get(c.entryId)!.entryName,
      Owner: names.get(c.entryId)!.ownerName,
      Team: c.team,
      Result: c.result ?? "pending",
      Submitted: c.submittedAt,
      Late: c.late ? "yes" : "",
      Source: c.source,
      "Result source": c.resultSource ?? "",
    }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(log), "Pick log");

  // Sheet 3: standings.
  const standings = sorted.map((e) => ({
    Entry: e.entryName,
    Owner: e.ownerName,
    Status: STATUS_LABEL[e.status],
    Lives: e.livesRemaining,
    Wins: e.wins,
    Losses: e.losses,
    "Bye used": e.byeUsed ? "yes" : "",
    "Teams used": e.teamsUsed.join(" "),
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(standings),
    "Standings",
  );

  // Sheet 4: financials — admin only.
  if (session) {
    const owners = await getAdminData().listOwners();
    const fin = owners.map((o) => ({
      Owner: `${o.firstName} ${o.lastName}`,
      Status: o.participationStatus,
      Entries: o.entryCount,
      "Paid entries": o.paidEntryCount,
      Due: o.dueCents / 100,
      Paid: o.paidCents / 100,
      Balance: (o.dueCents - o.paidCents) / 100,
    }));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(fin),
      "Financials",
    );
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="survivor-picks.xlsx"',
    },
  });
}
