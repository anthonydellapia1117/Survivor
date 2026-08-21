"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminEntry, AdminOwner } from "@/lib/data/admin-types";
import { removeEntryAction, voidEntryAction } from "@/app/admin/actions";
import { EntryEditDialog } from "@/components/admin/entries/entry-edit-dialog";
import { BulkAddDialog } from "@/components/admin/entries/bulk-add-dialog";
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

export function EntriesAdmin({
  entries,
  owners,
}: {
  entries: AdminEntry[];
  owners: AdminOwner[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

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
        <div className="ml-auto">
          <BulkAddDialog owners={owners} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              {["Entry", "Owner", "#", "Lynne label", "", "Picks", ""].map(
                (h, i) => (
                  <th
                    key={i}
                    className={cn(
                      "whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground",
                      (h === "#" || h === "Picks") && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
            {filtered.length === 0 ? (
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

function EntryRow({ entry }: { entry: AdminEntry }) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const voided = entry.voidedAt !== null;
  const removable = entry.pickCount === 0;

  return (
    <tr
      className={cn(
        "h-12 border-b border-border/60 transition-colors duration-150 ease-out last:border-0 hover:bg-surface-2/60 sm:h-10",
        voided && "opacity-55",
      )}
    >
      <td className="whitespace-nowrap px-3 font-medium">{entry.entryName}</td>
      <td className="whitespace-nowrap px-3 text-muted-foreground">
        {entry.ownerName}
      </td>
      <td className="whitespace-nowrap px-3 text-right tabular-nums">
        {entry.entryIndex}
      </td>
      <td className="whitespace-nowrap px-3 text-muted-foreground">
        {entry.lynneLabel ?? "—"}
      </td>
      <td className="whitespace-nowrap px-3">
        <div className="flex items-center gap-1.5">
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
