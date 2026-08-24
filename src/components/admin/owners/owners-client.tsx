"use client";

import { useMemo, useState } from "react";
import type { AdminEntry, AdminOwner } from "@/lib/data/admin-types";
import { formatCents } from "@/lib/pool";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GitMerge, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  AddEntriesDialog,
  AddOwnerDialog,
  EditOwnerDialog,
  SOURCE_OPTIONS,
} from "./owner-dialogs";
import { MergeOwnerDialog } from "./merge-owner-dialog";
import { deleteOwnerAction } from "@/app/admin/actions";
import { useRouter } from "next/navigation";

const STATUS_BADGE: Record<AdminOwner["participationStatus"], string> = {
  confirmed: "border-win/40 bg-win/10 text-win",
  declined: "border-loss/40 bg-loss/10 text-loss",
  pending: "border-tie/40 bg-tie/10 text-tie",
};

const STATUS_LABEL: Record<AdminOwner["participationStatus"], string> = {
  confirmed: "Confirmed",
  declined: "Declined",
  pending: "Pending",
};

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  SOURCE_OPTIONS.map((s) => [s.value, s.label]),
);

export function OwnersClient({
  owners,
  entries,
}: {
  owners: AdminOwner[];
  entries: AdminEntry[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminOwner | null>(null);
  const [addingEntries, setAddingEntries] = useState<AdminOwner | null>(null);
  const [merging, setMerging] = useState<AdminOwner | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // H: duplicate candidates — normalized name (lowercase, punctuation and
  // whitespace stripped) groups, names displayed verbatim.
  const dupGroups = useMemo(() => {
    const norm = (o: AdminOwner) =>
      `${o.firstName} ${o.lastName}`.toLowerCase().replace(/[^a-z0-9]/g, "");
    const m = new Map<string, AdminOwner[]>();
    for (const o of owners) {
      const k = norm(o);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(o);
    }
    return [...m.values()].filter((g) => g.length > 1);
  }, [owners]);

  async function hardDelete(o: AdminOwner) {
    setDeleteError(null);
    const res = await deleteOwnerAction({ ownerId: o.id });
    if (!res.ok) setDeleteError(res.error ?? "Delete failed");
    else router.refresh();
  }

  const namesByOwner = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of entries) {
      if (e.voidedAt) continue;
      const list = m.get(e.ownerId);
      if (list) list.push(e.entryName);
      else m.set(e.ownerId, [e.entryName]);
    }
    return m;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (q === "") return owners;
    return owners.filter((o) =>
      `${o.firstName} ${o.lastName}`.toLowerCase().includes(q),
    );
  }, [owners, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Owners</h1>
        <AddOwnerDialog />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search owners…"
          className="h-8 w-full sm:w-64"
        />
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {filtered.length} of {owners.length} owners
        </span>
      </div>

      {dupGroups.length > 0 ? (
        <div className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie">
          <p className="font-semibold">
            Possible duplicate owners ({dupGroups.length}{" "}
            {dupGroups.length === 1 ? "group" : "groups"}):
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {dupGroups.map((g, i) => (
              <li key={i}>
                {g.map((o) => `${o.firstName} ${o.lastName} (${o.entryCount} entries, ${formatCents(o.paidCents)} paid)`).join("  ·  ")}
                {" — use Merge in the row menu."}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {deleteError ? <p className="text-sm text-loss">{deleteError}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              {[
                "Owner",
                "Email",
                "Phone",
                "Source",
                "Status",
                "Entries",
                "Due",
                "Paid",
                "Balance",
                "",
              ].map((h, i) => (
                <th
                  key={h === "" ? `col-${i}` : h}
                  className={cn(
                    "whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground",
                    (h === "Entries" ||
                      h === "Due" ||
                      h === "Paid" ||
                      h === "Balance") &&
                      "text-right",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const names = namesByOwner.get(o.id) ?? [];
              const balance = o.dueCents - o.paidCents;
              return (
                <tr
                  key={o.id}
                  className={cn(
                    "h-12 border-b border-border/60 transition-colors duration-150 ease-out last:border-0 hover:bg-surface-2/60 sm:h-10",
                    o.participationStatus === "declined" && "opacity-55",
                  )}
                >
                  <td className="px-3 py-1.5">
                    <div className="whitespace-nowrap font-medium">
                      {o.firstName} {o.lastName}
                    </div>
                    {names.length > 0 ? (
                      <div className="max-w-56 truncate text-xs text-muted-foreground">
                        {names.join(" · ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 text-muted-foreground">
                    {o.email ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 tabular-nums text-muted-foreground">
                    {o.phone ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 text-muted-foreground">
                    {SOURCE_LABEL[o.source] ?? o.source}
                  </td>
                  <td className="whitespace-nowrap px-3">
                    <Badge
                      variant="outline"
                      className={STATUS_BADGE[o.participationStatus]}
                    >
                      {STATUS_LABEL[o.participationStatus]}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 text-right tabular-nums">
                    {o.entryCount}
                    {o.entryCount !== o.paidEntryCount ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        ({o.entryCount - o.paidEntryCount} free)
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 text-right tabular-nums">
                    {formatCents(o.dueCents)}
                  </td>
                  <td className="whitespace-nowrap px-3 text-right tabular-nums">
                    {formatCents(o.paidCents)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 text-right tabular-nums",
                      balance > 0 ? "text-loss" : "text-win",
                    )}
                  >
                    {formatCents(balance)}
                  </td>
                  <td className="px-1 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${o.firstName} ${o.lastName}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(o)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setAddingEntries(o)}>
                          <Plus />
                          Add entries
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setMerging(o)}>
                          <GitMerge />
                          Merge into another owner…
                        </DropdownMenuItem>
                        {o.entryCount === 0 && o.paidCents === 0 ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => hardDelete(o)}
                          >
                            <Trash2 />
                            Delete (empty typo row)
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  {owners.length === 0 ? "No owners yet." : "Nothing matches."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editing ? (
        <EditOwnerDialog
          key={editing.id}
          owner={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {addingEntries ? (
        <AddEntriesDialog
          key={addingEntries.id}
          owner={addingEntries}
          onClose={() => setAddingEntries(null)}
        />
      ) : null}
      {merging ? (
        <MergeOwnerDialog
          key={merging.id}
          source={merging}
          owners={owners}
          onClose={() => setMerging(null)}
        />
      ) : null}
    </div>
  );
}
