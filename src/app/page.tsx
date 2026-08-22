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
import { RESULT_LABEL, SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
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
  const [entries, weeks, cells, pot] = await Promise.all([
    data.getEntries(),
    data.getWeeks(),
    data.getGridCells(),
    data.getPot(),
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
  const deadline = nextLockBoundary(weeks, now);
  const activity = recentActivity(entries, cells, 10);
  const potPct =
    pot.dueCents > 0
      ? Math.min(100, Math.round((pot.paidCents / pot.dueCents) * 100))
      : 0;

  const segments = [
    { label: "Bye eligible", n: breakdown.byeEligible, cls: "bg-primary" },
    { label: "Active", n: breakdown.active, cls: "bg-win" },
    { label: "At risk", n: breakdown.atRisk, cls: "bg-tie" },
    { label: "Bye used", n: breakdown.byeUsed, cls: "bg-bye" },
    { label: "Eliminated", n: breakdown.eliminated, cls: "bg-loss" },
  ].filter((s) => s.n > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">2026 NFL Survivor Pool</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {entries.length} entries · live standings, picks, and pool health.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl tabular-nums">
              {formatCents(pot.paidCents)}
              <span className="text-sm text-muted-foreground">
                {" "}
                / {formatCents(pot.dueCents)}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${potPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
              {potPct}% collected
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
                  <p className="text-xs text-muted-foreground" suppressHydrationWarning>
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
          <CardTitle className="text-base">Standings</CardTitle>
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
        </CardContent>
      </Card>

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
