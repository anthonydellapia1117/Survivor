// Lynne submission package (spec 6.2): exactly the columns her sheet
// expects — entry label, team — for one week's current picks.

import { getData } from "@/lib/data";
import { getAdminData } from "@/lib/data/admin";

function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ week: string }> },
) {
  const { week: weekParam } = await ctx.params;
  const week = Number(weekParam.replace(/\.csv$/, ""));
  if (!Number.isInteger(week) || week < 1 || week > 18) {
    return new Response("bad week", { status: 400 });
  }

  const [cells, entries] = await Promise.all([
    getData().getGridCells(),
    getAdminData().listEntries(),
  ]);
  const labelByEntry = new Map(
    entries
      .filter((e) => !e.voidedAt)
      .map((e) => [e.id, e.lynneLabel ?? e.entryName]),
  );

  const lines = ["Entry,Team"];
  const weekCells = cells
    .filter((c) => c.week === week && labelByEntry.has(c.entryId))
    .sort((a, b) =>
      labelByEntry.get(a.entryId)!.localeCompare(labelByEntry.get(b.entryId)!),
    );
  for (const c of weekCells) {
    const team = c.team === "SKIP_WEEK" ? "BYE" : c.team;
    lines.push(`${csvField(labelByEntry.get(c.entryId)!)},${csvField(team)}`);
  }

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lynne-week-${week}.csv"`,
    },
  });
}
