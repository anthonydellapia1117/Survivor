"use client";

// The audit trail, made legible. Every write this app has ever made is in
// audit_log, but until now nothing displayed it — including reconciliation
// notes a future payment sweep is supposed to check before re-flagging a
// transaction. Read-only by construction: this component renders, it never
// calls a mutation.
//
// Payloads are shown as a DIFF (see @/lib/audit-format): update_* rows carry
// the entire record twice, so "what changed" is the only readable framing.
// A raw-JSON toggle sits on every row so nothing is actually hidden.

import { Fragment, useMemo, useState } from "react";
import type { AuditRow } from "@/lib/data/admin-types";
import {
  actionLabel,
  auditSearchText,
  diffPayloads,
  summarizeChanges,
} from "@/lib/audit-format";
import { formatEtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

type SortKey = "at" | "action" | "actor" | "target";

const SORT_HEADERS: {
  label: string;
  key: SortKey | null;
  className?: string;
}[] = [
  { label: "", key: null, className: "w-6" },
  { label: "Time", key: "at", className: "w-40" },
  { label: "Action", key: "action", className: "w-52" },
  { label: "Target", key: "target", className: "w-40" },
  { label: "What changed", key: null },
  { label: "Actor", key: "actor", className: "w-44" },
];

const ALL = "__all__";

/** Local YYYY-MM-DD for a row, so the date filters compare like-for-like. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function AuditClient({ rows }: { rows: AuditRow[] }) {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [raw, setRaw] = useState<Set<number>>(new Set());

  // Action list with counts, so the filter shows how much is behind each one.
  const actionOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: actionLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // Precompute the derived view once per row: diff, summary, search haystack.
  const prepared = useMemo(
    () =>
      rows.map((r) => {
        const changes = diffPayloads(r.before, r.after);
        return {
          row: r,
          changes,
          summary: summarizeChanges(changes),
          haystack: auditSearchText(r),
          day: dayKey(r.at),
        };
      }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prepared.filter((p) => {
      if (action !== ALL && p.row.action !== action) return false;
      if (from && p.day < from) return false;
      if (to && p.day > to) return false;
      if (q !== "" && !p.haystack.includes(q)) return false;
      return true;
    });
  }, [prepared, search, action, from, to]);

  const sorted = useMemo(() => {
    // Default is newest first — the order the log is actually read in.
    if (sortKey === null) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    const target = (r: AuditRow) =>
      `${r.targetTable} ${r.targetId ?? ""}`.trim();
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "at":
          return (
            dir * (new Date(a.row.at).getTime() - new Date(b.row.at).getTime())
          );
        case "action":
          return (
            dir *
            actionLabel(a.row.action).localeCompare(actionLabel(b.row.action))
          );
        case "actor":
          return dir * a.row.actor.localeCompare(b.row.actor);
        case "target":
          return dir * target(a.row).localeCompare(target(b.row));
      }
    });
  }, [filtered, sortKey, sortDir]);

  function clickSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
    }
  }

  function toggle(
    set: Set<number>,
    setter: (s: Set<number>) => void,
    id: number,
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  const filtersActive =
    search.trim() !== "" || action !== ALL || from !== "" || to !== "";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="audit-search">Search</Label>
          <Input
            id="audit-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name, note, value, txn id…"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-action">Action</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger id="audit-action" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actions ({rows.length})</SelectItem>
              {actionOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label} ({o.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-from">From</Label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-to">To</Label>
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {sorted.length} of {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>
        {filtersActive ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setAction(ALL);
              setFrom("");
              setTo("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          Read-only. Newest first until you sort.
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              {SORT_HEADERS.map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    "whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground",
                    h.className,
                  )}
                >
                  {h.key ? (
                    <button
                      type="button"
                      onClick={() => clickSort(h.key!)}
                      className="transition-colors duration-150 hover:text-foreground"
                    >
                      {h.label}
                      {sortKey === h.key
                        ? sortDir === "asc"
                          ? " ▲"
                          : " ▼"
                        : null}
                    </button>
                  ) : (
                    h.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, changes, summary }) => {
              const isOpen = open.has(row.id);
              const showRaw = raw.has(row.id);
              const hasDetail =
                changes.length > 0 ||
                row.note !== null ||
                row.targetId !== null;
              return (
                <Fragment key={row.id}>
                  <tr
                    className={cn(
                      "border-b border-border/60 align-top",
                      hasDetail && "cursor-pointer hover:bg-surface-2/50",
                      isOpen && "bg-surface-2/40",
                    )}
                    onClick={() => hasDetail && toggle(open, setOpen, row.id)}
                  >
                    <td className="px-3 py-2">
                      {hasDetail ? (
                        <ChevronRight
                          className={cn(
                            "size-3.5 text-muted-foreground transition-transform duration-150",
                            isOpen && "rotate-90",
                          )}
                        />
                      ) : null}
                    </td>
                    <td
                      className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {formatEtDateTime(row.at)}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {actionLabel(row.action)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.targetTable}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {summary ? (
                        <span className="line-clamp-2">{summary}</span>
                      ) : row.note ? (
                        <span className="line-clamp-2 text-muted-foreground">
                          {row.note}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="truncate px-3 py-2 text-xs text-muted-foreground">
                      {row.actor}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr
                      key={`${row.id}-detail`}
                      className="border-b border-border/60 bg-surface-2/20"
                    >
                      <td />
                      <td colSpan={5} className="px-3 pb-4 pt-1">
                        <div className="space-y-3">
                          {row.note ? (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">
                                Note
                              </p>
                              <p className="mt-0.5 whitespace-pre-wrap text-sm">
                                {row.note}
                              </p>
                            </div>
                          ) : null}

                          {changes.length > 0 ? (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">
                                {row.before && row.after
                                  ? "Changed fields"
                                  : row.after
                                    ? "Recorded"
                                    : "Removed"}
                              </p>
                              <dl className="mt-1 space-y-1">
                                {changes.map((c) => (
                                  <div
                                    key={c.key}
                                    className="flex flex-wrap items-baseline gap-x-2 text-sm"
                                  >
                                    <dt className="min-w-36 text-muted-foreground">
                                      {c.label}
                                    </dt>
                                    <dd className="flex flex-wrap items-baseline gap-x-2">
                                      {c.kind === "changed" ? (
                                        <>
                                          <span className="text-loss line-through decoration-loss/40">
                                            {c.from}
                                          </span>
                                          <span className="text-muted-foreground">
                                            →
                                          </span>
                                          <span className="font-medium text-win">
                                            {c.to}
                                          </span>
                                        </>
                                      ) : c.kind === "set" ? (
                                        <span className="font-medium">
                                          {c.to}
                                        </span>
                                      ) : (
                                        <span className="text-loss line-through decoration-loss/40">
                                          {c.from}
                                        </span>
                                      )}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>
                              Row #{row.id} · {row.action}
                            </span>
                            {row.targetId ? (
                              <span className="font-mono">{row.targetId}</span>
                            ) : null}
                            {row.before || row.after ? (
                              <button
                                type="button"
                                className="font-medium text-primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggle(raw, setRaw, row.id);
                                }}
                              >
                                {showRaw ? "Hide raw JSON" : "Show raw JSON"}
                              </button>
                            ) : null}
                          </div>

                          {showRaw ? (
                            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed">
                              {JSON.stringify(
                                { before: row.before, after: row.after },
                                null,
                                2,
                              )}
                            </pre>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-10 text-center text-sm text-muted-foreground"
                >
                  No audit rows match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
