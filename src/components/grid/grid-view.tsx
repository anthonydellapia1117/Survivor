"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type {
  EntrySummary,
  EntryStatus,
  GridCell,
  WeekRow,
} from "@/lib/data/types";
import {
  RESULT_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  SKIP_WEEK,
  TEAM_NAME,
} from "@/lib/standing";
import { StatusDot } from "@/components/status-dot";
import { eliminationWeekOf, matchesShowMode, showCounts } from "@/lib/alive";
import { ShowToggle, useShowMode } from "@/components/show-toggle";
import { formatEtDateTime } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import Link from "next/link";

interface Props {
  entries: EntrySummary[];
  weeks: WeekRow[];
  cells: GridCell[];
}

interface PopState {
  cell: GridCell;
  entry: EntrySummary;
  x: number;
  y: number;
}

const RESULT_CELL: Record<string, string> = {
  win: "bg-win/20 text-win border-win/40",
  loss: "bg-loss/20 text-loss border-loss/40",
  tie_loss: "bg-tie/20 text-tie border-tie/40",
  bye: "bg-bye/25 text-foreground/70 border-bye/40",
  pending: "bg-transparent text-muted-foreground border-border",
  missed: "text-loss border-loss/40 cell-hatched",
};

export function GridView({ entries, weeks, cells }: Props) {
  const [status, setStatus] = useState<"all" | EntryStatus>("all");
  const [owner, setOwner] = useState<string>("all");
  const [mode, setMode] = useShowMode();
  const [comfortable, setComfortable] = useState(false);
  const [weekFrom, setWeekFrom] = useState(1);
  const [weekTo, setWeekTo] = useState(18);
  const [pop, setPop] = useState<PopState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const owners = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) m.set(e.ownerId, e.ownerName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const cellMap = useMemo(() => {
    const m = new Map<string, GridCell>();
    for (const c of cells) m.set(`${c.entryId}:${c.week}`, c);
    return m;
  }, [cells]);

  // The week each eliminated entry died — marks the killing pick.
  const elimWeekById = useMemo(() => {
    const byEntry = new Map<string, GridCell[]>();
    for (const c of cells) {
      if (!byEntry.has(c.entryId)) byEntry.set(c.entryId, []);
      byEntry.get(c.entryId)!.push(c);
    }
    const m = new Map<string, number | null>();
    for (const e of entries) {
      m.set(e.id, e.status === "eliminated" ? eliminationWeekOf(byEntry.get(e.id) ?? []) : null);
    }
    return m;
  }, [cells, entries]);

  const counts = useMemo(() => showCounts(entries), [entries]);

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

  const visible = sorted.filter((e) => {
    if (!matchesShowMode(e.status, mode)) return false;
    if (status !== "all" && e.status !== status) return false;
    if (owner !== "all" && e.ownerId !== owner) return false;
    return true;
  });

  const visibleWeeks = weeks.filter(
    (w) => w.week >= weekFrom && w.week <= weekTo,
  );

  function openPop(
    ev: React.MouseEvent<HTMLTableCellElement>,
    cell: GridCell,
    entry: EntrySummary,
  ) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const panelW = 260;
    const x = Math.min(
      Math.max(8, rect.left + rect.width / 2 - panelW / 2),
      window.innerWidth - panelW - 8,
    );
    const y = rect.bottom + 6;
    setPop((p) =>
      p && p.cell === cell ? null : { cell, entry, x, y },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ShowToggle mode={mode} counts={counts} onChange={setMode} />
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as "all" | EntryStatus)}
        >
          <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABEL) as EntryStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger size="sm" className="w-[10.5rem]" aria-label="Filter by owner">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {owners.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5">
          <Select
            value={String(weekFrom)}
            onValueChange={(v) => {
              const n = Number(v);
              setWeekFrom(n);
              if (n > weekTo) setWeekTo(n);
            }}
          >
            <SelectTrigger size="sm" className="w-[4.75rem]" aria-label="Week range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weeks.map((w) => (
                <SelectItem key={w.week} value={String(w.week)}>
                  W{w.week}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">to</span>
          <Select
            value={String(weekTo)}
            onValueChange={(v) => {
              const n = Number(v);
              setWeekTo(n);
              if (n < weekFrom) setWeekFrom(n);
            }}
          >
            <SelectTrigger size="sm" className="w-[4.75rem]" aria-label="Week range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weeks.map((w) => (
                <SelectItem key={w.week} value={String(w.week)}>
                  W{w.week}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="comfortable"
            checked={comfortable}
            onCheckedChange={setComfortable}
          />
          <Label
            htmlFor="comfortable"
            className="text-sm text-muted-foreground"
          >
            Comfortable
          </Label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-win/70" /> Win
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-loss/70" /> Loss
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-tie/70" /> Tie-loss
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-bye/70" /> Bye
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] border border-border" />{" "}
          Pending
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] cell-hatched border border-loss/40" />{" "}
          Missed
        </span>
        <span className="flex items-center gap-1.5" title="A locked pick is not in the page data at all until its game starts">
          <span aria-hidden>🔒</span> Picks unlock when each game kicks off
        </span>
        <span className="ml-auto tabular-nums">
          {visible.length} of {entries.length} entries
        </span>
      </div>

      <div
        ref={scrollRef}
        className="relative max-h-[75dvh] overflow-auto rounded-lg border border-border"
        onScroll={() => setPop(null)}
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-[9.5rem] border-b border-r border-border bg-surface-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground sm:min-w-[12rem]">
                Entry
              </th>
              {visibleWeeks.map((w) => (
                <th
                  key={w.week}
                  className="sticky top-0 z-20 min-w-11 border-b border-border bg-surface-2 px-1 py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {w.week}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id} className="group">
                <td
                  className={cn(
                    "sticky left-0 z-10 max-w-[9.5rem] border-b border-r border-border bg-surface px-3 sm:max-w-[12rem]",
                    "h-11",
                    e.status === "eliminated" && "opacity-55",
                  )}
                >
                  <Link
                    href={`/entry/${e.id}`}
                    className="flex items-center gap-2"
                  >
                    <StatusDot status={e.status} className="shrink-0" />
                    <span className="truncate font-medium">{e.entryName}</span>
                    {e.status === "eliminated" ? (
                      <span className="ml-auto shrink-0 rounded bg-loss/15 px-1 text-[10px] font-semibold text-loss">
                        OUT{elimWeekById.get(e.id) ? ` · WK ${elimWeekById.get(e.id)}` : ""}
                      </span>
                    ) : null}
                  </Link>
                </td>
                {visibleWeeks.map((w) => {
                  const cell = cellMap.get(`${e.id}:${w.week}`);
                  if (!cell) {
                    return (
                      <td
                        key={w.week}
                        className="h-11 min-w-11 border-b border-border/60 text-center"
                      >
                        <span className="text-xs text-pending">·</span>
                      </td>
                    );
                  }
                  if (cell.team === "LOCKED") {
                    return (
                      <td
                        key={w.week}
                        className="h-11 min-w-11 border-b border-border/60 p-0.5 text-center"
                      >
                        <span
                          className="flex h-full min-h-10 w-full flex-col items-center justify-center rounded-sm border border-border/60 bg-surface-2/60 text-[10px] font-semibold tracking-wide text-muted-foreground"
                          title="Pick locked — visible when this game kicks off"
                        >
                          <span aria-hidden>🔒</span>
                          LOCKED
                        </span>
                      </td>
                    );
                  }
                  const resultKey = cell.result ?? "pending";
                  const isBye = cell.team === SKIP_WEEK;
                  const killing =
                    e.status === "eliminated" &&
                    elimWeekById.get(e.id) === w.week &&
                    (resultKey === "loss" || resultKey === "tie_loss" || resultKey === "missed");
                  return (
                    <td
                      key={w.week}
                      onClick={(ev) => openPop(ev, cell, e)}
                      className={cn(
                        "h-11 min-w-11 cursor-pointer border-b border-border/60 p-0.5 text-center",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-full min-h-10 w-full flex-col items-center justify-center rounded-sm border text-xs font-semibold transition-colors duration-150 ease-out",
                          RESULT_CELL[isBye ? "bye" : resultKey],
                          killing && "bg-loss/40 text-white ring-1 ring-loss",
                        )}
                        title={killing ? "The killing pick — this loss ended the entry" : undefined}
                      >
                        {isBye ? "BYE" : killing ? `✕ ${cell.team}` : cell.team}
                        {comfortable && !isBye ? (
                          <span className="mt-0.5 block h-1 w-6 rounded-full bg-current opacity-40" />
                        ) : null}
                        {cell.late ? (
                          <span className="sr-only">late</span>
                        ) : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleWeeks.length + 1}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  No entries match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pop ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPop(null)} />
          <div
            className="fixed z-50 w-[260px] rounded-md border border-border bg-popover p-3 text-sm shadow-lg"
            style={{ left: pop.x, top: pop.y }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">
                {pop.cell.team === SKIP_WEEK
                  ? "Bye (skip week)"
                  : (TEAM_NAME[pop.cell.team] ?? pop.cell.team)}
              </span>
              <span className="text-xs text-muted-foreground">
                Week {pop.cell.week}
              </span>
            </div>
            <dl className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Entry</dt>
                <dd className="max-w-[9.5rem] truncate">
                  {pop.entry.entryName}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Result</dt>
                <dd>
                  {pop.cell.result ? RESULT_LABEL[pop.cell.result] : "Pending"}
                  {pop.cell.resultSource
                    ? ` · ${pop.cell.resultSource}`
                    : null}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Submitted</dt>
                <dd>
                  {formatEtDateTime(pop.cell.submittedAt)} ET
                  {pop.cell.late ? (
                    <span className="ml-1 font-medium text-tie">late</span>
                  ) : null}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Source</dt>
                <dd>{pop.cell.source.replace("_", " ")}</dd>
              </div>
            </dl>
          </div>
        </>
      ) : null}
    </div>
  );
}
