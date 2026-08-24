"use client";

// D5: one screen per week, two number inputs per game. Fetch from ESPN
// pre-fills for review; NOTHING commits until the echo-confirm restates
// every result and gets an explicit yes.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameRow } from "@/lib/data/types";
import {
  fetchEspnScoresAction,
  setGameScoresAction,
  type GameScoreInput,
} from "@/app/admin/actions";
import { TEAM_PALETTE } from "@/lib/team-colors";
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

interface Draft {
  home: string;
  away: string;
  final: boolean;
}

function kickoffLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ScoresEditor({
  week,
  weeks,
  games,
}: {
  week: number;
  weeks: number[];
  games: GameRow[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      games.map((g) => [
        g.id,
        {
          home: g.homeScore === null ? "" : String(g.homeScore),
          away: g.awayScore === null ? "" : String(g.awayScore),
          final: g.status === "final",
        },
      ]),
    ),
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(id: string, p: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));
    setConfirming(false);
    setMsg(null);
    setError(null);
  }

  const changes = useMemo(() => {
    const out: (GameScoreInput & { game: GameRow })[] = [];
    for (const g of games) {
      const d = drafts[g.id];
      if (!d) continue;
      const home = d.home.trim() === "" ? null : Number(d.home);
      const away = d.away.trim() === "" ? null : Number(d.away);
      const status: GameScoreInput["status"] = d.final
        ? "final"
        : home !== null || away !== null
          ? "in_progress"
          : "scheduled";
      const changed =
        home !== g.homeScore || away !== g.awayScore || status !== g.status;
      if (changed) out.push({ gameId: g.id, homeScore: home, awayScore: away, status, game: g });
    }
    return out;
  }, [drafts, games]);

  const invalid = changes.filter(
    (c) =>
      (c.homeScore !== null && !Number.isInteger(c.homeScore)) ||
      (c.awayScore !== null && !Number.isInteger(c.awayScore)) ||
      (c.status === "final" && (c.homeScore === null || c.awayScore === null)),
  );

  async function fetchEspn() {
    setBusy(true);
    setError(null);
    const res = await fetchEspnScoresAction({ week });
    setBusy(false);
    if (!res.ok || !res.games) {
      setError(res.error ?? "ESPN fetch failed");
      return;
    }
    let filled = 0;
    setDrafts((d) => {
      const next = { ...d };
      for (const g of games) {
        const e = res.games!.find(
          (x) => x.home === g.homeTeam && x.away === g.awayTeam,
        );
        if (e && e.final && e.homeScore !== null && e.awayScore !== null) {
          next[g.id] = {
            home: String(e.homeScore),
            away: String(e.awayScore),
            final: true,
          };
          filled += 1;
        }
      }
      return next;
    });
    setMsg(
      filled > 0
        ? `Pre-filled ${filled} final${filled === 1 ? "" : "s"} from ESPN — review, then confirm.`
        : "ESPN has no finals for this week yet.",
    );
    setConfirming(false);
  }

  async function commit() {
    setBusy(true);
    setError(null);
    const res = await setGameScoresAction({
      scores: changes.map(({ gameId, homeScore, awayScore, status }) => ({
        gameId,
        homeScore,
        awayScore,
        status,
      })),
    });
    setBusy(false);
    setConfirming(false);
    if (!res.ok && (res.failures?.length ?? 0) === 0) {
      setError(res.error ?? "Save failed");
      return;
    }
    if (res.failures && res.failures.length > 0) {
      setError(`Some games failed: ${res.failures.join("; ")}`);
    }
    setMsg(
      `Saved. ${res.picksRecomputed ?? 0} pick result${(res.picksRecomputed ?? 0) === 1 ? "" : "s"} recomputed from the games.`,
    );
    router.refresh();
  }

  const resultLine = (c: (typeof changes)[number]) => {
    const g = c.game;
    if (c.status !== "final") {
      return `${g.awayTeam} @ ${g.homeTeam} — ${c.status === "scheduled" ? "cleared back to scheduled" : "in progress"}`;
    }
    if (c.homeScore! > c.awayScore!)
      return `${g.homeTeam} beat ${g.awayTeam} ${c.homeScore}–${c.awayScore}`;
    if (c.awayScore! > c.homeScore!)
      return `${g.awayTeam} beat ${g.homeTeam} ${c.awayScore}–${c.homeScore}`;
    return `${g.awayTeam} @ ${g.homeTeam} tied ${c.homeScore}–${c.awayScore} — a LOSS for both sides' pickers`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={String(week)}
          onValueChange={(v) => router.push(`/admin/scores?week=${v}`)}
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
        <Button size="sm" variant="outline" onClick={fetchEspn} disabled={busy}>
          Fetch week {week} from ESPN
        </Button>
        <span className="text-xs text-muted-foreground">
          Pre-fills only — nothing commits without your confirm.
        </span>
      </div>

      {msg ? <p className="text-sm text-win">{msg}</p> : null}
      {error ? <p className="text-sm text-loss">{error}</p> : null}

      <div className="space-y-2">
        {games.map((g) => {
          const d = drafts[g.id];
          return (
            <div
              key={g.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5",
                d?.final ? "border-win/40 bg-win/5" : "border-border bg-surface",
              )}
            >
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                {kickoffLabel(g.kickoffAt)} ET
              </span>
              <span className="flex w-40 items-center gap-1.5 font-medium">
                <span
                  className="h-4 w-1 rounded-full"
                  style={{ background: TEAM_PALETTE[g.awayTeam]?.display }}
                />
                {g.awayTeam}
                <span className="text-xs text-muted-foreground">@</span>
                <span
                  className="h-4 w-1 rounded-full"
                  style={{ background: TEAM_PALETTE[g.homeTeam]?.display }}
                />
                {g.homeTeam}
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  value={d?.away ?? ""}
                  onChange={(e) => patch(g.id, { away: e.target.value })}
                  inputMode="numeric"
                  aria-label={`${TEAM_NAME[g.awayTeam]} score`}
                  placeholder={g.awayTeam}
                  className="h-9 w-14 rounded-md border border-border bg-surface px-2 text-center text-sm tabular-nums"
                />
                <span className="text-muted-foreground">–</span>
                <input
                  value={d?.home ?? ""}
                  onChange={(e) => patch(g.id, { home: e.target.value })}
                  inputMode="numeric"
                  aria-label={`${TEAM_NAME[g.homeTeam]} score`}
                  placeholder={g.homeTeam}
                  className="h-9 w-14 rounded-md border border-border bg-surface px-2 text-center text-sm tabular-nums"
                />
              </div>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={d?.final ?? false}
                  onChange={(e) => patch(g.id, { final: e.target.checked })}
                  className="size-4 accent-[var(--primary)]"
                />
                Final
              </label>
              {g.status === "final" ? (
                <span className="ml-auto text-xs text-win">
                  saved {g.awayScore}–{g.homeScore}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {invalid.length > 0 ? (
        <p className="text-sm text-loss">
          {invalid.length} game{invalid.length === 1 ? "" : "s"} marked final
          without both scores, or with non-whole numbers.
        </p>
      ) : null}

      {confirming && changes.length > 0 ? (
        <div className="rounded-md border border-tie/50 bg-tie/10 px-4 py-3 text-sm">
          <p className="font-semibold">
            Confirm week {week} — this writes {changes.length}{" "}
            {changes.length === 1 ? "game" : "games"} and recomputes every
            affected pick:
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs">
            {changes.map((c) => (
              <li key={c.gameId}>{resultLine(c)}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={commit} disabled={busy}>
              Yes — commit these results
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <Button
          disabled={busy || changes.length === 0 || invalid.length > 0}
          onClick={() => setConfirming(true)}
        >
          Review {changes.length} {changes.length === 1 ? "change" : "changes"}…
        </Button>
      )}
    </div>
  );
}
