"use client";

// THE ONE TABLE. The Grid and the Master List rendered the same rows with
// different chrome, so Anthony merged them on 2026-09-11 and this is what is
// left: her NO. and her NAMES as the first two columns, the week cells drawn
// the way the Grid drew them, defaulting to EVERYONE - her whole sheet, which
// is what the group wants when he sends the link - with our 121 one click
// away.
//
// What each half brought:
//   * from the Master List: NO. and Name as their own columns, her NAMES
//     verbatim, and our recorded pick sitting beside hers where the two
//     differ - reported, never resolved (CLAUDE.md, Who is the authority).
//   * from the Grid: the week cell as a team chip with its result colour, the
//     standing chips, the week range, the popover, the reveal gate.
//
// Every header sorts. Week columns are sized to their content so eighteen of
// them stay readable; the Name column absorbs the slack, which is why it is
// the only one with w-full.

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EntrySummary, GridCell, WeekRow } from "@/lib/data/types";
import { LOCKED_TEAM } from "@/lib/data/types";
import { RESULT_LABEL, SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { StatusDot } from "@/components/status-dot";
import { eliminationWeekOf } from "@/lib/alive";
import {
  bucketOfEntry,
  matchesStanding,
  matchTeams,
  standingCounts,
  STANDING_FILTERS,
  cellTimeLabel,
  tallyHeading,
  tallySentence,
  tallyWeekOf,
  type PoolBucket,
  type PoolIdentity,
  type StandingFilter,
} from "@/lib/master-list";
import { formatEtDateTime } from "@/lib/format";
import {
  nextSort,
  sameSortKey,
  sortRows,
  weekKeys,
  type SortDir,
  type SortKey,
} from "@/lib/grid-sort";
import {
  cellPaints,
  OUT_SWATCH_CLASS,
  ROW_CLASS,
  ROW_NAME_CLASS,
  rowTone,
  toneOfResult,
  TONE_CELL_CLASS,
  TONE_SWATCH_CLASS,
} from "@/lib/result-colour";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";

interface Props {
  /** This group's 121. */
  entries: EntrySummary[];
  weeks: WeekRow[];
  /** Our recorded picks, already masked by the reveal gate. */
  cells: GridCell[];
  /**
   * The master pool as rows of her sheet, already scored against our game
   * results by poolAsEntries(). Empty until a sheet is loaded, which is what
   * hides the scope toggle.
   */
  poolEntries: EntrySummary[];
  poolCells: GridCell[];
  /** Her NO. and NAMES by row id, from poolRowIdentity(). */
  identity: Map<string, PoolIdentity>;
  /** Her week cells that are not a team - OUT, a note - by row id and week. */
  herText: Map<string, Map<number, string>>;
  /** One line naming the sheet and any gap against her published total. */
  poolNote: string | null;
  /** Weeks every game of which has kicked off; a tally on any other week is a revealed subset and says so. */
  revealedWeeks: number[];
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
function RowName({
  entry,
  children,
}: {
  entry: EntrySummary;
  children: React.ReactNode;
}) {
  if (entry.id.startsWith("pool-")) {
    return <span className="flex min-w-0 items-center gap-2">{children}</span>;
  }
  return (
    <Link href={`/entry/${entry.id}`} className="flex min-w-0 items-center gap-2">
      {children}
    </Link>
  );
}

// A missed week is a loss like any other and takes the loss tone; the hatch
// is what still says "no pick was made" rather than a colour of its own.
const MISSED_EXTRA = "cell-hatched";

/** One row as the table needs it: identity, standing, and a cell per week. */
interface Row {
  entry: EntrySummary;
  no: number | null;
  name: string;
  /** Her published cell, or ours when the scope is ours. */
  teamByWeek: Map<number, string>;
  cellByWeek: Map<number, GridCell>;
  /** Our pick for the same week, only in Everyone scope and only for our rows. */
  oursByWeek: Map<number, string>;
  /** Her words where the cell is not a team: OUT, a note. */
  textByWeek: Map<number, string>;
}

export function GridView({
  entries,
  weeks,
  cells,
  poolEntries,
  poolCells,
  identity,
  herText,
  poolNote,
  revealedWeeks,
}: Props) {
  const poolLoaded = poolEntries.length > 0;
  // The whole pool is the front door when there is a sheet to show it from;
  // our group stands in until then (CLAUDE.md, Public surfaces).
  const [scope, setScope] = useState<Scope>(poolLoaded ? "everyone" : "ours");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState<string>("all");
  const [weekFrom, setWeekFrom] = useState(1);
  const [weekTo, setWeekTo] = useState(18);
  // Her numbering is the order the page opens on.
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "no", dir: "asc" });
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

  // Our own picks by entry and week, for the overlay in Everyone scope. A
  // locked cell is left out here as well as by matchTeams, so a pick cannot
  // reach the page through this map before its game.
  const oursByEntry = useMemo(() => {
    const m = new Map<string, Map<number, string>>();
    for (const c of cells) {
      if (c.team === LOCKED_TEAM) continue;
      if (!m.has(c.entryId)) m.set(c.entryId, new Map());
      m.get(c.entryId)!.set(c.week, c.team);
    }
    return m;
  }, [cells]);

  const cellsByEntry = useMemo(() => {
    const m = new Map<string, Map<number, GridCell>>();
    for (const c of activeCells) {
      if (!m.has(c.entryId)) m.set(c.entryId, new Map());
      m.get(c.entryId)!.set(c.week, c);
    }
    return m;
  }, [activeCells]);

  // The week each eliminated entry died - marks the killing pick.
  const elimWeekById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const e of activeEntries) {
      m.set(
        e.id,
        e.status === "eliminated"
          ? eliminationWeekOf([...(cellsByEntry.get(e.id)?.values() ?? [])])
          : null,
      );
    }
    return m;
  }, [cellsByEntry, activeEntries]);

  const bucketById = useMemo(() => {
    const m = new Map<string, PoolBucket>();
    for (const e of activeEntries) m.set(e.id, bucketOfEntry(e));
    return m;
  }, [activeEntries]);

  /** How many entries each chip would show, so the counts move with the scope. */
  const chipCounts = useMemo(() => standingCounts(activeEntries), [activeEntries]);

  const rows: Row[] = useMemo(
    () =>
      activeEntries.map((e) => {
        const id = identity.get(e.id);
        const cellByWeek = cellsByEntry.get(e.id) ?? new Map<number, GridCell>();
        // The overlay only exists where the two sources sit side by side.
        const oursByWeek = ours ? new Map<number, string>() : (oursByEntry.get(e.id) ?? new Map<number, string>());
        // THE SORT KEY IS WHAT THE CELL SHOWS - both sources, her cell
        // winning. weekKeys owns that rule and is tested on its own; building
        // it here from her cells alone is what made a chip reading "BUF /
        // ours" sort as a blank.
        const hers = new Map<number, string>();
        for (const [w, c] of cellByWeek) if (c.team !== LOCKED_TEAM) hers.set(w, c.team);
        const teamByWeek = weekKeys(hers, oursByWeek);
        return {
          entry: e,
          no: id?.no ?? null,
          // Her NAMES verbatim in Everyone; our own entry name in Our group.
          // Never normalised either way (CLAUDE.md, Names).
          name: ours ? e.entryName : (id?.names ?? e.entryName),
          teamByWeek,
          cellByWeek,
          oursByWeek,
          textByWeek: ours ? new Map() : (herText.get(e.id) ?? new Map()),
        };
      }),
    [activeEntries, cellsByEntry, identity, ours, oursByEntry, herText],
  );

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const kept = rows.filter((r) => {
      const bucket = bucketById.get(r.entry.id) ?? "Out";
      if (!matchesStanding(bucket, filter)) return false;
      if (ours && owner !== "all" && r.entry.ownerId !== owner) return false;
      if (q === "") return true;
      // One box finds a NO. or a name, the way her sheet reads.
      if (/^\d+$/.test(q)) return r.no !== null && String(r.no).startsWith(q);
      return (
        r.name.toLowerCase().includes(q) ||
        r.entry.ownerName.toLowerCase().includes(q)
      );
    });
    return sortRows(kept, sort.key, sort.dir);
  }, [rows, bucketById, filter, ours, owner, q, sort]);

  // The week's picks as a sentence, from whatever is in scope: the same
  // tally she sends by email, derived rather than typed.
  // The latest week with a countable pick, not the latest week with any
  // cell: a masked future pick arrives as LOCKED and would otherwise pull
  // the tally onto a week that then reads as empty.
  const tallyWeek = useMemo(() => tallyWeekOf(activeCells), [activeCells]);
  const tally = tallyWeek === null ? null : tallySentence(activeCells, tallyWeek, (t) => TEAM_NAME[t] ?? t);

  const visibleWeeks = weeks.filter((w) => w.week >= weekFrom && w.week <= weekTo);

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
    // Below the cell, or above it when there is no room below: on a phone a
    // cell in the bottom half used to open a panel off the end of the screen.
    const below = rect.bottom + 6;
    const y = below + 190 > window.innerHeight ? Math.max(8, rect.top - 196) : below;
    setPop((p) => (p && p.cell === cell ? null : { cell, entry, x, y }));
  }

  function onHeaderClick(key: SortKey) {
    setSort((s) => nextSort(s, key));
    setPop(null);
  }

  /** The arrow a sorted header carries, and nothing on the others. */
  function sortMark(key: SortKey): string {
    if (!sameSortKey(sort.key, key)) return "";
    return sort.dir === "asc" ? " ▲" : " ▼";
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (!sameSortKey(sort.key, key)) return "none";
    return sort.dir === "asc" ? "ascending" : "descending";
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
                  "flex h-10 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide transition-colors duration-150",
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
          // basis-full, not flex-1: sharing the first line with the scope
          // toggle left about 100px and a truncated placeholder.
          className="h-10 w-full basis-full rounded-lg border border-border bg-surface px-3 text-sm sm:w-64 sm:basis-auto"
        />

        {ours ? (
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger size="sm" className="h-10 w-[10.5rem]" aria-label="Filter by owner">
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
            <SelectTrigger size="sm" className="h-10 w-[4.75rem]" aria-label="Week range from">
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
            <SelectTrigger size="sm" className="h-10 w-[4.75rem]" aria-label="Week range to">
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
              "flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold tracking-wide transition-colors duration-150",
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

      {tally && tallyWeek !== null ? (
        <p className="text-xs text-muted-foreground">
          {tallyHeading(tallyWeek, revealedWeeks.includes(tallyWeek))} {tally}
        </p>
      ) : null}
      {!ours && poolNote ? (
        <p className="text-xs text-muted-foreground">{poolNote}</p>
      ) : null}
      {!ours ? (
        <p className="text-xs text-muted-foreground">
          Marked rows are this group&apos;s entries. Where we hold a pick the
          sheet has not published yet it reads &quot;ours&quot;; a pick that
          differs from the sheet is highlighted and reported, never changed.
        </p>
      ) : null}

      {/* The legend reads off the same map the cells do, so a swatch cannot
          drift from what it stands for. Yellow is every kind of loss - a tie
          and a missed week are losses in this pool - and red is reserved for
          the row that is finished. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:text-xs">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[2px]", TONE_SWATCH_CLASS.won)} /> Win
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[2px]", TONE_SWATCH_CLASS.lost)} /> Loss, tie or missed
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[2px]", TONE_SWATCH_CLASS.bye)} /> Bye
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[2px]", TONE_SWATCH_CLASS.none)} />{" "}
          No result yet
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[2px]", OUT_SWATCH_CLASS)} />{" "}
          <span className="line-through">Out</span>
        </span>
        <span className="flex items-center gap-1.5" title="A locked pick is not in the page data at all until its game starts">
          <span aria-hidden>🔒</span> Picks unlock when each game kicks off
        </span>
        <span className="ml-auto tabular-nums">
          {/* The scope's own total, not our 121: in Everyone this read
              "1,319 of 121 entries". */}
          {visible.length.toLocaleString("en-US")} of{" "}
          {rows.length.toLocaleString("en-US")} entries
        </span>
      </div>

      <div
        ref={scrollRef}
        className="relative max-h-[75dvh] overflow-auto rounded-lg border border-border"
        onScroll={() => setPop(null)}
      >
        {/* w-full with the slack on ONE column: the week columns size to their
            content (w-px plus padding is the shrink-to-fit idiom) so eighteen
            of them stay tight, and Name takes whatever is left. */}
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                aria-sort={ariaSort("no")}
                className="sticky left-0 top-0 z-40 w-10 border-b border-r border-border bg-surface-2 p-0 text-right text-xs font-medium text-muted-foreground"
              >
                <button
                  type="button"
                  onClick={() => onHeaderClick("no")}
                  className="flex h-10 w-full items-center justify-end whitespace-nowrap px-1.5 hover:text-foreground"
                  title="Sort by her NO."
                >
                  NO.{sortMark("no")}
                </button>
              </th>
              <th
                aria-sort={ariaSort("name")}
                // Pinned beside NO.: eighteen week columns are three phone
                // screens wide, and a row scrolled sideways with only its
                // number showing is unreadable on a sheet of 1,319.
                className="sticky left-10 top-0 z-30 w-full border-b border-r border-border bg-surface-2 p-0 text-left text-xs font-medium text-muted-foreground"
              >
                <button
                  type="button"
                  onClick={() => onHeaderClick("name")}
                  className="flex h-10 w-full items-center px-2 hover:text-foreground sm:px-3"
                  title="Sort by name"
                >
                  Name{sortMark("name")}
                </button>
              </th>
              {visibleWeeks.map((w) => (
                <th
                  key={w.week}
                  aria-sort={ariaSort({ week: w.week })}
                  className="sticky top-0 z-20 w-px border-b border-border bg-surface-2 p-0 text-center text-xs font-medium text-muted-foreground"
                >
                  <button
                    type="button"
                    onClick={() => onHeaderClick({ week: w.week })}
                    className="flex h-10 w-full items-center justify-center whitespace-nowrap px-1.5 hover:text-foreground"
                    title={`Sort by week ${w.week}`}
                  >
                    {w.week}
                    <span className="text-[9px] leading-none">{sortMark({ week: w.week })}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const e = r.entry;
              // Anthony, 2026-09-10: a loss is yellow and reaches the entry
              // name; two losses turn the WHOLE row red and strike it, and its
              // cells stop painting their own tone so the row reads as one
              // finished thing.
              const row = rowTone(e);
              const isOurs = !e.id.startsWith("pool-");
              return (
                <tr key={e.id} className={cn("group", !ours && isOurs && "bg-primary/5", ROW_CLASS[row])}>
                  <td className="sticky left-0 z-20 w-10 whitespace-nowrap border-b border-r border-border bg-surface px-2 text-right text-xs tabular-nums text-muted-foreground">
                    {r.no ?? "-"}
                  </td>
                  <td
                    className={cn(
                      "sticky left-10 z-10 h-11 w-full max-w-[11rem] border-b border-r border-border bg-surface px-2 sm:max-w-none sm:px-3",
                    )}
                  >
                    {/* A row of her sheet that is not one of ours has no entry
                        page of its own - poolAsEntries gives it a synthetic id -
                        so it renders as plain text rather than as a link to a
                        404. Rows that ARE ours carry their real id and link. */}
                    <RowName entry={e}>
                      <StatusDot status={e.status} className="shrink-0" />
                      {/* whitespace-pre, not truncate: `truncate` carries
                          whitespace-nowrap, which COLLAPSES her runs of
                          spaces - and her sheet has `Amy  3` with two and
                          `Adriana Flacco ` with a trailing one. Names are
                          stored verbatim and are shown verbatim (CLAUDE.md);
                          the overflow and the ellipsis are kept. */}
                      <span
                        className={cn(
                          "overflow-hidden text-ellipsis whitespace-pre font-medium",
                          ROW_NAME_CLASS[row],
                        )}
                      >
                        {r.name}
                      </span>
                      {!ours && isOurs ? (
                        <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          ours
                        </span>
                      ) : null}
                      {e.status === "eliminated" ? (
                        <span className="ml-auto shrink-0 rounded bg-loss/15 px-1 text-[10px] font-semibold text-loss">
                          OUT{elimWeekById.get(e.id) ? ` · WK ${elimWeekById.get(e.id)}` : ""}
                        </span>
                      ) : null}
                    </RowName>
                  </td>
                  {visibleWeeks.map((w) => {
                    const cell = r.cellByWeek.get(w.week);
                    const ourTeam = r.oursByWeek.get(w.week);
                    const herWords = r.textByWeek.get(w.week);
                    const m = matchTeams(cell?.team, ourTeam);

                    // HER WORDS, where the cell is not a team: an OUT, a note,
                    // one of her typos. Kept verbatim and never guessed at
                    // (CLAUDE.md), with no result colour because there is no
                    // team to have a result. Her OUT is authoritative and this
                    // is how a reader sees WHICH WEEK she declared a row out.
                    // Where we also hold a pick it sits beside her words - and
                    // it must NOT read as "she has published nothing", which
                    // is what the ours-only chip below says.
                    if (!cell && herWords !== undefined) {
                      return (
                        <td key={w.week} className="h-11 w-px border-b border-border/60 p-0.5 px-1.5 text-center">
                          <span
                            className="flex h-full min-h-10 w-full flex-col items-center justify-center whitespace-nowrap rounded-sm border border-border/60 bg-surface-2/60 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                            title={
                              ourTeam !== undefined
                                ? `Published: ${herWords}. Our record: ${ourTeam === SKIP_WEEK ? "Bye" : ourTeam}. Reported, not changed.`
                                : `Published: ${herWords}`
                            }
                          >
                            {herWords}
                            {ourTeam !== undefined ? (
                              <span className="text-[9px] font-normal normal-case opacity-80">
                                ours {ourTeam === SKIP_WEEK ? "Bye" : ourTeam}
                              </span>
                            ) : null}
                          </span>
                        </td>
                      );
                    }

                    // Nothing from either source: her blank week, or ours.
                    if (!cell && m.kind !== "ours") {
                      return (
                        <td key={w.week} className="h-11 w-px border-b border-border/60 px-1.5 text-center">
                          <span className="text-xs text-pending">·</span>
                        </td>
                      );
                    }
                    // We hold a revealed pick and her sheet has not published
                    // one. Her cell stays empty; ours sits in it, marked as
                    // ours, exactly as the Master List showed it.
                    if (!cell && m.kind === "ours") {
                      return (
                        <td key={w.week} className="h-11 w-px border-b border-border/60 p-0.5 px-1.5 text-center">
                          <span
                            className="flex h-full min-h-10 w-full flex-col items-center justify-center whitespace-nowrap rounded-sm border border-dashed border-border text-[10px] font-semibold text-muted-foreground"
                            title="Our recorded pick; not on the published sheet yet"
                          >
                            {m.ours === SKIP_WEEK ? "BYE" : m.ours}
                            <span className="text-[9px] font-normal uppercase tracking-wide">ours</span>
                          </span>
                        </td>
                      );
                    }
                    if (cell!.team === LOCKED_TEAM) {
                      return (
                        <td key={w.week} className="h-11 w-px border-b border-border/60 p-0.5 px-1.5 text-center">
                          <span
                            className="flex h-full min-h-10 w-full flex-col items-center justify-center whitespace-nowrap rounded-sm border border-border/60 bg-surface-2/60 text-[10px] font-semibold tracking-wide text-muted-foreground"
                            title="Pick locked - visible when this game kicks off"
                          >
                            <span aria-hidden>🔒</span>
                            LOCKED
                          </span>
                        </td>
                      );
                    }
                    const c = cell!;
                    const resultKey = c.result ?? "pending";
                    const isBye = c.team === SKIP_WEEK;
                    const killing =
                      e.status === "eliminated" &&
                      elimWeekById.get(e.id) === w.week &&
                      (resultKey === "loss" || resultKey === "tie_loss" || resultKey === "missed");
                    return (
                      <td
                        key={w.week}
                        onClick={(ev) => openPop(ev, c, e)}
                        className="h-11 w-px cursor-pointer border-b border-border/60 p-0.5 px-1.5 text-center"
                      >
                        <span
                          className={cn(
                            "flex h-full min-h-10 w-full flex-col items-center justify-center whitespace-nowrap rounded-sm border text-xs font-semibold transition-colors duration-150 ease-out",
                            cellPaints(row) && TONE_CELL_CLASS[isBye ? "bye" : toneOfResult(c.result)],
                            !cellPaints(row) && "border-loss/30",
                            resultKey === "missed" && MISSED_EXTRA,
                            killing && "bg-loss/40 text-white ring-1 ring-loss no-underline",
                          )}
                          title={killing ? "The killing pick - this loss ended the entry" : undefined}
                        >
                          {isBye ? "BYE" : killing ? `✕ ${c.team}` : c.team}
                          {/* Her published pick and ours disagree. Reported
                              with both values and never resolved: neither side
                              is corrected, neither is assumed wrong
                              (CLAUDE.md). Deliberately outside the result
                              vocabulary - neutral, so it stands out from
                              green, yellow and red alike. */}
                          {m.kind === "variance" ? (
                            <span
                              className="mt-0.5 rounded-sm bg-foreground/85 px-1 text-[10px] font-semibold leading-tight text-background no-underline"
                              title={`Published: ${m.hers}. Our record: ${m.ours === SKIP_WEEK ? "Bye" : m.ours}. Reported, not changed.`}
                            >
                              ours {m.ours === SKIP_WEEK ? "Bye" : m.ours}
                            </span>
                          ) : null}
                          {c.late ? <span className="sr-only">late</span> : null}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleWeeks.length + 2}
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
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Entry</dt>
                <dd className="max-w-[9.5rem] truncate">{pop.entry.entryName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Result</dt>
                <dd>
                  {pop.cell.result ? RESULT_LABEL[pop.cell.result] : "Pending"}
                  {pop.cell.resultSource ? ` · ${pop.cell.resultSource}` : null}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{cellTimeLabel(pop.cell)}</dt>
                <dd>
                  {formatEtDateTime(pop.cell.submittedAt)} ET
                  {pop.cell.late ? (
                    <span className="ml-1 font-medium text-tie">late</span>
                  ) : null}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
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
