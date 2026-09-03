import Link from "next/link";
import { getData } from "@/lib/data";
import { formatCents } from "@/lib/pool";
import { formatDeadline } from "@/lib/format";
import {
  currentPlayWeek,
  LOCK_KIND_LABEL,
  nextLockBoundary,
  pickDistribution,
  recentActivity,
  standingsBreakdown,
  survivalCurve,
} from "@/lib/dashboard";
import { NFL_TEAMS, RESULT_LABEL, SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { eliminationWeekOf } from "@/lib/alive";
import { TEAM_PALETTE } from "@/lib/team-colors";
import { lynneBucket } from "@/lib/lynne/names";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PickDistributionLazy,
  SurvivalCurveLazy,
  SurvivalSparklineLazy,
} from "@/components/dashboard/charts-lazy";
import { Countdown } from "@/components/dashboard/countdown";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { LockClosedIcon } from "@/components/dashboard/lock-icon";

export const dynamic = "force-dynamic";

const RESULT_TEXT: Record<string, string> = {
  win: "text-win",
  loss: "text-loss",
  tie_loss: "text-tie",
  bye: "text-muted-foreground",
  missed: "text-loss",
};

export default async function DashboardPage() {
  const data = getData();
  const [entries, weeks, cells, pot, games] = await Promise.all([
    data.getEntries(),
    data.getWeeks(),
    data.getGridCells(),
    data.getPot(),
    data.getSchedule(),
  ]);

  if (entries.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl">2026 NFL Survivor Pool</h1>
        <EmptyState
          title="Season not seeded yet"
          detail="The roster, payments, and weekly picks will appear here once the pool data is loaded."
        />
      </div>
    );
  }

  const now = new Date();
  const breakdown = standingsBreakdown(entries);
  const alive = entries.length - breakdown.eliminated;
  const curve = survivalCurve(entries, cells);
  const dist = pickDistribution(weeks, cells, now);
  const playWeek = currentPlayWeek(weeks, now);
  const deadline = nextLockBoundary(weeks, games, now);
  const activity = recentActivity(entries, cells, 10);

  // Lynne's three buckets, her exact words (C2/F1).
  const buckets = { "No Losses": 0, "Loss/Bye": 0, Out: 0 };
  for (const e of entries) buckets[lynneBucket(e)] += 1;
  const segments = [
    { label: "No Losses", n: buckets["No Losses"], cls: "bg-win" },
    { label: "Loss/Bye", n: buckets["Loss/Bye"], cls: "bg-tie" },
    { label: "Out", n: buckets.Out, cls: "bg-loss" },
  ].filter((s) => s.n > 0);
  const lynneSentence = `No Losses=${buckets["No Losses"]}, 1 Loss/Bye used=${buckets["Loss/Bye"]} and Out=${buckets.Out}. We are down to ${alive} left in the pool.`;

  // F1 — carnage report: which teams have eliminated the most entries.
  const cellsByEntry = new Map<string, typeof cells>();
  for (const c of cells) {
    if (!cellsByEntry.has(c.entryId)) cellsByEntry.set(c.entryId, []);
    cellsByEntry.get(c.entryId)!.push(c);
  }
  const carnage = new Map<string, number>();
  for (const e of entries) {
    if (e.status !== "eliminated") continue;
    const ec = cellsByEntry.get(e.id) ?? [];
    const ew = eliminationWeekOf(ec);
    const kill = ec.find(
      (c) => c.week === ew && (c.result === "loss" || c.result === "tie_loss"),
    );
    if (kill) carnage.set(kill.team, (carnage.get(kill.team) ?? 0) + 1);
  }
  const carnageTop = [...carnage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // F1 — chalk vs contrarian: did the most-picked team win each week?
  const chalk: { week: number; team: string; count: number; result: string }[] =
    [];
  for (const w of weeks) {
    const weekCells = cells.filter(
      (c) =>
        c.week === w.week &&
        c.team !== SKIP_WEEK &&
        c.team !== "MISSED" &&
        c.team !== "LOCKED",
    );
    const scored = weekCells.filter((c) => c.result && c.result !== "pending");
    if (scored.length === 0) continue;
    const byTeam = new Map<string, { n: number; result: string }>();
    for (const c of weekCells) {
      const cur = byTeam.get(c.team) ?? { n: 0, result: c.result ?? "pending" };
      cur.n += 1;
      if (c.result && c.result !== "pending") cur.result = c.result;
      byTeam.set(c.team, cur);
    }
    const top = [...byTeam.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    if (top)
      chalk.push({
        week: w.week,
        team: top[0],
        count: top[1].n,
        result: top[1].result,
      });
  }

  // F1 — teams running out: how many ALIVE entries still hold each team.
  const aliveEntries = entries.filter((e) => e.status !== "eliminated");
  const scarcity = NFL_TEAMS.map((t) => ({
    team: t.abbr,
    left: aliveEntries.filter((e) => !e.teamsUsed.includes(t.abbr)).length,
  })).sort((a, b) => a.left - b.left);
  const scarce = scarcity
    .filter((s) => s.left < aliveEntries.length)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">2026 NFL Survivor Pool</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {entries.length} entries · live standings, picks, and pool health.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {/* The POOL-WIDE prize pot from Lynne's full pool — the number a
            player actually cares about. Stays honestly empty until she
            confirms the 2026 pool size. This group's collected/due figures
            are not public and are not computed here. */}
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pool pot
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pot.poolPotCents !== null ? (
              <>
                <div className="text-2xl tabular-nums">
                  {formatCents(pot.poolPotCents)}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {pot.poolEntryCount !== null
                    ? `across ${pot.poolEntryCount.toLocaleString()} pool entries`
                    : "across the full pool"}
                </p>
              </>
            ) : (
              <>
                <div className="text-2xl text-muted-foreground">Pending</div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Set once Lynne confirms the 2026 pool size
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Entries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl tabular-nums">{entries.length}</div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              in this group
            </p>
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Alive
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl tabular-nums">
              {alive}
              <span className="text-sm text-muted-foreground">
                {" "}
                of {entries.length}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              active + at-risk entries
            </p>
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl tabular-nums">
              {playWeek ? playWeek.week : "—"}
            </div>
            {deadline ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                W{deadline.week} {LOCK_KIND_LABEL[deadline.kind]} lock in{" "}
                <Countdown deadlineIso={deadline.deadlineAt} />
                <span className="mt-0.5 block" suppressHydrationWarning>
                  {formatDeadline(deadline.deadlineAt)}
                </span>
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">
                season complete
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Eliminated
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl tabular-nums text-loss">
              {breakdown.eliminated}
            </div>
            <SurvivalSparklineLazy data={curve} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Survival curve</CardTitle>
          </CardHeader>
          <CardContent>
            {curve.length > 1 ? (
              <SurvivalCurveLazy data={curve} total={entries.length} />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                The curve appears once Week 1 results are in.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">
              Week {dist?.week ?? "—"} pick distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dist?.revealed && dist.rows.length > 0 ? (
              <PickDistributionLazy rows={dist.rows} />
            ) : dist && !dist.revealed ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <LockClosedIcon className="size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Hidden until the Week {dist.week} deadline passes.
                </p>
                {deadline && deadline.week === dist.week ? (
                  <p
                    className="text-xs text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {formatDeadline(deadline.deadlineAt)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No picks recorded for this week yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">
            Standings — in Lynne&apos;s words
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
            {segments.map((s) => (
              <div
                key={s.label}
                className={cn("h-full", s.cls)}
                style={{ width: `${(s.n / entries.length) * 100}%` }}
                title={`${s.label}: ${s.n}`}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            {segments.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", s.cls)} />
                {s.label}
                <span className="tabular-nums text-foreground">{s.n}</span>
              </span>
            ))}
          </div>
          <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm">
            {lynneSentence}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Carnage report</CardTitle>
          </CardHeader>
          <CardContent>
            {carnageTop.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No eliminations yet — this fills in as teams start killing
                entries.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {carnageTop.map(([team, n]) => (
                  <li key={team} className="flex items-center gap-2">
                    <span
                      className="h-4 w-1 rounded-full"
                      style={{ background: TEAM_PALETTE[team]?.display }}
                    />
                    <span
                      className="font-medium"
                      style={{ color: TEAM_PALETTE[team]?.display }}
                    >
                      {team}
                    </span>
                    <span className="ml-auto tabular-nums text-loss">
                      {n} {n === 1 ? "entry" : "entries"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Chalk vs contrarian</CardTitle>
          </CardHeader>
          <CardContent>
            {chalk.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Once weeks are scored: the most-picked team each week, and
                whether the crowd was right.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {chalk.map((c) => (
                  <li key={c.week} className="flex items-center gap-2">
                    <span className="w-9 tabular-nums text-muted-foreground">
                      W{c.week}
                    </span>
                    <span
                      className="font-medium"
                      style={{ color: TEAM_PALETTE[c.team]?.display }}
                    >
                      {c.team}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ×{c.count}
                    </span>
                    <span
                      className={cn(
                        "ml-auto text-xs font-semibold",
                        c.result === "win"
                          ? "text-win"
                          : c.result === "pending"
                            ? "text-muted-foreground"
                            : "text-loss",
                      )}
                    >
                      {c.result === "win"
                        ? "chalk held"
                        : c.result === "pending"
                          ? "pending"
                          : "CHALK FELL"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Teams running out</CardTitle>
          </CardHeader>
          <CardContent>
            {scarce.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Every alive entry still holds all 32 teams. Scarcity shows up as
                picks burn teams.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {scarce.map((sc) => (
                  <li key={sc.team} className="flex items-center gap-2">
                    <span
                      className="font-medium"
                      style={{ color: TEAM_PALETTE[sc.team]?.display }}
                    >
                      {sc.team}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-tie"
                        style={{
                          width: `${(sc.left / Math.max(1, aliveEntries.length)) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="tabular-nums text-muted-foreground">
                      {sc.left}/{aliveEntries.length}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Results appear here as weeks are scored.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {activity.map((a, i) => (
                <li key={i} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">
                    W{a.week}
                  </span>
                  <Link
                    href={`/entry/${a.entryId}`}
                    className="min-w-0 flex-1 truncate font-medium hover:text-primary"
                  >
                    {a.entryName}
                  </Link>
                  <span className="text-muted-foreground">
                    {a.team === SKIP_WEEK
                      ? "Bye"
                      : (TEAM_NAME[a.team] ?? a.team)}
                  </span>
                  <span
                    className={cn(
                      "w-16 shrink-0 text-right text-xs font-medium",
                      RESULT_TEXT[a.result],
                    )}
                  >
                    {RESULT_LABEL[a.result]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
