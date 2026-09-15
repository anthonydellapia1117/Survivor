// What the week cost, by team: the same row grid as the pick distribution,
// every bar in the LOSING tone - yellow, never red. A team losing is a fact
// about a game, not an elimination (CLAUDE.md, the Teams page rule), so the
// bar takes TONE_BAR_CLASS.lost from src/lib/result-colour.ts; where some of
// those entries are now OUT the row says so in text, in the OUT vocabulary
// the page's Eliminated card already prints its count in.
//
// Server-rendered. A LOCKED cell has no result and an in-progress game a
// pending one, so nothing masked can reach a row here.

import { NO_PICK_LABEL, TOP_N, type WeekCarnage } from "@/lib/dashboard";
import { TONE_BAR_CLASS, TONE_TEXT_CLASS } from "@/lib/result-colour";
import { TEAM_NAME } from "@/lib/standing";
import { BarRow } from "@/components/dashboard/bar-row";

const OUT_TEXT = "text-loss";

export function CarnageList({ carnage }: { carnage: WeekCarnage }) {
  const max = Math.max(0, ...carnage.rows.map((r) => r.lost));
  const width = (n: number) => (max > 0 ? (n / max) * 100 : 0);
  const row = (r: WeekCarnage["rows"][number]) => (
    <BarRow
      key={r.team}
      label={r.team}
      labelClass={r.team === NO_PICK_LABEL ? "text-muted-foreground" : TONE_TEXT_CLASS.lost}
      fillClass={TONE_BAR_CLASS.lost}
      width={width(r.lost)}
      count={r.lost}
      pct={r.share}
      trailing={r.out > 0 ? { text: `${r.out} out`, className: OUT_TEXT } : null}
      title={r.team === NO_PICK_LABEL ? "No pick recorded" : (TEAM_NAME[r.team] ?? r.team)}
    />
  );
  const top = carnage.rows.slice(0, TOP_N);
  const rest = carnage.rows.slice(TOP_N);
  return (
    <div>
      <ol className="space-y-1">{top.map(row)}</ol>
      {rest.length > 0 ? (
        <details className="mt-2">
          <summary className="flex h-11 w-full cursor-pointer items-center text-sm text-primary">
            Show all {carnage.rows.length} teams
          </summary>
          <ol className="space-y-1 pb-1">{rest.map(row)}</ol>
        </details>
      ) : null}
    </div>
  );
}
