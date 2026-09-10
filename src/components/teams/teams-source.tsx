"use client";

// Which pool the Teams page reads: the Master List (every entry in the
// master pool, from the published sheet) or our group (our recorded picks).
// The Master List is the default once she has published a week's picks,
// because that is what the group wants to see; until then our group stands
// in and says so. The choice is view state only.

import { useState } from "react";
import type { EntrySummary, GameRow, GridCell } from "@/lib/data/types";
import { defaultTeamsSource, type TeamsSourceKind as Source } from "@/lib/master-list";
import { TeamsClient } from "@/components/teams/teams-client";
import { cn } from "@/lib/utils";

interface Dataset {
  entries: EntrySummary[];
  cells: GridCell[];
}

interface Props {
  ours: Dataset;
  pool: Dataset;
  /** The master pool's sheet is loaded (rows exist). */
  poolLoaded: boolean;
  /** The sheet carries at least one week pick. */
  poolHasPicks: boolean;
  weekCount: number;
  games: GameRow[];
}

export function TeamsSource({ ours, pool, poolLoaded, poolHasPicks, weekCount, games }: Props) {
  const [source, setSource] = useState<Source>(defaultTeamsSource(poolLoaded, poolHasPicks));
  const active = source === "pool" ? pool : ours;
  const options: { key: Source; label: string; n: number; disabled?: boolean }[] = [
    { key: "pool", label: "Master List", n: pool.entries.length, disabled: !poolLoaded },
    { key: "ours", label: "Our group", n: ours.entries.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="radiogroup"
          aria-label="Master List or our group"
          className="inline-flex rounded-lg border border-border bg-surface p-0.5"
        >
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={source === o.key}
              disabled={o.disabled}
              onClick={() => setSource(o.key)}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide transition-colors duration-150 disabled:opacity-50",
                source === o.key ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
              <span className="tabular-nums opacity-70">{o.n.toLocaleString("en-US")}</span>
            </button>
          ))}
        </div>
        {source === "pool" ? (
          <span className="text-xs text-muted-foreground">
            {poolHasPicks
              ? "Built from the published picks revealed so far, counted only where the game has finished."
              : "The published sheet carries no week picks yet."}
          </span>
        ) : null}
      </div>
      <TeamsClient key={source} cells={active.cells} weekCount={weekCount} games={games} />
    </div>
  );
}
