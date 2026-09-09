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
import { eliminationWeekOf } from "@/lib/alive";
import {
  bucketOfEntry,
  matchesStanding,
  standingCounts,
  STANDING_FILTERS,
  tallySentence,
  type PoolBucket,
  type StandingFilter,
} from "@/lib/master-list";
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
  /** This group's 121. */
  entries: EntrySummary[];
  weeks: WeekRow[];
  cells: GridCell[];
  /**
   * The master pool as rows of her sheet, already scored against our game
   * results by poolAsEntries(). Empty until a sheet is loaded, which is what
   * hides the scope toggle.
   */
  poolEntries: EntrySummary[];
  poolCells: GridCell[];
  /** One line naming the sheet and any gap against her published total. */
  poolNote: string | null;
}

/** Everyone is her whole sheet; Our group is the 121 Anthony manages. */
type Scope = "everyone" | "ours";

/**
 * The chips. "Alive" is No Losses plus 1 Loss/Bye - it answers "who is still
 * in", which is a different question from "who is still clean", and both are
 * asked week to week. Her wording throughout: the middle bucket is
 * "1 Loss/Bye" because a burned bye lands there without a loss.
 */
type Filter = StandingFilter;
const FILTERS = STANDING_FILTERS;
const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  alive: "Alive",
  "No Losses": "No Losses",
  "1 Loss/Bye": "1 Loss/Bye",
  Out: "Out",
};

interface PopState {
  cell: GridCell;
  entry: EntrySummary;
  x: number;
  y: number;
}

/** Her rows have no entry page; ours do. Same markup either way. */
function PoolRowName({
  entry,
  children,
}: {
  entry: EntrySummary;
  children: React.ReactNode;
}) {
  if (entry.id.startsWith("pool-")) {
    return <span className="flex items-center gap-2">{children}</span>;
  }
  return (
    <Link href={`/entry/${entry.id}`} className="flex items-center gap-2">
      {children}
    </Link>
  );
}

const RESULT_CELL: Record<string, string> = {
  win: "bg-win/20 text-win border-win/40",
  loss: "bg-loss/20 text-loss border-loss/40",
  tie_loss: "bg-tie/20 text-tie border-tie/40",
  bye: "bg-bye/25 text-foreground/70 border-bye/40",
  pending: "bg-transparent text-muted-foreground border-border",
  missed: "text-loss border-loss/40 cell-hatched",
};

