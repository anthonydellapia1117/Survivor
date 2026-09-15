import Link from "next/link";
import { getData } from "@/lib/data";
import { formatDeadline, formatEtDate } from "@/lib/format";
import {
  chalkByWeek,
  currentPlayWeek,
  latestScoredWeek,
  LOCK_KIND_LABEL,
  nextLockBoundary,
  pickDistribution,
  recentActivity,
  survivalByWeek,
  teamsRunningOut,
  weekDamage,
  weekTeamResults,
} from "@/lib/dashboard";
import { NFL_TEAMS, RESULT_LABEL, SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { lynneBucket } from "@/lib/lynne/names";
import { scoreFromGames } from "@/lib/live-standing";
import {
  fullyRevealedWeeks,
  poolAsEntries,
  poolDistribution,
  poolStandings,
  poolStats,
  poolWeekFilled,
  standingCounts,
} from "@/lib/master-list";
import { toneOfResult, toneOfTeamResult } from "@/lib/result-colour";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  chalkVerdict,
  DamageBars,
  DISTRIBUTION_LEGEND,
  DistributionBars,
  Legend,
  SurvivalColumns,
  TeamsLeftBars,
  type ToneRow,
} from "@/components/dashboard/charts";
import { Countdown } from "@/components/dashboard/countdown";
import { EmptyState } from "@/components/empty-state";
import { ScopeToggle, scopeFrom } from "@/components/scope-toggle";
import { cn } from "@/lib/utils";
import { LockClosedIcon } from "@/components/dashboard/lock-icon";

// Rendered on every request: the countdown, the scores and her sheet move.
export const revalidate = 0;

const RESULT_TEXT: Record<string, string> = {
  win: "text-win",
  loss: "text-loss",
  tie_loss: "text-tie",
  bye: "text-muted-foreground",
  missed: "text-loss",
};

