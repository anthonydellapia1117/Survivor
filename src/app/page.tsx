import { getData } from "@/lib/data";
import { formatEtDate } from "@/lib/format";
import {
  currentPlayWeek,
  nextLockBoundary,
  pickDistribution,
} from "@/lib/dashboard";
import { dashboardScope, herOutWeeks, type ScopeInput } from "@/lib/dashboard-scope";
import { scoreFromGames } from "@/lib/live-standing";
import {
  fullyRevealedWeeks,
  poolAsEntries,
  poolDistribution,
  poolStandings,
  poolStats,
  weekColumns,
} from "@/lib/master-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScopeSection } from "@/components/dashboard/scope-section";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
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

  const now = new Date();
  const playWeek = currentPlayWeek(weeks, now);
  const week = playWeek?.week ?? null;
  // Her four figures, from the same poolStats() the Master List reads, so
  // the two pages cannot drift apart.
  const herFigures = poolStats(pot);
  // The whole pool's health in her buckets, over every row of her sheet
  // rather than our own. Ours is the second, independent calculation
  // (CLAUDE.md): a row she has struck OUT is Out whatever our scores say.
  const poolStand = poolStandings(master, games);
  const deadline = nextLockBoundary(weeks, games, now);

  // EVERY viewer KPI below Row 2 shows the whole pool by default and our
  // group only under the toggle (Anthony, 2026-09-15). Both scopes are the
  // one computation over the one shape: her rows through poolAsEntries, ours
  // through scoreFromGames, both handed to dashboardScope.
  const poolLoaded = master.rows.length > 0;
  const pool = poolAsEntries(master, games);
  // Her sheet carries a week's column at all, revealed or not. The section
  // still opens on Everyone without it - the alive count, the survival strip,
  // the standings and the chalk list all read her sheet as it stands - and
  // the tiles that need the week say "not published yet" until she does;
  // only the week's picks card has our group stand in.
  const herWeeks = new Set(weekColumns(master.rows).map((c) => c.week));
  const poolHasWeek = week !== null && herWeeks.has(week);
  // The whole pool's picks for the week, from the published sheet. The
  // public view serves her cells only as their games kick off, so until
  // every game of the week has, the list is the revealed subset and the
  // caption says so rather than claiming the whole pool.
  const poolDist = week !== null && poolHasWeek ? poolDistribution(master.rows, week) : null;
  const poolDistWhole = week !== null && fullyRevealedWeeks(games, now).includes(week);
  const lockedAt = deadline && deadline.week === week ? deadline.deadlineAt : null;
  const dist = pickDistribution(weeks, ours.cells, now);
  const oursDistribution: ScopeInput["distribution"] =
    dist?.revealed && dist.rows.length > 0
      ? {
          scope: "ours",
          rows: dist.rows,
          empty: "none",
          lockedAt: null,
          caption: poolHasWeek
            ? `Our group's Week ${dist.week} picks, as recorded.`
            : `Our group. The master pool's Week ${dist.week} picks are not published yet.`,
        }
      : dist && !dist.revealed
        ? {
            scope: "ours",
            rows: null,
            empty: "locked",
            lockedAt,
            caption: `Hidden until the Week ${dist.week} deadline passes.`,
          }
        : { scope: "ours", rows: null, empty: "none", lockedAt: null, caption: "No picks recorded for this week yet." };

  const poolDistribution_: ScopeInput["distribution"] =
    poolDist && poolDist.rows.length > 0
      ? {
          scope: "pool",
          rows: poolDist.rows,
          empty: "none",
          lockedAt: null,
          caption:
            (poolDistWhole
              ? "Every entry in the master pool, from the published sheet"
              : `Revealed picks so far in the master pool, ${poolDist.revealed.toLocaleString("en-US")} of ${master.rows.length.toLocaleString("en-US")} rows on the published sheet; the rest appear as their games kick off`) +
            (poolDist.other > 0 ? `; ${poolDist.other} cells are not a team (OUT or a note)` : "") +
            ".",
        }
      : poolHasWeek
        ? {
            scope: "pool",
            rows: null,
            empty: "locked",
            lockedAt,
            caption: `Her Week ${week} picks appear as the games kick off.`,
          }
        : // Until she publishes the week, OUR GROUP STANDS IN on this one
          // card and says so: our rows, our empty states, under the "Our
          // group" label, with the caption naming what is not published.
          {
            ...oursDistribution,
            caption:
              oursDistribution.rows !== null
                ? `Our group stands in until the master pool's Week ${week ?? "-"} picks are published.`
                : oursDistribution.caption,
          };

  const scopes = {
    pool: poolLoaded
      ? dashboardScope({
          key: "pool",
          entries: pool.entries,
          cells: pool.cells,
          games,
          now,
          week,
          start: pot.poolEntryCount,
          // A week she has not published is "not published yet" on the pool's
          // tiles, never a zero read off cells that do not exist.
          weekPublished: (w) => herWeeks.has(w),
          distribution: poolDistribution_,
          outWeeks: herOutWeeks(master),
        })
      : null,
    ours: dashboardScope({
      key: "ours",
      entries: ours.entries,
      cells: ours.cells,
      games,
      now,
      week,
      start: null,
      // Our own record holds every week's picks as they are made.
      weekPublished: () => true,
      distribution: oursDistribution,
    }),
  };

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

      {/* Everything below is ONE scoped section: the pool by default, our
          group only under its toggle. The second Eliminated card that used
          to sit here (our count, under the same title as Row 2's) came off
          with the same change. */}
      <ScopeSection
        pool={scopes.pool}
        ours={scopes.ours}
        week={week}
        deadline={deadline}
        herTotal={pot.poolEntryCount}
      />
    </div>
  );
}
