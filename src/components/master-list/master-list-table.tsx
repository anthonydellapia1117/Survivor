"use client";

// The Master List table: every row of the master pool's newest sheet, her
// NO. and NAMES verbatim, her week cells as published, searchable by NO. or
// name. Our group's rows are marked, and where we hold a revealed pick for
// one of them it sits beside her cell: a pick she has not published reads
// "ours XXX", a pick that differs from hers is highlighted and reported,
// never changed. Everyone is the default view: the group wants the whole
// pool, and the 121 are the admin's concern.

import { useMemo, useState } from "react";
import type { MasterListRow } from "@/lib/data/types";
import {
  filterRows,
  herCell,
  matchPick,
  type PickMatch,
  type WeekColumn,
} from "@/lib/master-list";
import { SKIP_WEEK } from "@/lib/standing";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface OurCell {
  entryId: string;
  week: number;
  team: string;
}

interface Props {
  rows: MasterListRow[];
  columns: WeekColumn[];
  ourCells: OurCell[];
  ourCount: number;
}

function teamLabel(team: string): string {
  return team === SKIP_WEEK ? "Bye" : team;
}

function CellView({ cell, m }: { cell: string | undefined; m: PickMatch }) {
  switch (m.kind) {
    case "none":
      return null;
    case "hers":
    case "match":
      return <>{cell}</>;
    case "ours":
      return (
        <span className="text-muted-foreground" title="Our recorded pick; not on the published sheet yet">
          ours {teamLabel(m.ours)}
        </span>
      );
    case "variance":
      return (
        <>
          <span>{cell}</span>
          <span
            className="ml-1.5 rounded-sm bg-tie/20 px-1 py-0.5 text-[10px] font-semibold text-tie"
            title={`Published: ${cell}. Our record: ${teamLabel(m.ours)}. Reported, not changed.`}
          >
            ours {teamLabel(m.ours)}
          </span>
        </>
      );
    case "text":
      return (
        <>
          <span>{cell}</span>
          <span className="ml-1.5 text-[10px] text-muted-foreground">ours {teamLabel(m.ours)}</span>
        </>
      );
  }
}

export function MasterListTable({ rows, columns, ourCells, ourCount }: Props) {
  const [query, setQuery] = useState("");
  const [oursOnly, setOursOnly] = useState(false);

  const ourByEntry = useMemo(() => {
    const m = new Map<string, Map<number, OurCell>>();
    for (const c of ourCells) {
      if (!m.has(c.entryId)) m.set(c.entryId, new Map());
      m.get(c.entryId)!.set(c.week, c);
    }
    return m;
  }, [ourCells]);

  const shown = useMemo(() => filterRows(rows, query, oursOnly), [rows, query, oursOnly]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a NO. or a name"
          aria-label="Find an entry by NO. or name"
          className="w-64"
        />
        <div
          role="radiogroup"
          aria-label="Everyone or our group"
          className="inline-flex rounded-lg border border-border bg-surface p-0.5"
        >
          {(
            [
              { key: false, label: "Everyone", n: rows.length },
              { key: true, label: "Our group", n: ourCount },
            ] as const
          ).map((opt) => (
            <button
              key={String(opt.key)}
              type="button"
              role="radio"
              aria-checked={oursOnly === opt.key}
              onClick={() => setOursOnly(opt.key)}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide transition-colors duration-150",
                oursOnly === opt.key ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
              <span className="tabular-nums opacity-70">{opt.n.toLocaleString("en-US")}</span>
            </button>
          ))}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          Showing {shown.length.toLocaleString("en-US")} of {rows.length.toLocaleString("en-US")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Marked rows are this group&apos;s entries. Where we hold a pick the sheet
        has not published yet it reads &quot;ours&quot;; a pick that differs from
        the sheet is highlighted and reported, never changed.
      </p>

      <div className="max-h-[75dvh] overflow-auto rounded-lg border border-border">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-r border-border bg-surface-2 px-2 py-1.5 text-right font-medium text-muted-foreground">
                NO.
              </th>
              <th className="sticky top-0 z-20 border-b border-border bg-surface-2 px-2 py-1.5 text-left font-medium text-muted-foreground">
                NAMES
              </th>
              {columns.map((c) => (
                <th
                  key={c.week}
                  className="sticky top-0 z-20 min-w-24 border-b border-border bg-surface-2 px-2 py-1.5 text-left font-medium text-muted-foreground"
                >
                  {c.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const ours = r.entryId ? ourByEntry.get(r.entryId) : undefined;
              const isOurs = r.entryId !== null;
              return (
                <tr key={r.no} className={cn(isOurs && "bg-primary/5")}>
                  <td className="sticky left-0 z-10 border-b border-r border-border/60 bg-surface px-2 py-1 text-right tabular-nums">
                    {r.no}
                  </td>
                  <td className={cn("border-b border-border/60 px-2 py-1 whitespace-pre", isOurs && "font-medium")}>
                    {r.names}
                    {isOurs ? (
                      <span className="ml-2 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        ours
                      </span>
                    ) : null}
                  </td>
                  {columns.map((col) => {
                    const cell = herCell(r, col);
                    const m = matchPick(cell, ours?.get(col.week));
                    return (
                      <td key={col.week} className="border-b border-border/60 px-2 py-1 whitespace-nowrap">
                        <CellView cell={cell} m={m} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={2 + columns.length} className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Nothing matches.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
