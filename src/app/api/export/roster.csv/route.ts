// Roster CSV (spec 6.2): entry name, owner, status, current pick.

import { getData } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/standing";

function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function GET() {
  const data = getData();
  const [entries, weeks, cells] = await Promise.all([
    data.getEntries(),
    data.getWeeks(),
    data.getGridCells(),
  ]);

  const now = Date.now();
  const currentWeek =
    weeks.find((w) => new Date(w.deadlineAt).getTime() > now)?.week ??
    weeks.at(-1)?.week ??
    1;
  const current = new Map(
    cells.filter((c) => c.week === currentWeek).map((c) => [c.entryId, c.team]),
  );

  const lines = ["Entry,Owner,Status,Current pick"];
  for (const e of [...entries].sort((a, b) =>
    a.entryName.localeCompare(b.entryName),
  )) {
    lines.push(
      [
        csvField(e.entryName),
        csvField(e.ownerName),
        STATUS_LABEL[e.status],
        current.get(e.id) ?? "",
      ].join(","),
    );
  }

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="survivor-roster.csv"',
    },
  });
}
