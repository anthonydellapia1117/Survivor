// The field, as three numbers: where it started, what is left, and the
// latest scored week's drop. A chart does not earn its place at two points -
// after Week 1 the curve is one subtraction - so the step chart draws only
// once curveEarnsChart says so, as an inline SVG the server renders: no chart
// library, no axes, no tooltip. The three numbers ARE the readout, and each
// step's count is printed under the chart as text so nothing lives only in
// the picture.
//
// The drop is printed in the OUT vocabulary (OUT_TEXT_CLASS): it counts
// entries that are finished, which is what red means on this site. A week
// still in play is labelled "so far": survivalCurve reaches a week at its
// first final, and "Week 2 0" on a Thursday night would read as a week that
// cost nothing when the week has barely started.

import { type SurvivalStrip as Strip } from "@/lib/dashboard-scope";
import { OUT_TEXT_CLASS } from "@/lib/result-colour";
import { cn } from "@/lib/utils";

const W = 320;
const H = 72;
const PAD = 4;

/** A stepAfter path through the points, y scaled to [0, start]. */
export function stepPath(points: Strip["points"], start: number): string {
  if (points.length === 0) return "";
  const xs = (i: number) => PAD + (i / Math.max(1, points.length - 1)) * (W - 2 * PAD);
  const ys = (v: number) => H - PAD - (start > 0 ? (v / start) * (H - 2 * PAD) : 0);
  let d = `M${xs(0).toFixed(1)},${ys(points[0].remaining).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H${xs(i).toFixed(1)} V${ys(points[i].remaining).toFixed(1)}`;
  }
  return d;
}

/** The third tile's label: the week, and "so far" while a game of it is not final. */
export function dropLabel(drop: Strip["drop"]): string {
  if (!drop) return "This week";
  return drop.partial ? `Week ${drop.week} so far` : `Week ${drop.week}`;
}

export function SurvivalStrip({ strip }: { strip: Strip }) {
  const n = (v: number) => v.toLocaleString("en-US");
  const last = strip.points[strip.points.length - 1];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Start</p>
          <p className="text-2xl tabular-nums">{n(strip.start)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Remaining</p>
          <p className="text-2xl tabular-nums">{n(strip.remaining)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{dropLabel(strip.drop)}</p>
          {strip.drop && strip.drop.n > 0 ? (
            <p className={cn("text-2xl tabular-nums", OUT_TEXT_CLASS)}>
              -{n(strip.drop.n)}
              <span className="ml-1 text-xs text-muted-foreground">{strip.drop.pct}%</span>
            </p>
          ) : (
            <p className="text-2xl tabular-nums">0</p>
          )}
        </div>
      </div>
      {strip.chart ? (
        <div>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-16 w-full"
            role="img"
            aria-label={`Entries remaining, Week 1 to Week ${last.week}`}
            preserveAspectRatio="none"
          >
            <path
              d={`${stepPath(strip.points, strip.start)} V${H - PAD} H${PAD} Z`}
              className="fill-primary/15"
            />
            <path d={stepPath(strip.points, strip.start)} className="fill-none stroke-primary" strokeWidth={2} />
          </svg>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {strip.points
              .filter((p) => p.week > 0)
              .map((p) => `W${p.week} ${n(p.remaining)}`)
              .join("  ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
