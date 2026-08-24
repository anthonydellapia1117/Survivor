import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getData } from "@/lib/data";
import { getAdminData } from "@/lib/data/admin";
import { isAliveStatus } from "@/lib/alive";
import { LynneCsvButton } from "@/components/admin/lynne-csv-button";
import { buildSubmitRows } from "@/lib/lynne/submit";
import { formatDeadline } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Week cockpit" };

// C4: one screen per game week mirroring Lynne's rhythm — who has
// submitted, who has not, what locks when, what went to her, what came back.
export default async function WeekCockpitPage(props: {
  params: Promise<{ n: string }>;
}) {
  const { n } = await props.params;
  const week = Number(n);
  if (!Number.isInteger(week) || week < 1 || week > 18) notFound();

  const pub = getData();
  const [entries, cells, weeks, games, imports, adminEntries] =
    await Promise.all([
      getAdminData().listEntrySummaries(),
      getAdminData().listGridCells(),
      pub.getWeeks(),
      pub.getSchedule(),
      pub.getLynneImports(),
      getAdminData().listEntries(),
    ]);

  const w = weeks.find((x) => x.week === week);
  if (!w) notFound();

  const now = Date.now();
  const alive = entries.filter((e) => isAliveStatus(e.status));
  const weekCells = cells.filter((c) => c.week === week);
  const pickByEntry = new Map(weekCells.map((c) => [c.entryId, c]));
  const submitted = alive.filter((e) => pickByEntry.has(e.id));
  const missing = alive
    .filter((e) => !pickByEntry.has(e.id))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));

  const numberById = new Map(adminEntries.map((e) => [e.id, e.lynneNumber]));
  const missingNumbers = submitted.filter((e) => numberById.get(e.id) == null);
  const submitRows = buildSubmitRows(
    alive,
    new Map(weekCells.map((c) => [c.entryId, c.team])),
    numberById,
  );

  const weekGames = games.filter((g) => g.week === week);
  const earlyGames = weekGames.filter((g) =>
    ["Wednesday", "Thursday", "Friday"].includes(g.dayOfWeek),
  );
  const weekImports = imports.filter((i) => i.week === week);
  const scored = weekCells.filter(
    (c) => c.result && c.result !== "pending",
  ).length;

  const phase = (label: string, at: string) => ({
    label,
    at,
    passed: new Date(at).getTime() <= now,
  });
  const phases = [
    phase(
      week === 1
        ? "All picks lock (Tuesday rule)"
        : `Wed/Thu/Fri-game picks lock (${earlyGames.length} ${earlyGames.length === 1 ? "game" : "games"})`,
      w.earlyDeadlineAt,
    ),
    ...(w.earlyDeadlineAt !== w.lateDeadlineAt
      ? [phase("Sat–Mon picks lock — week fully locked", w.lateDeadlineAt)]
      : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl">Week {week} cockpit</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {weekGames.length} games · picks, deadlines, Lynne, results — one
            screen.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {week > 1 ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/admin/week/${week - 1}`}>← W{week - 1}</Link>
            </Button>
          ) : null}
          {week < 18 ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/admin/week/${week + 1}`}>W{week + 1} →</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {phases.map((p) => (
          <div
            key={p.label}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-sm",
              p.passed
                ? "border-border bg-surface-2 text-muted-foreground"
                : "border-primary/40 bg-primary/5",
            )}
          >
            <span className="font-medium">{p.label}</span>
            <span className="mt-0.5 block text-xs" suppressHydrationWarning>
              {formatDeadline(p.at)} {p.passed ? "— locked" : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">
              Picks in: {submitted.length} of {alive.length} alive
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {missing.length > 0 ? (
              <div className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2 text-sm text-tie">
                <p className="font-semibold">
                  Missing ({missing.length}):
                </p>
                <p className="mt-1 text-xs">
                  {missing.map((e) => e.entryName).join(" · ")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-win">
                Every alive entry has a week-{week} pick.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/admin/picks">Enter picks</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/deadline">Missed-pick sweep</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Lynne</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {missingNumbers.length > 0 ? (
              <p className="rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-xs text-loss">
                {missingNumbers.length} submitted{" "}
                {missingNumbers.length === 1 ? "entry has" : "entries have"} no
                Lynne number — the submission block will refuse them.
              </p>
            ) : null}
            <p className="text-muted-foreground">
              Wed/Thu she takes Thursday-game picks; Fri/Sat the full week;
              Mon/Tue her final sheet arrives and gets imported here.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/admin/lynne-submit?week=${week}`}>
                  Submission block
                </Link>
              </Button>
              <LynneCsvButton
                week={week}
                ready={submitRows.ready}
                missingNumberCount={submitRows.missingNumber.length}
              />
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/import">Import her sheet</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/admin/recap?week=${week}`}>Recap email</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {weekImports.length === 0
                ? `No week-${week} file imported yet.`
                : `${weekImports.length} import${weekImports.length === 1 ? "" : "s"} for this week — latest ${weekImports[0]?.filename ?? ""}.`}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">
            Results: {scored} of {weekCells.length} picks scored
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Scores drive every pick result downstream — enter them once the
            games go final.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`/admin/scores?week=${week}`}>Enter scores</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/schedule?week=${week}`}>Game board</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