export function GridView({
  entries,
  weeks,
  cells,
  poolEntries,
  poolCells,
  poolNote,
}: Props) {
  const poolLoaded = poolEntries.length > 0;
  // The whole pool is the front door when there is a sheet to show it from;
  // our group stands in until then (CLAUDE.md, Public surfaces).
  const [scope, setScope] = useState<Scope>(poolLoaded ? "everyone" : "ours");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState<string>("all");
  const [comfortable, setComfortable] = useState(false);
  const [weekFrom, setWeekFrom] = useState(1);
  const [weekTo, setWeekTo] = useState(18);
  const [pop, setPop] = useState<PopState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ours = scope === "ours" || !poolLoaded;
  const activeEntries = ours ? entries : poolEntries;
  const activeCells = ours ? cells : poolCells;

  // Owners only mean something for our group: her sheet carries no owner, so
  // the filter is hidden rather than shown listing nothing.
  const owners = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) m.set(e.ownerId, e.ownerName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const cellMap = useMemo(() => {
    const m = new Map<string, GridCell>();
    for (const c of activeCells) m.set(`${c.entryId}:${c.week}`, c);
    return m;
  }, [activeCells]);

  // The week each eliminated entry died - marks the killing pick.
  const elimWeekById = useMemo(() => {
    const byEntry = new Map<string, GridCell[]>();
    for (const c of activeCells) {
      if (!byEntry.has(c.entryId)) byEntry.set(c.entryId, []);
      byEntry.get(c.entryId)!.push(c);
    }
    const m = new Map<string, number | null>();
    for (const e of activeEntries) {
      m.set(e.id, e.status === "eliminated" ? eliminationWeekOf(byEntry.get(e.id) ?? []) : null);
    }
    return m;
  }, [activeCells, activeEntries]);

  const bucketById = useMemo(() => {
    const m = new Map<string, PoolBucket>();
    for (const e of activeEntries) m.set(e.id, bucketOfEntry(e));
    return m;
  }, [activeEntries]);

  /** How many entries each chip would show, so the counts move with the scope. */
  const chipCounts = useMemo(() => standingCounts(activeEntries), [activeEntries]);

  const sorted = useMemo(
    () =>
      [...activeEntries].sort(
        (a, b) =>
          Number(b.isAdminEntry) - Number(a.isAdminEntry) ||
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.ownerName.localeCompare(b.ownerName) ||
          a.entryName.localeCompare(b.entryName),
      ),
    [activeEntries],
  );

  const q = query.trim().toLowerCase();
  const visible = sorted.filter((e) => {
    const bucket = bucketById.get(e.id) ?? "Out";
    if (!matchesStanding(bucket, filter)) return false;
    if (ours && owner !== "all" && e.ownerId !== owner) return false;
    // Her rows read "NO. NAMES", so one box finds a number or a name in
    // either scope without a second control.
    if (q !== "" && !e.entryName.toLowerCase().includes(q) && !e.ownerName.toLowerCase().includes(q)) return false;
    return true;
  });

  // The week's picks as a sentence, from whatever is in scope: the same
  // tally she sends by email, derived rather than typed.
  const tallyWeek = useMemo(() => {
    let latest: number | null = null;
    for (const c of activeCells) if (latest === null || c.week > latest) latest = c.week;
    return latest;
  }, [activeCells]);
  const tally = tallyWeek === null ? null : tallySentence(activeCells, tallyWeek, (t) => TEAM_NAME[t] ?? t);

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
        {poolLoaded ? (
          <div
            role="radiogroup"
            aria-label="Everyone or our group"
            className="inline-flex rounded-lg border border-border bg-surface p-0.5"
          >
            {(
              [
                { key: "everyone", label: "Everyone", n: poolEntries.length },
                { key: "ours", label: "Our group", n: entries.length },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={scope === opt.key}
                onClick={() => {
                  setScope(opt.key);
                  // Her sheet has no owners, so a filter set in our scope
                  // must not silently narrow the whole pool to nothing.
                  if (opt.key === "everyone") setOwner("all");
                }}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide transition-colors duration-150",
                  scope === opt.key
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
                <span className="tabular-nums opacity-70">
                  {opt.n.toLocaleString("en-US")}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a NO. or a name"
          aria-label="Find an entry by NO. or name"
          className="h-9 w-64 rounded-lg border border-border bg-surface px-3 text-sm"
        />

        {ours ? (
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
        ) : null}

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

      <div
        role="radiogroup"
        aria-label="Filter by standing"
        className="flex flex-wrap items-center gap-1.5"
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold tracking-wide transition-colors duration-150",
              filter === f
                ? "border-transparent bg-surface-2 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {FILTER_LABEL[f]}
            <span className="tabular-nums opacity-70">
              {chipCounts[f].toLocaleString("en-US")}
            </span>
          </button>
        ))}
      </div>

      {tally ? (
        <p className="text-xs text-muted-foreground">
          Week {tallyWeek}: {tally}
        </p>
      ) : null}
      {!ours && poolNote ? (
        <p className="text-xs text-muted-foreground">{poolNote}</p>
      ) : null}

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
          {/* The scope's own total, not our 121: in Everyone this read
              "1,319 of 121 entries". */}
          {visible.length.toLocaleString("en-US")} of{" "}
          {sorted.length.toLocaleString("en-US")} entries
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
                  {/* A row of her sheet that is not one of ours has no entry
                      page of its own - poolAsEntries gives it a synthetic id -
                      so it renders as plain text rather than as a link to a
                      404. Rows that ARE ours carry their real id and link. */}
                  <PoolRowName entry={e}>
                    <StatusDot status={e.status} className="shrink-0" />
                    <span className="truncate font-medium">{e.entryName}</span>
                    {e.status === "eliminated" ? (
                      <span className="ml-auto shrink-0 rounded bg-loss/15 px-1 text-[10px] font-semibold text-loss">
                        OUT{elimWeekById.get(e.id) ? ` · WK ${elimWeekById.get(e.id)}` : ""}
                      </span>
                    ) : null}
                  </PoolRowName>
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
                          title="Pick locked - visible when this game kicks off"
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
                        title={killing ? "The killing pick - this loss ended the entry" : undefined}
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
