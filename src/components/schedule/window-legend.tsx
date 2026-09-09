// Four small cells, styled like the season grid's cells and filled with
// their window's colour, above the Games and Season grid sections.

import { WINDOW_CELL_CLASS, WINDOW_LABEL, WINDOW_ORDER, WINDOW_TEXT_CLASS } from "@/lib/game-window";
import { cn } from "@/lib/utils";

export function WindowLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Game windows">
      {WINDOW_ORDER.map((w) => (
        <span
          key={w}
          className={cn(
            "inline-flex h-6 min-w-11 items-center justify-center border border-border/40 px-1.5 text-[10px] font-semibold tabular-nums",
            WINDOW_CELL_CLASS[w],
            WINDOW_TEXT_CLASS[w],
          )}
        >
          {WINDOW_LABEL[w]}
        </span>
      ))}
    </div>
  );
}