export default async function DashboardPage(
  props: { searchParams?: Promise<{ scope?: string | string[] }> } = {},
) {
  const params = (await props.searchParams) ?? {};
  const data = getData();
  const [storedEntries, weeks, storedCells, pot, games, master] = await Promise.all([
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
  // This week's losses and the rolling counts move as games go final, read
  // from the same scores that colour her rows; the stored record is her
  // results file and is untouched (src/lib/live-standing.ts).
  const ours = scoreFromGames(storedEntries, storedCells, games);

  if (ours.entries.length === 0 && master.rows.length === 0) {
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

  // EVERY figure below the toggle reads ONE scope (Anthony, 2026-09-15): the
  // whole pool by default - every row of her newest sheet, scored from her
  // published picks and our finals - and this group only when the toggle says
  // Our group. The survival chart used to read "121 remaining" to every
  // viewer; our 121 are what Anthony manages, not what a viewer came for.
  const poolLoaded = master.rows.length > 0;
  const scope = scopeFrom(params.scope, poolLoaded);
  const pool = poolLoaded ? poolAsEntries(master, games) : { entries: [], cells: [] };
  const view = scope === "pool" ? pool : ours;

  const now = new Date();
  const playWeek = currentPlayWeek(weeks, now);
  const deadline = nextLockBoundary(weeks, games, now);
  // Her four figures, from the same poolStats() the Master List reads, so
  // the two pages cannot drift apart.
  const herFigures = poolStats(pot);
  // The whole pool's health in her buckets, over every row of her sheet.
  // Ours is the second, independent calculation (CLAUDE.md): a row she has
  // struck OUT is Out whatever our scores say.
  const poolStand = poolStandings(master, games);
  const oursCounts = standingCounts(ours.entries);
  const health =
    scope === "pool"
      ? { noLosses: poolStand.noLosses, lossBye: poolStand.lossBye, out: poolStand.out, total: poolStand.total }
      : { noLosses: oursCounts["No Losses"], lossBye: oursCounts["1 Loss/Bye"], out: oursCounts.Out, total: ours.entries.length };
  const segments = [
    { label: "No Losses", n: health.noLosses, cls: "bg-win" },
    { label: "1 Loss/Bye", n: health.lossBye, cls: "bg-tie" },
    { label: "Out", n: health.out, cls: "bg-loss" },
  ].filter((s) => s.n > 0);

  // The week's picks. In Everyone scope, the whole pool's cells from her
  // sheet once she has published the week; our group stands in until then and
  // says so. In Our group scope, our own revealed picks.
  const poolDist =
    scope === "pool" && playWeek && poolWeekFilled(master.rows, playWeek.week)
      ? poolDistribution(master.rows, playWeek.week)
      : null;
  // The public view serves her cells only as their games kick off, so until
  // every game of the week has, the chart is the revealed subset and the
  // caption says so rather than claiming the whole pool.
  const poolDistWhole = playWeek !== null && fullyRevealedWeeks(games, now).includes(playWeek.week);
  const dist = pickDistribution(weeks, ours.cells, now);
  const distWeek = poolDist ? playWeek!.week : (dist?.week ?? null);
  // Every bar takes its team's result colour (Anthony, 2026-09-15): won
  // subtle green, lost yellow, no final neutral. The counts are untouched.
  const resultOf = distWeek !== null ? weekTeamResults(games, distWeek) : () => undefined;
  const toneRows = (rows: { team: string; count: number; pct: number }[]): ToneRow[] =>
    rows.map((r) => ({
      ...r,
      tone: r.team === SKIP_WEEK ? "bye" : toneOfTeamResult(resultOf(r.team)),
    }));
  const distRows = poolDist ? toneRows(poolDist.rows) : dist?.revealed ? toneRows(dist.rows) : [];
  const top = distRows[0];
  const verdict = top ? chalkVerdict(top.tone) : null;
  const distTotal = distRows.reduce((n, r) => n + r.count, 0);

  const series = survivalByWeek(view.entries, view.cells);
  const damageWeek = latestScoredWeek(view.cells);
  const damage = damageWeek !== null ? weekDamage(view.entries, view.cells, damageWeek) : null;
  const chalk = chalkByWeek(weeks, view.cells);
  const scarce = teamsRunningOut(view.entries, NFL_TEAMS.map((t) => t.abbr));
  const activity = scope === "ours" ? recentActivity(ours.entries, ours.cells, 10) : [];

  // Lynne's three buckets in her own sentence, for our group: the line
  // Anthony can paste. The whole pool's is her own sheet.
  const buckets = { "No Losses": 0, "Loss/Bye": 0, Out: 0 };
  for (const e of ours.entries) buckets[lynneBucket(e)] += 1;
  const alive = ours.entries.length - buckets.Out;
  const lynneSentence = `No Losses=${buckets["No Losses"]}, 1 Loss/Bye used=${buckets["Loss/Bye"]} and Out=${buckets.Out}. We are down to ${alive} left in the pool.`;

  const scopeLabel = scope === "pool" ? "Everyone" : "Our group";

  return (
    <div className="space-y-5">
      {/* The subtitle came off on 2026-09-11. It read "121 entries · live
          standings, picks, and pool health" - an OUR-GROUP count a viewer did
          not come for, followed by a list of what the page visibly already
          is. Same reasoning that took Entries and Alive off the cards below
          and the alive figure off the share card. */}
      <h1 className="text-2xl">2026 NFL Survivor Pool</h1>

      {/* The master pool's own four figures, exactly as she publishes them,
          read through the same poolStats() the Master List uses so the two
          pages cannot drift. Her per-entry rate is never printed on a public
          route. They are hers in either scope. */}
      {herFigures.length > 0 ? (
        <div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {herFigures.map((s) => (
              <Card key={s.label} className="gap-1 bg-surface py-3">
                <CardHeader className="px-4">
                  <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4">
                  <div className="text-xl tabular-nums sm:text-2xl">{s.value}</div>
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScopeToggle
          scope={scope}
          poolCount={poolLoaded ? pool.entries.length : null}
          oursCount={ours.entries.length}
          path="/"
        />
        {deadline ? (
          <p className="text-xs text-muted-foreground">
            W{deadline.week} {LOCK_KIND_LABEL[deadline.kind]} lock in{" "}
            <span className="font-semibold text-foreground">
              <Countdown deadlineIso={deadline.deadlineAt} />
            </span>
            <span className="block" suppressHydrationWarning>
              {formatDeadline(deadline.deadlineAt)}
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Season complete</p>
        )}
      </div>

      {/* Health in her buckets, for the scope. Her middle bucket is "1
          LOSS/BYE" on the sheet, not "1 loss": a burned bye lands here
          without a loss, so the label follows her wording. */}
      <Card className="gap-3 bg-surface py-4">
        <CardContent className="space-y-3 px-4">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">No Losses</div>
              <div className="text-2xl tabular-nums text-win">{health.noLosses.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">1 Loss/Bye</div>
              <div className="text-2xl tabular-nums text-tie">{health.lossBye.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Eliminated</div>
              <div className="text-2xl tabular-nums text-loss">{health.out.toLocaleString()}</div>
              {/* Not "struck out": most of these are our own calculation -
                  two losses, a late loss, a repeated team. Her explicit OUT
                  is authoritative and included, but it is not the whole
                  number. */}
              <p className="text-[11px] text-muted-foreground">{scope === "pool" ? "out on this sheet" : "out in our group"}</p>
            </div>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
            {segments.map((s) => (
              <div
                key={s.label}
                className={cn("h-full", s.cls)}
                style={{ width: `${(s.n / Math.max(1, health.total)) * 100}%` }}
                title={`${s.label}: ${s.n}`}
              />
            ))}
          </div>
          {scope === "pool" ? (
            <p className="text-xs text-muted-foreground">
              Across all {poolStand.total.toLocaleString()} rows of her sheet
              {poolStand.scoredThrough !== null
                ? `, scored through Week ${poolStand.scoredThrough}`
                : poolStand.inProgressWeek !== null
                  ? ", no week fully scored yet"
                  : ", before any week has been scored"}
              {poolStand.inProgressWeek !== null ? `, Week ${poolStand.inProgressWeek} in progress` : ""}
              . Our own count from her published picks, a NO PICK counted as the
              loss it is in her pool; a row her sheet writes OUT on is out
              whatever we compute. She removes eliminated entries as the season
              goes, so these describe the rows on her newest sheet rather than a
              running total for the season.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Across our group&apos;s {ours.entries.length.toLocaleString()} entries, from our recorded picks and the finals.
              </p>
              <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">{lynneSentence}</p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 bg-surface py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-baseline justify-between gap-2 text-base">
              Survival by week
              <span className="text-xs font-normal text-muted-foreground">{scopeLabel}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <SurvivalColumns series={series} />
          </CardContent>
        </Card>

        <Card className="gap-3 bg-surface py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-baseline justify-between gap-2 text-base">
              Week {distWeek ?? "-"} picks
              <span className="text-xs font-normal text-muted-foreground">
                {poolDist ? "Everyone" : "Our group"}
              </span>
            </CardTitle>
            {top && verdict ? (
              <p className="text-sm">
                Most picked:{" "}
                <span className="font-semibold">{TEAM_NAME[top.team] ?? top.team}</span>,{" "}
                <span className="tabular-nums">{top.count.toLocaleString("en-US")}</span> of{" "}
                <span className="tabular-nums">{distTotal.toLocaleString("en-US")}</span> -{" "}
                <span className={cn("font-semibold", verdict.cls)}>{verdict.text}</span>
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            {distRows.length > 0 ? (
              <>
                <DistributionBars rows={distRows} />
                <Legend items={DISTRIBUTION_LEGEND} />
                {poolDist ? (
                  <p className="text-xs text-muted-foreground">
                    {poolDistWhole
                      ? "Every entry in the master pool, from the published sheet"
                      : `Revealed picks so far in the master pool, ${poolDist.revealed.toLocaleString("en-US")} of ${master.rows.length.toLocaleString("en-US")} rows on the published sheet; the rest appear as their games kick off`}
                    {poolDist.noPick > 0 ? `; ${poolDist.noPick.toLocaleString("en-US")} NO PICK, each a loss` : ""}
                    {poolDist.other > 0 ? `; ${poolDist.other} cells are not a team (OUT or a note)` : ""}
                    .{" "}
                    <Link href="/grid" className="text-primary underline-offset-2 hover:underline">
                      The Grid
                    </Link>
                  </p>
                ) : scope === "pool" ? (
                  <p className="text-xs text-muted-foreground">
                    Our group. The master pool&apos;s Week {dist?.week} picks are not published yet.
                  </p>
                ) : null}
                {chalk.length > 1 ? (
                  <p className="text-xs text-muted-foreground">
                    Most picked each week:{" "}
                    {chalk.map((c, i) => {
                      const v = chalkVerdict(toneOfResult(c.result));
                      return (
                        <span key={c.week}>
                          {i > 0 ? ", " : ""}W{c.week} {c.team} <span className={v.cls}>{v.text.replace("chalk ", "")}</span>
                        </span>
                      );
                    })}
                  </p>
                ) : null}
              </>
            ) : dist && !dist.revealed ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <LockClosedIcon className="size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Hidden until the Week {dist.week} deadline passes.
                </p>
                {deadline && deadline.week === dist.week ? (
                  <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                    {formatDeadline(deadline.deadlineAt)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No picks recorded for this week yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 bg-surface py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-baseline justify-between gap-2 text-base">
              Carnage{damage ? `, Week ${damage.week}` : ""}
              <span className="text-xs font-normal text-muted-foreground">{scopeLabel}</span>
            </CardTitle>
            {damage ? (
              <p className="text-sm">
                <span className="text-2xl font-semibold tabular-nums text-tie">{damage.lost.toLocaleString("en-US")}</span>{" "}
                lost a life
                <span className="text-muted-foreground">
                  {" "}
                  ({damage.aliveBefore > 0 ? Math.round((damage.lost / damage.aliveBefore) * 100) : 0}% of{" "}
                  {damage.aliveBefore.toLocaleString("en-US")})
                </span>
                ,{" "}
                <span className={cn("font-semibold tabular-nums", damage.out > 0 ? "text-loss" : "text-muted-foreground")}>
                  {damage.out.toLocaleString("en-US")} out
                </span>
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            {damage && damage.rows.length > 0 ? (
              <>
                <DamageBars rows={damage.rows} />
                <p className="text-xs text-muted-foreground">
                  Entries that took a loss on each team, a NO PICK included; red is the share that loss finished.
                </p>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {damage ? "Nobody lost a life this week." : "Fills in as games go final."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="gap-3 bg-surface py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-baseline justify-between gap-2 text-base">
              Teams running out
              <span className="text-xs font-normal text-muted-foreground">{scopeLabel}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            {scarce.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Every alive entry still holds all 32 teams. Scarcity shows up as picks burn teams.
              </p>
            ) : (
              <>
                <TeamsLeftBars rows={scarce.rows} alive={scarce.alive} />
                <p className="text-xs text-muted-foreground">
                  Share of the {scarce.alive.toLocaleString("en-US")} alive entries that can still take each team.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {scope === "ours" ? (
        <Card className="gap-3 bg-surface py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
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
                    {/* The code on a phone, the name from sm up: the full
                        name left the entry name a few letters wide. */}
                    <span className="shrink-0 text-muted-foreground">
                      <span className="sm:hidden">{a.team === SKIP_WEEK ? "Bye" : a.team}</span>
                      <span className="hidden sm:inline">
                        {a.team === SKIP_WEEK ? "Bye" : (TEAM_NAME[a.team] ?? a.team)}
                      </span>
                    </span>
                    <span className={cn("w-16 shrink-0 text-right text-xs font-medium", RESULT_TEXT[a.result])}>
                      {RESULT_LABEL[a.result]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
