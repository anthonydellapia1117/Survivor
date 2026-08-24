"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import type { EntrySummary, EntryStatus } from "@/lib/data/types";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/standing";
import { matchesShowMode, showCounts } from "@/lib/alive";
import { ShowToggle, useShowMode } from "@/components/show-toggle";
import { StatusDot } from "@/components/status-dot";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

interface Row extends EntrySummary {
  currentPick: string | null;
  weeksSurvived: number;
  elimWeek: number | null;
}

const col = createColumnHelper<Row>();

export function EntriesTable({ rows }: { rows: Row[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | EntryStatus>("all");
  const [mode, setMode] = useShowMode();
  const counts = useMemo(() => showCounts(rows), [rows]);

  const columns = useMemo(
    () => [
      col.accessor("entryName", {
        header: "Entry",
        cell: (info) => (
          <Link
            href={`/entry/${info.row.original.id}`}
            className="flex items-center gap-2 font-medium hover:text-primary"
          >
            <StatusDot status={info.row.original.status} />
            <span className="truncate">{info.getValue()}</span>
          </Link>
        ),
      }),
      col.accessor("ownerName", {
        header: "Owner",
        cell: (info) => (
          <span className="text-muted-foreground">{info.getValue()}</span>
        ),
      }),
      col.accessor("status", {
        header: "Status",
        cell: (info) =>
          info.getValue() === "eliminated" ? (
            <span className="rounded-full bg-loss/15 px-2 py-0.5 text-xs font-semibold text-loss">
              OUT{info.row.original.elimWeek ? ` · WK ${info.row.original.elimWeek}` : ""}
            </span>
          ) : (
            STATUS_LABEL[info.getValue()]
          ),
        sortingFn: (a, b) =>
          STATUS_ORDER[a.original.status] - STATUS_ORDER[b.original.status],
      }),
      col.accessor("livesRemaining", {
        header: "Lives",
        cell: (info) => (
          <span className="tabular-nums">{info.getValue()}</span>
        ),
      }),
      col.accessor("weeksSurvived", {
        header: "Weeks",
        cell: (info) => (
          <span className="tabular-nums">{info.getValue()}</span>
        ),
      }),
      col.accessor("currentPick", {
        header: "Current pick",
        cell: (info) => info.getValue() ?? "—",
      }),
      col.accessor((r) => r.teamsUsed.length, {
        id: "teamsUsed",
        header: "Teams used",
        cell: (info) => (
          <span className="tabular-nums">{info.getValue()}</span>
        ),
      }),
    ],
    [],
  );

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => matchesShowMode(r.status, mode))
        .filter((r) => status === "all" || r.status === status),
    [rows, status, mode],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _id, value) => {
      const q = String(value).toLowerCase();
      return (
        row.original.entryName.toLowerCase().includes(q) ||
        row.original.ownerName.toLowerCase().includes(q)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <ShowToggle mode={mode} counts={counts} onChange={setMode} />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entries or owners…"
          className="h-8 w-full sm:w-64"
        />
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as "all" | EntryStatus)}
        >
          <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Filter by status">
            <SelectValue />
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
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {table.getRowModel().rows.length} entries
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                  >
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : h.column.getIsSorted() === "desc" ? (
                        <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "h-12 border-b border-border/60 transition-colors duration-150 ease-out last:border-0 hover:bg-surface-2/60 sm:h-10",
                  row.original.status === "eliminated" && "opacity-55",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="whitespace-nowrap px-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
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
