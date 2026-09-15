// The week's pick distribution as a list of bars, each in its team's RESULT
// colour: subtle green where the team won, yellow where it lost, the app
// accent where the game is not final (Anthony, 2026-09-15). The counts are
// exactly what poolDistribution / pickDistribution produced; only the colour
// is new, and it comes from src/lib/result-colour.ts through distributionRows.
//
// Server-rendered, no chart library and no tooltip: the count and the share
// are visible text on every row, the W / L glyph says in text what the fill
// says in colour, and the widest bar is full width with the rest relative to
// it. Rows past TOP_N fold into one "Others" row, with the whole list in a
// native details element - no state, no script.

import { MISSED_TEAM, TOP_N, type DistributionRows } from "@/lib/dashboard";
import { TONE_BAR_CLASS, TONE_TEXT_CLASS } from "@/lib/result-colour";
import { SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { BarRow, ROW_GRID } from "@/components/dashboard/bar-row";

const OTHERS_FILL = "bg-muted-foreground/30";

export function PickDistribution({ rows }: { rows: DistributionRows }) {
  const width = (n: number) => (rows.max > 0 ? (n / rows.max) * 100 : 0);
  const list = (items: DistributionRows["all"]) =>
    items.map((r) => (
      <BarRow
        key={r.team}
        label={r.label}
        glyph={r.glyph}
        labelClass={TONE_TEXT_CLASS[r.tone]}
        fillClass={TONE_BAR_CLASS[r.tone]}
        width={width(r.count)}
        count={r.count}
        pct={r.pct}
        title={r.team === SKIP_WEEK ? "Bye" : r.team === MISSED_TEAM ? "No pick recorded" : (TEAM_NAME[r.team] ?? r.team)}
      />
    ));

  return (
    <div>
      <ol className="space-y-1">
        {list(rows.top)}
        {rows.others ? (
          <li className={ROW_GRID}>
            <span className="truncate text-sm text-muted-foreground">Others</span>
            <div className="h-5 overflow-hidden rounded bg-surface-2">
              <div className={`h-full rounded ${OTHERS_FILL}`} style={{ width: `${Math.max(1.5, width(rows.others.count))}%` }} />
            </div>
            <span className="text-right text-sm tabular-nums">{rows.others.count.toLocaleString("en-US")}</span>
            <span className="text-right text-xs tabular-nums text-muted-foreground">{rows.others.pct}%</span>
          </li>
        ) : null}
      </ol>
      {rows.others ? (
        <details className="mt-2">
          <summary className="flex h-11 w-full cursor-pointer items-center text-sm text-primary">
            Show all {rows.all.length} teams
          </summary>
          <ol className="space-y-1 pb-1">{list(rows.all.slice(TOP_N))}</ol>
        </details>
      ) : null}
    </div>
  );
}
