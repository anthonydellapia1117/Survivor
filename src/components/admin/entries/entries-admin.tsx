"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminEntry, AdminOwner } from "@/lib/data/admin-types";
import { removeEntryAction, voidEntryAction } from "@/app/admin/actions";
import { collisionGroups, KIND_LABEL } from "@/lib/names";
import type { ExistingName } from "@/components/admin/name-warning";
import { EntryEditDialog } from "@/components/admin/entries/entry-edit-dialog";
import { BulkAddDialog } from "@/components/admin/entries/bulk-add-dialog";
import { NumbersImportDialog } from "@/components/admin/entries/numbers-import-dialog";
import { RosterExportDialog } from "@/components/admin/entries/roster-export-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Filter = "all" | "free" | "default" | "voided";
type SortKey = "owner" | "entry" | "no";

const SORT_HEADERS: { label: string; key: SortKey | null }[] = [
  { label: "Owner", key: "owner" },
  { label: "Entry", key: "entry" },
  { label: "NO.", key: "no" },
  { label: "Lynne label", key: null },
  { label: "", key: null },
  { label: "Picks", key: null },
  { label: "", key: null },
];

export function EntriesAdmin({
  entries,
  owners,
}: {
  entries: AdminEntry[];
  owners: AdminOwner[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // Default order (admin entries first, then owner/entry index) until a
  // header is clicked; clicking cycles asc -> desc -> back to default.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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

  // Live (non-voided) names, for creation warnings and the collision audit.
  const live = useMemo(() => entries.filter((e) => !e.voidedAt), [entries]);
  const existingNames = useMemo<ExistingName[]>(
    () => live.map((e) => ({ name: e.entryName, owner: e.ownerName })),
    [live],
  );
  const ownerByName = useMemo(
    () => new Map(live.map((e) => [e.entryName, e.ownerName])),
    [live],
  );
  const nearCollisions = useMemo(
    () =>
      collisionGroups(
        live.map((e) => e.entryName),
        live.map((e) => e.ownerName),
      ),
    [live],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter((e) => {
      if (filter === "free" && !e.isFreeEntry) return false;
      if (filter === "default" && !e.nameIsDefault) return false;
      if (filter === "voided" && !e.voidedAt) return false;
      if (
        q !== "" &&
        !e.entryName.toLowerCase().includes(q) &&
        !e.ownerName.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [entries, search, filter]);

  const sorted = useMemo(() => {
    if (sortKey === null) return filtered; // backend default: admin first
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "owner":
          return dir * (a.ownerName.localeCompare(b.ownerName) || a.entryIndex - b.entryIndex);
        case "entry":
          return dir * a.entryName.localeCompare(b.entryName);
        case "no":
          return (
            dir *
            ((a.lynneNumber ?? Number.MAX_SAFE_INTEGER) -
              (b.lynneNumber ?? Number.MAX_SAFE_INTEGER))
          );
      }
    });
  }, [filtered, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entries or owners…"
          className="h-8 w-full sm:w-64"
        />
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger size="sm" className="w-[10.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entries</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="default">Default-named</SelectItem>
            <SelectItem value="voided">Voided</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs tabular-nums text-muted-foreground">
          {filtered.length} of {entries.length}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <RosterExportDialog entries={entries} />
          <NumbersImportDialog entries={entries} />
          <BulkAddDialog owners={owners} existingNames={existingNames} />
        </div>
      </div>

      {nearCollisions.length > 0 ? (
        <div className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie">
          <p className="font-semibold">
            {nearCollisions.length} name{" "}
            {nearCollisions.length === 1 ? "group sits" : "groups sit"} within
            one edit of each other — Lynne matches picks by name, so know
            these are close:
          </p>
          <ul className="mt-1.5 space-y-1 text-xs">
            {nearCollisions.map((g, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="font-medium">({KIND_LABEL[g.kind]})</span>
                {g.names.map((n, j) => (
                  <span key={j}>
                    “{n}”
                    <span className="opacity-70"> · {ownerByName.get(n)}</span>
                    {j < g.names.length - 1 ? "," : ""}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs opacity-80">
            Numbered sets with an identical base (Nick&Kels 1–4) are the
            naming convention and are excluded — anything listed here is a
            genuine hazard.
          </p>
        </div>
      ) : (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
          No name near-collisions. Deliberate numbered sets (Waggs1–4,
          ReRe #1–4) are excluded by convention; case-inconsistent sets and
          cross-owner lookalikes would be flagged here.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              {SORT_HEADERS.map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    "whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground",
                    h.label === "Picks" && "text-right",
                  )}
                >
                  {h.key ? (
                    <button
                      type="button"
                      onClick={() => clickSort(h.key!)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-foreground",
                        sortKey === h.key && "text-foreground",
                      )}
                      title="Click to sort; third click restores the default (admin entries first)"
                    >
                      {h.label}
                      {sortKey === h.key ? (sortDir === "asc" ? " ▲" : " ▼") : null}
                    </button>
                  ) : (
                    h.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, i) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                adminBoundary={
                  sortKey === null &&
                  entry.isAdminEntry &&
                  !(sorted[i + 1]?.isAdminEntry ?? false)
                }
                otherNames={live
                  .filter((e) => e.id !== entry.id)
                  .map((e) => ({ name: e.entryName, owner: e.ownerName }))}
              />
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
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

function EntryRow({
  entry,
  otherNames,
  adminBoundary,
}: {
  entry: AdminEntry;
  otherNames: ExistingName[];
  /** Last admin entry in default order — draws the boundary divider. */
  adminBoundary?: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const voided = entry.voidedAt !== null;
  const removable = entry.pickCount === 0;

  return (
    <tr
      className={cn(
        "h-12 border-b border-border/60 transition-colors duration-150 ease-out last:border-0 hover:bg-surface-2/60 sm:h-10",
        voided && "opacity-55",
        adminBoundary && "border-b-2 border-b-primary/50",
      )}
    >
      <td className="whitespace-nowrap px-3 text-muted-foreground">
        {entry.ownerName}
      </td>
      <td className="whitespace-nowrap px-3 font-medium">{entry.entryName}</td>
      <td className="whitespace-nowrap px-3 text-right tabular-nums">
        {entry.lynneNumber ?? (
          <span className="font-semibold text-tie" title="No Lynne number — cannot be submitted">
            —
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 text-muted-foreground">
        {entry.lynneLabel ?? "—"}
      </td>
      <td className="whitespace-nowrap px-3">
        <div className="flex items-center gap-1.5">
          {entry.isAdminEntry ? (
            <Badge
              variant="outline"
              className="border-primary/50 text-primary"
              title="The pool runner's entry — sorts first by default"
            >
              ADMIN
            </Badge>
          ) : null}
          {entry.nameIsDefault ? (
            <Badge variant="outline">Default</Badge>
          ) : null}
          {entry.isFreeEntry ? <Badge variant="secondary">Free</Badge> : null}
          {voided ? (
            <Badge variant="outline" className="border-loss/40 text-loss">
              Voided
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 text-right tabular-nums">
        {entry.pickCount}
      </td>
      <td className="whitespace-nowrap px-3">
        <div className="flex items-center justify-end gap-1.5">
          <Button size="xs" variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          {!voided ? (
            <Button
              size="xs"
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
            >
              {removable ? "Remove" : "Void"}
            </Button>
          ) : null}
          <EntryEditDialog
            entry={entry}
            otherNames={otherNames}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
          {!voided ? (
            <DestructiveDialog
              entry={entry}
              removable={removable}
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
            />
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function DestructiveDialog({
  entry,
  removable,
  open,
  onOpenChange,
}: {
  entry: AdminEntry;
  removable: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleOpenChange(next: boolean) {
    if (next) setError(null);
    onOpenChange(next);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = removable
      ? await removeEntryAction({ entryId: entry.id })
      : await voidEntryAction({ entryId: entry.id });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? (removable ? "Remove failed" : "Void failed"));
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {removable ? "Remove entry?" : "Void entry?"}
          </DialogTitle>
          <DialogDescription>
            {removable ? (
              <>
                <span className="font-medium text-foreground">
                  {entry.entryName}
                </span>{" "}
                has no picks and will be permanently deleted. This cannot be
                undone.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {entry.entryName}
                </span>{" "}
                has {entry.pickCount}{" "}
                {entry.pickCount === 1 ? "pick" : "picks"}, so it keeps its
                history but leaves the pool and billing.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="text-sm text-loss">{error}</p> : null}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={confirm}
          >
            {busy
              ? removable
                ? "Removing…"
                : "Voiding…"
              : removable
                ? "Remove permanently"
                : "Void entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
