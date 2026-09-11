import Link from "next/link";
import { getData } from "@/lib/data";
import { formatCents } from "@/lib/pool";
import { formatDeadline, formatEtDate } from "@/lib/format";
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
import {
  fullyRevealedWeeks,
  poolDistribution,
  poolStandings,
  poolStats,
  poolWeekFilled,
} from "@/lib/master-list";
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
  const [entries, weeks, cells, pot, games, master] = await Promise.all([
    data.getEntries(),
    data.getWeeks(),
    data.getGridCells(),
    data.getPot(),
    data.getSchedule(),
    data.getMasterList(),
  ]);

  // Her sheet and our roster are independent sources. The empty state is
  // for when NEITHER has anything; a loaded sheet with no roster yet still
  // opens on the master pool, as the Grid does.
  if (entries.length === 0 && master.rows.length === 0) {
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
  // The whole pool's picks for the week, from the published sheet, is the
  // default view; our group's own picks stand in until she publishes.
  const poolDist =
    playWeek && poolWeekFilled(master.rows, playWeek.week)
      ? poolDistribution(master.rows, playWeek.week)
      : null;
  // The public view serves her cells only as their games kick off, so until
  // every game of the week has, the chart is the revealed subset and the
  // caption says so rather than claiming the whole pool.
  const poolDistWhole = playWeek !== null && fullyRevealedWeeks(games, now).includes(playWeek.week);
  // Her four figures, from the same poolStats() the Master List reads, so
  // the two pages cannot drift apart.
  const herFigures = poolStats(pot);
  // The whole pool's health in her buckets, over every row of her sheet
  // rather than our 121. Ours is the second, independent calculation
  // (CLAUDE.md): a row she has struck OUT is Out whatever our scores say.
  const poolStand = poolStandings(master, games);
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

  // F1 - carnage report: which teams have eliminated the most entries.
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

  // F1 - chalk vs contrarian: did the most-picked team win each week?
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

  // F1 - teams running out: how many ALIVE entries still hold each team.
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
      {/* The subtitle came off on 2026-09-11. It read "121 entries · live
          standings, picks, and pool health" - an OUR-GROUP count a viewer did
          not come for, followed by a list of what the page visibly already
          is. Same reasoning that took Entries and Alive off the cards below
          and the alive figure off the share card. */}
      <h1 className="text-2xl">2026 NFL Survivor Pool</h1>

      {/* Row 1 - the master pool's own four figures, exactly as she
          publishes them, read through the same poolStats() the Master List
          uses so the two pages cannot drift. Her per-entry rate is never
          printed on a public route. */}
      {herFigures.length > 0 ? (
        <div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {herFigures.map((s) => (
              <Card key={s.label} className="bg-surface">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl tabular-nums">{s.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The master pool&apos;s own figures, as published.
            {master.loadedAt ? (
              <span suppressHydrationWarning>
                {" "}
                Sheet as of {formatEtDate(master.loadedAt)}.
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      {/* Row 2 - the whole pool's health, in her buckets. Her middle bucket
          is "1 LOSS/BYE" on the sheet, not "1 loss": a burned bye lands here
          without a loss, so the label follows her wording. */}
      {master.rows.length > 0 ? (
        <div>
          {/* One column on a phone: at 380px three of these left 76px of
          content for a four-digit number and a two-line label. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="bg-surface">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  No Losses
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl tabular-nums text-win">
                  {poolStand.noLosses.toLocaleString()}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  in the master pool
                </p>
              </CardContent>
            </Card>
            <Card className="bg-surface">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  1 Loss/Bye
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl tabular-nums text-tie">
                  {poolStand.lossBye.toLocaleString()}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  a loss or a bye burned
                </p>
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
                  {poolStand.out.toLocaleString()}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {/* Not "struck out": most of these are our own calculation -
                      two losses, a late loss, a repeated team. Her explicit
                      OUT is authoritative and included, but it is not the
                      whole number. */}
                  out on this sheet
                </p>
              </CardContent>
            </Card>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Across all {poolStand.total.toLocaleString()} rows of her sheet
            {poolStand.scoredThrough !== null
              ? `, scored through Week ${poolStand.scoredThrough}`
              : poolStand.inProgressWeek !== null
                ? ", no week fully scored yet"
                : ", before any week has been scored"}
            {poolStand.inProgressWeek !== null ? `, Week ${poolStand.inProgressWeek} in progress` : ""}
            . Our own count from her published picks; a row her sheet writes
            OUT on is out whatever we compute. She removes eliminated entries
            as the season goes, so these describe the rows on her newest sheet
            rather than a running total for the season.
          </p>
        </div>
      ) : null}

      {/* Entries and Alive came off on 2026-09-11: "121" and "121 of 121" are
          what Anthony manages, not what a viewer came to see, and they read
          the same every week until somebody dies. What is left gets MORE
          useful as the season runs - the countdown, this week's damage, and
          the pool-wide rolling counts above. */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl tabular-nums">
              {playWeek ? playWeek.week : "-"}
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
              Week {dist?.week ?? "-"} pick distribution
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {poolDist ? "Everyone" : "our group"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {poolDist && poolDist.rows.length > 0 ? (
              <>
                <PickDistributionLazy rows={poolDist.rows} />
                <p className="mt-2 text-xs text-muted-foreground">
                  {poolDistWhole
                    ? "Every entry in the master pool, from the published sheet"
                    : `Revealed picks so far in the master pool, ${poolDist.revealed.toLocaleString("en-US")} of ${master.rows.length.toLocaleString("en-US")} rows on the published sheet; the rest appear as their games kick off`}
                  {poolDist.other > 0
                    ? `; ${poolDist.other} cells are not a team (OUT or a note)`
                    : ""}
                  .{" "}
                  <Link href="/grid" className="text-primary underline-offset-2 hover:underline">
                    The Grid
                  </Link>
                </p>
              </>
            ) : dist?.revealed && dist.rows.length > 0 ? (
              <>
                <PickDistributionLazy rows={dist.rows} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Our group. The master pool&apos;s Week {dist.week} picks are
                  not published yet.
                </p>
              </>
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
            Standings - official count
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
                No eliminations yet - this fills in as teams start killing
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
