// One row of a bar list: a label, a track with a fill, a count and a share.
// The dashboard's pick distribution and carnage list draw the same row so the
// eye reads both the same way. It is a server component with no state: every
// number is visible text, right-aligned in a fixed column, and the fill is a
// percent width of a `minmax(0,1fr)` track between fixed columns, so a phone
// at 380px keeps about 190px of track and nothing scrolls sideways.
//
// The FILL CLASS is handed in by the caller, which reads it from
// src/lib/result-colour.ts - this file writes no result colour of its own.

import { cn } from "@/lib/utils";

interface Props {
  label: string;
  /** A visible mark beside the label - W or L for a final result. */
  glyph?: string;
  /** The label's text colour, from TONE_TEXT_CLASS. */
  labelClass?: string;
  /** The fill's class, from TONE_BAR_CLASS. */
  fillClass: string;
  /** The fill's width as a share of the widest bar, 0-100. */
  width: number;
  count: number;
  /** The share to print, as a whole percent. */
  pct: number;
  /** One more visible fragment after the share, such as "2 out". */
  trailing?: { text: string; className?: string } | null;
  title?: string;
}

export const ROW_GRID =
  "grid h-7 grid-cols-[3.25rem_minmax(0,1fr)_3rem_2.75rem] items-center gap-2";

export function BarRow({ label, glyph, labelClass, fillClass, width, count, pct, trailing, title }: Props) {
  return (
    <li className={ROW_GRID} title={title}>
      <span className={cn("truncate text-sm font-semibold", labelClass)}>
        {label}
        {glyph ? (
          <span className="ml-1 text-[10px] font-bold uppercase" aria-label={glyph === "W" ? "won" : "lost"}>
            {glyph}
          </span>
        ) : null}
      </span>
      <div className="h-5 overflow-hidden rounded bg-surface-2">
        {/* Floored at 1.5% so a one-pick team is still a visible sliver. */}
        <div
          className={cn("h-full rounded", fillClass)}
          style={{ width: `${count > 0 ? Math.max(1.5, Math.min(100, width)) : 0}%` }}
        />
      </div>
      <span className="text-right text-sm tabular-nums">{count.toLocaleString("en-US")}</span>
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {pct}%
        {trailing ? (
          <span className={cn("ml-1 block text-[10px] leading-3 sm:ml-0", trailing.className)}>{trailing.text}</span>
        ) : null}
      </span>
    </li>
  );
}
