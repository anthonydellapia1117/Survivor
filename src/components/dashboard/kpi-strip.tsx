// Four tiles: the play week and its next lock, who is still alive, what this
// week cost, and the week's most-picked team with its result. Scoped by the
// section toggle - the pool by default - and computed once per scope by
// dashboardKpis, so Everyone and Our group cannot be counted two ways.
//
// Colour never carries alone: the chalk tile prints "won", "lost" or "not
// final" beside the code, and the loss tile prints "N now out" in text.
// The losses count is the damaged-but-alive yellow; "now out" is the OUT
// vocabulary's red, as the Eliminated card above already has it.
//
// A tile that has nothing true to say prints "-" and WHY, in this order:
// the scope does not hold the week's picks yet (her sheet has no column for
// it - a zero there would read as nobody lost), the week's picks are still
// masked (the chalk is a share, and a share over the revealed subset is a
// wrong number), no game of the week is final yet.

import { LOCK_KIND_LABEL, type DashboardKpis, type LockBoundary } from "@/lib/dashboard";
import { formatDeadline } from "@/lib/format";
import { OUT_TEXT_CLASS, TONE_TEXT_CLASS } from "@/lib/result-colour";
import { Countdown } from "@/components/dashboard/countdown";
import { cn } from "@/lib/utils";

interface Props {
  kpis: DashboardKpis;
  /** The play week, or null before the season has one. */
  week: number | null;
  deadline: LockBoundary | null;
  /** What ALIVE is out of: her published Total in Pool, or the scope's count. */
  total: number;
}

/** The one sentence under a "-" tile. Exported so the page test can pin the words. */
export const KPI_EMPTY = {
  unpublished: "not published yet",
  masked: "picks still masked",
  noFinal: "no game final yet",
  noPicks: "no picks",
} as const;

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Empty({ why }: { why: string }) {
  return (
    <>
      <p className="text-2xl tabular-nums">-</p>
      <p className="mt-1 text-xs text-muted-foreground">{why}</p>
    </>
  );
}

export function KpiStrip({ kpis, week, deadline, total }: Props) {
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-numeric>
      <Tile label="Week">
        <p className="text-2xl tabular-nums">{week ?? "-"}</p>
        {deadline ? (
          <p className="mt-1 text-xs text-muted-foreground">
            W{deadline.week} {LOCK_KIND_LABEL[deadline.kind]} lock in <Countdown deadlineIso={deadline.deadlineAt} />
            <span className="mt-0.5 block" suppressHydrationWarning>
              {formatDeadline(deadline.deadlineAt)}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">season complete</p>
        )}
      </Tile>
      <Tile label="Alive">
        <p className="text-2xl tabular-nums">{n(kpis.alive)}</p>
        <p className="mt-1 text-xs text-muted-foreground">of {n(total)}</p>
      </Tile>
      <Tile label="Lost this week">
        {!kpis.published ? (
          <Empty why={KPI_EMPTY.unpublished} />
        ) : !kpis.anyFinal ? (
          <Empty why={KPI_EMPTY.noFinal} />
        ) : (
          <>
            <p className={cn("text-2xl tabular-nums", TONE_TEXT_CLASS.lost)}>{n(kpis.lostThisWeek)}</p>
            <p className={cn("mt-1 text-xs", OUT_TEXT_CLASS)}>{n(kpis.outThisWeek)} now out</p>
          </>
        )}
      </Tile>
      <Tile label="Chalk">
        {!kpis.published ? (
          <Empty why={KPI_EMPTY.unpublished} />
        ) : !kpis.revealed ? (
          <Empty why={KPI_EMPTY.masked} />
        ) : !kpis.anyFinal ? (
          <Empty why={KPI_EMPTY.noFinal} />
        ) : kpis.chalk ? (
          <>
            <p className={cn("text-2xl tabular-nums", TONE_TEXT_CLASS[kpis.chalk.tone])}>
              {kpis.chalk.team}
              <span className="ml-1.5 text-sm text-muted-foreground">{kpis.chalk.pct}%</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {n(kpis.chalk.count)} {kpis.chalk.count === 1 ? "pick" : "picks"}, {kpis.chalk.state}
            </p>
          </>
        ) : (
          <Empty why={KPI_EMPTY.noPicks} />
        )}
      </Tile>
    </div>
  );
}
