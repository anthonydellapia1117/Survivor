"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EntrySummary, GridCell, WeekRow } from "@/lib/data/types";
import { submitPicksBatchAction } from "@/app/admin/actions";
import { formatDeadline } from "@/lib/format";
import { NFL_TEAMS, SKIP_WEEK, STATUS_ORDER } from "@/lib/standing";
import { StatusDot } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BulkPasteDialog } from "@/components/admin/picks/bulk-paste-dialog";

function teamDisplay(team: string): string {
  return team === SKIP_WEEK ? "BYE" : team;
}

function relDeadline(
  iso: string,
  now: number,
): { label: string; locked: boolean } {
  const diff = new Date(iso).getTime() - now;
  const locked = diff < 0;
  const mins = Math.max(1, Math.round(Math.abs(diff) / 60000));
  const span =
    mins < 60
      ? `${mins}m`
      : mins < 48 * 60
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / 1440)}d`;
  return { label: locked ? `locked ${span} ago` : `locks in ${span}`, locked };
}

export function PicksEntry({
  entries,
  weeks,
  cells,
}: {
  entries: EntrySummary[];
  weeks: WeekRow[];
  cells: GridCell[];
}) {
  const router = useRouter();

  const [week, setWeek] = useState<number>(() => {
    const now = Date.now();
    return (
      weeks.find((w) => new Date(w.deadlineAt).getTime() > now)?.week ??
      weeks[weeks.length - 1]?.week ??
      1
    );
  });
  const [staged, setStaged] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () =>
      [...entries].sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.ownerName.localeCompare(b.ownerName) ||
          a.entryName.localeCompare(b.entryName),
      ),
    [entries],
  );

  /** Latest saved pick per entry for the selected week (supersessions win). */
  const savedByEntry = useMemo(() => {
    const m = new Map<string, GridCell>();
    for (const c of cells) {
      if (c.week !== week) continue;
      const prev = m.get(c.entryId);
      if (!prev || c.submittedAt > prev.submittedAt) m.set(c.entryId, c);
    }
    return m;
  }, [cells, week]);

  const entryById = useMemo(
    () => new Map(entries.map((e) => [e.id, e])),
    [entries],
  );

  const selectedWeek = weeks.find((w) => w.week === week) ?? null;
  const rel = selectedWeek ? relDeadline(selectedWeek.deadlineAt, Date.now()) : null;

  const stagedCount = Object.keys(staged).length;
  const dupeCount = useMemo(
    () =>
      Object.entries(staged).filter(([id, team]) => {
        if (team === SKIP_WEEK) return false;
        const e = entryById.get(id);
        return !!e && e.teamsUsed.includes(team);
      }).length,
    [staged, entryById],
  );

  function changeWeek(next: number) {
    setWeek(next);
    setStaged({});
    setFailures({});
    setSaveError(null);
    setSuccess(null);
  }

  function stagePick(entryId: string, value: string) {
    const savedTeam = savedByEntry.get(entryId)?.team ?? "";
    setStaged((prev) => {
      const next = { ...prev };
      // "" cannot be submitted (there is no clear-pick action) and a value
      // equal to the saved pick is not a change — both just unstage the row.
      if (value === "" || value === savedTeam) delete next[entryId];
      else next[entryId] = value;
      return next;
    });
    setFailures((prev) => {
      if (!(entryId in prev)) return prev;
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
    setSuccess(null);
  }

  function stageMany(picks: { entryId: string; team: string }[]) {
    for (const p of picks) stagePick(p.entryId, p.team);
  }

  const selectRefs = useRef<(HTMLSelectElement | null)[]>([]);

  function onSelectKeyDown(
    e: React.KeyboardEvent<HTMLSelectElement>,
    idx: number,
  ) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    selectRefs.current[idx + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
  }

  async function save() {
    const picks = Object.entries(staged).map(([entryId, team]) => ({
      entryId,
      team,
    }));
    if (picks.length === 0) return;
    setBusy(true);
    setSaveError(null);
    setSuccess(null);
    setFailures({});
    const res = await submitPicksBatchAction({ week, picks });
    setBusy(false);

    const failureLines = res.failures ?? [];
    if (!res.ok && failureLines.length === 0) {
      setSaveError(res.error ?? "Save failed");
      return;
    }

    const failMap: Record<string, string> = {};
    const unparsed: string[] = [];
    for (const f of failureLines) {
      const i = f.indexOf(": ");
      if (i > 0 && entryById.has(f.slice(0, i))) {
        failMap[f.slice(0, i)] = f.slice(i + 2);
      } else {
        unparsed.push(f);
      }
    }
    setFailures(failMap);

    const applied = res.applied ?? picks.length - failureLines.length;
    if (applied > 0) {
      setSuccess(
        `Saved ${applied} ${applied === 1 ? "pick" : "picks"} for week ${week}.`,
      );
    }
    if (failureLines.length > 0) {
      setSaveError(
        `${failureLines.length} ${failureLines.length === 1 ? "pick" : "picks"} failed` +
          (Object.keys(failMap).length > 0 ? " — see rows below." : ".") +
          (unparsed.length > 0 ? ` ${unparsed.join("; ")}` : ""),
      );
    }

    // Keep only the failed rows staged so a retry is one click.
    setStaged((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([id]) => id in failMap),
      ),
    );
    if (applied > 0) router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(week)} onValueChange={(v) => changeWeek(Number(v))}>
          <SelectTrigger size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {weeks.map((w) => (
              <SelectItem key={w.week} value={String(w.week)}>
                Week {w.week} — {formatDeadline(w.deadlineAt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <BulkPasteDialog entries={sorted} week={week} onStage={stageMany} />
        {selectedWeek && rel ? (
          <span
            className="text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            Deadline {formatDeadline(selectedWeek.deadlineAt)} ·{" "}
            <span className={rel.locked ? "text-tie" : undefined}>
              {rel.label}
              {rel.locked ? " — new picks will be flagged late" : ""}
            </span>
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Entry
              </th>
              <th className="hidden whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">
                Owner
              </th>
              <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Saved
              </th>
              <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Week {week} pick
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, idx) => {
              const savedCell = savedByEntry.get(e.id) ?? null;
              const savedTeam = savedCell?.team ?? "";
              const stagedTeam = staged[e.id];
              const isStaged = stagedTeam !== undefined;
              const value = stagedTeam ?? savedTeam;
              const usedWarn =
                isStaged &&
                stagedTeam !== SKIP_WEEK &&
                e.teamsUsed.includes(stagedTeam);
              const isOverride = isStaged && savedTeam !== "";
              const failure = failures[e.id];

              return (
                <tr
                  key={e.id}
                  className={cn(
                    "h-12 border-b border-border/60 transition-colors duration-150 ease-out last:border-0 sm:h-10",
                    e.status === "eliminated" && "opacity-55",
                    isStaged && (usedWarn ? "bg-tie/10" : "bg-primary/10"),
                  )}
                >
                  <td className="px-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusDot status={e.status} />
                      <span className="max-w-[10rem] truncate font-medium sm:max-w-[14rem]">
                        {e.entryName}
                      </span>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 text-muted-foreground sm:table-cell">
                    {e.ownerName}
                  </td>
                  <td className="whitespace-nowrap px-3">
                    {savedCell ? (
                      <Badge
                        variant="outline"
                        className="tabular-nums"
                        title={
                          savedCell.late ? "Submitted late" : undefined
                        }
                      >
                        {teamDisplay(savedCell.team)}
                        {savedCell.late ? (
                          <span className="text-tie">late</span>
                        ) : null}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1">
                    <div className="flex items-center gap-2">
                      <select
                        ref={(el) => {
                          selectRefs.current[idx] = el;
                        }}
                        value={value}
                        onChange={(ev) => stagePick(e.id, ev.target.value)}
                        onKeyDown={(ev) => onSelectKeyDown(ev, idx)}
                        aria-label={`Week ${week} pick for ${e.entryName}`}
                        className={cn(
                          "h-9 w-44 rounded-md border border-border bg-surface px-2 text-sm outline-none transition-colors duration-150 ease-out focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-56",
                          usedWarn && "border-tie text-tie",
                        )}
                      >
                        <option value="">— no pick —</option>
                        <option value={SKIP_WEEK}>BYE — skip week</option>
                        {NFL_TEAMS.map((t) => (
                          <option key={t.abbr} value={t.abbr}>
                            {t.abbr} — {t.name}
                            {e.teamsUsed.includes(t.abbr) ? " (used)" : ""}
                          </option>
                        ))}
                      </select>
                      {isOverride ? (
                        <Badge
                          variant="outline"
                          className="border-tie/50 text-tie"
                        >
                          override
                        </Badge>
                      ) : null}
                      {usedWarn ? (
                        <span className="hidden text-xs text-tie md:inline">
                          already used
                        </span>
                      ) : null}
                    </div>
                    {failure ? (
                      <p className="pb-1 text-xs text-loss">{failure}</p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  No entries yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="text-sm tabular-nums">
          {stagedCount} {stagedCount === 1 ? "pick" : "picks"} staged
        </span>
        {dupeCount > 0 ? (
          <span className="text-sm text-tie">
            {dupeCount} duplicate-team{" "}
            {dupeCount === 1 ? "warning" : "warnings"}
          </span>
        ) : null}
        {success ? <span className="text-sm text-win">{success}</span> : null}
        {saveError ? (
          <span className="text-sm text-loss">{saveError}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {stagedCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setStaged({});
                setFailures({});
                setSaveError(null);
              }}
            >
              Discard
            </Button>
          ) : null}
          <Button size="sm" disabled={busy || stagedCount === 0} onClick={save}>
            {busy
              ? "Saving…"
              : stagedCount > 0
                ? `Save ${stagedCount} ${stagedCount === 1 ? "pick" : "picks"}`
                : "Save picks"}
          </Button>
        </div>
      </div>
    </div>
  );
}
