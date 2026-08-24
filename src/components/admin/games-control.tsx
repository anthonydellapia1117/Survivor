"use client";

// Per-game lock state at a glance, with the manual reveal override.
// AUTO follows kickoff; REVEAL/LOCK win over the clock in either direction.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GameRow } from "@/lib/data/types";
import { gameIsRevealed } from "@/lib/data/types";
import { setGameRevealAction } from "@/app/admin/actions";
import { TEAM_NAME } from "@/lib/standing";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function kickoffLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function GamesControl({
  week,
  weeks,
  games,
  pickCounts,
}: {
  week: number;
  weeks: number[];
  games: GameRow[];
  pickCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  async function setOverride(gameId: string, override: boolean | null) {
    setBusy(gameId);
    setError(null);
    const res = await setGameRevealAction({ gameId, override });
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "Failed to change visibility");
      return;
    }
    router.refresh();
  }

  const revealedCount = games.filter((g) => gameIsRevealed(g, now)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={String(week)}
          onValueChange={(v) => router.push(`/admin/games?week=${v}`)}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {weeks.map((w) => (
              <SelectItem key={w} value={String(w)}>
                Week {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs tabular-nums text-muted-foreground">
          {revealedCount} of {games.length} games public
        </span>
      </div>

      {error ? <p className="text-sm text-loss">{error}</p> : null}

      <ul className="divide-y divide-border/60 rounded-lg border border-border">
        {games.map((g) => {
          const open = gameIsRevealed(g, now);
          const picks =
            (pickCounts[g.awayTeam] ?? 0) + (pickCounts[g.homeTeam] ?? 0);
          return (
            <li
              key={g.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm"
            >
              <span
                className={cn(
                  "w-24 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-semibold",
                  open
                    ? "bg-win/15 text-win"
                    : "bg-surface-2 text-muted-foreground",
                )}
                title={
                  g.revealOverride === null
                    ? "Automatic — follows kickoff"
                    : g.revealOverride
                      ? "Forced open by override"
                      : "Forced locked by override"
                }
              >
                {open ? "PUBLIC" : "🔒 LOCKED"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {TEAM_NAME[g.awayTeam] ?? g.awayTeam} @{" "}
                  {TEAM_NAME[g.homeTeam] ?? g.homeTeam}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {kickoffLabel(g.kickoffAt)} ET
                  {g.network ? ` · ${g.network}` : ""}
                  {picks > 0 ? ` · ${picks} ${picks === 1 ? "pick" : "picks"}` : ""}
                </span>
              </span>
              <span className="inline-flex rounded-md border border-border bg-surface p-0.5">
                {(
                  [
                    { label: "Auto", value: null },
                    { label: "Reveal", value: true },
                    { label: "Lock", value: false },
                  ] as const
                ).map((opt) => (
                  <Button
                    key={opt.label}
                    size="xs"
                    variant="ghost"
                    disabled={busy === g.id}
                    onClick={() => setOverride(g.id, opt.value)}
                    className={cn(
                      "h-7 px-2 text-xs",
                      g.revealOverride === opt.value &&
                        "bg-surface-2 font-semibold",
                    )}
                  >
                    {opt.label}
                  </Button>
                ))}
              </span>
            </li>
          );
        })}
        {games.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground">
            No games this week.
          </li>
        ) : null}
      </ul>

      <p className="text-xs text-muted-foreground">
        AUTO = public at kickoff. REVEAL/LOCK override the clock and stay
        until set back to Auto. Every change is audited.
      </p>
    </div>
  );
}
