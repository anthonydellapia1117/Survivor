import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { fromLynneTeamName } from "@/lib/lynne/names";
import { TEAM_PALETTE } from "@/lib/team-colors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "2025 archive" };
export const dynamic = "force-dynamic";

// Part G: Lynne's final 2025 sheet, read-only. Honest about its shape:
// she deletes eliminated entries as the season goes, so this is the
// season's ENDING, not its roster.
export default async function Archive2025Page() {
  const { entries, weekly } = await getData().getArchive2025();
  const winners = entries.filter((e) => e.outcome === "winner");
  const outs = entries.filter((e) => e.outcome === "out");
  const mine = entries.filter((e) => [980, 1006, 1037].includes(e.lynneNumber));
  const maxPool = 1245;

  const pickCell = (v: string | null, i: number) => {
    if (v === null) return <td key={i} className="border-b border-border/40 bg-black/30" />;
    const upper = v.toUpperCase();
    if (upper === "OUT")
      return (
        <td key={i} className="border-b border-border/40 bg-loss/25 text-center text-[10px] font-bold text-loss">
          OUT
        </td>
      );
    if (upper === "BYE")
      return (
        <td key={i} className="border-b border-border/40 bg-bye/25 text-center text-[10px] font-semibold text-foreground/70">
          BYE
        </td>
      );
    const abbr = fromLynneTeamName(v);
    return (
      <td
        key={i}
        title={v}
        className="whitespace-nowrap border-b border-border/40 px-1 text-center text-[10px]"
        style={abbr ? { color: TEAM_PALETTE[abbr]?.display } : undefined}
      >
        {abbr ?? v}
      </td>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">2025 season archive</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Lynne&apos;s final sheet, imported read-only.{" "}
          <span className="font-medium text-foreground">
            This is a partial final sheet, not a full season history:
          </span>{" "}
          she removes eliminated entries as the season goes, so only the last
          56 of roughly 1,245 entries remain — and only 3 of my 66 entries
          survived long enough to still be listed. Her weekly bucket counts
          below are the complete attrition record she kept herself.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Pool size", value: "1,245", sub: "+38 free entries" },
          { label: "Winners", value: "27", sub: "$1,008.60 each" },
          { label: "My entries", value: "66 paid + 6 free", sub: "$1,650 remitted" },
          { label: "In final sheet", value: String(entries.length), sub: `${winners.length} winners · ${outs.length} out` },
        ].map((c) => (
          <Card key={c.label} className="bg-surface">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl tabular-nums">{c.value}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">
            The season, week by week — her own running counts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="px-2 py-1 text-left font-medium">Week</th>
                  {weekly.map((w) => (
                    <th key={w.week} className="min-w-10 px-1 py-1 text-center font-medium tabular-nums">
                      {w.week}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["No Losses", (w: (typeof weekly)[number]) => w.noLosses, "text-win"],
                    ["Loss/Bye", (w: (typeof weekly)[number]) => w.lossBye, "text-tie"],
                    ["Out", (w: (typeof weekly)[number]) => w.out, "text-loss"],
                  ] as const
                ).map(([label, get, cls]) => (
                  <tr key={label}>
                    <td className={cn("whitespace-nowrap px-2 py-1 font-semibold", cls)}>{label}</td>
                    {weekly.map((w) => (
                      <td
                        key={w.week}
                        className="px-1 py-1 text-center tabular-nums"
                        title={
                          get(w) === null
                            ? "Blank in her sheet — week 18's survivors are the 27 winners in Loss/Bye"
                            : undefined
                        }
                      >
                        {get(w) ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td className="px-2 py-1 text-muted-foreground">alive</td>
                  {weekly.map((w) => {
                    const alive = (w.noLosses ?? 0) + (w.lossBye ?? 0);
                    return (
                      <td key={w.week} className="px-1 py-1 text-center">
                        <div
                          className="mx-auto w-2 rounded-sm bg-primary/70"
                          style={{ height: `${Math.max(2, (alive / maxPool) * 40)}px` }}
                          title={`${alive} alive`}
                        />
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            1,206 clean after week 1 → 27 winners after week 18. The week-8
            single-elimination switch (726 out) was the season&apos;s cliff.
            The week-18 Out cell is blank in her sheet (shown as —): the 27
            still standing in Loss/Bye are the winners.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">My 2025 entries still on the sheet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {mine.map((e) => {
            const lastWeek =
              e.picks.filter((p) => p !== null && p.toUpperCase() !== "OUT").length;
            return (
              <p key={e.lynneNumber}>
                <span className="font-medium">#{e.lynneNumber} {e.entryName}</span>{" "}
                <span className="text-loss">OUT</span>
                <span className="text-muted-foreground"> — survived {lastWeek} weeks</span>
              </p>
            );
          })}
          <p className="text-xs text-muted-foreground">
            My other 63 entries were eliminated earlier and had already been
            removed from her sheet — that is how she works it, not missing
            data.
          </p>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg">The final sheet — all {entries.length} remaining entries</h2>
        <div className="max-h-[70dvh] overflow-auto rounded-lg border border-border">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 border-b border-r border-border bg-surface-2 px-2 py-1.5 text-left font-medium text-muted-foreground">
                  NO. / NAMES
                </th>
                {Array.from({ length: 18 }, (_, i) => (
                  <th key={i} className="sticky top-0 z-20 min-w-9 border-b border-border bg-surface-2 px-1 py-1.5 text-center font-medium text-muted-foreground">
                    {i + 1}
                  </th>
                ))}
                <th className="sticky top-0 z-20 border-b border-border bg-surface-2 px-2 py-1.5 text-left font-medium text-muted-foreground">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.lynneNumber} className={e.outcome === "out" ? "opacity-55" : undefined}>
                  <td className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-border/60 bg-surface px-2 py-1">
                    <span className="tabular-nums text-muted-foreground">{e.lynneNumber}</span>{" "}
                    <span className="font-medium">{e.entryName}</span>
                  </td>
                  {e.picks.map((p, i) => pickCell(p, i))}
                  <td className="whitespace-nowrap border-b border-border/60 px-2 py-1">
                    {e.outcome === "winner" ? (
                      <span className="font-semibold text-tie">🏆 $1,008.60</span>
                    ) : (
                      <span className="font-semibold text-loss">OUT</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Values exactly as she typed them — statuses read from her cell
          colors (yellow = winner, red = out). Read-only; nothing here can
          touch 2026 data.
        </p>
      </section>
    </div>
  );
}
