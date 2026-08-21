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
import { MoreHorizontal, Pencil, Plus } from "lucide-react";
import {
  AddEntriesDialog,
  AddOwnerDialog,
  EditOwnerDialog,
  SOURCE_OPTIONS,
} from "./owner-dialogs";

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
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminOwner | null>(null);
  const [addingEntries, setAddingEntries] = useState<AdminOwner | null>(null);

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
    </div>
  );
}
