"use client";

// Season-start roster for Lynne: entry names only, one per line, in the
// order they should be numbered — ADMIN entries (AAA 1..n) first so she
// sees at a glance which are the runner's, then owner by owner, entry
// 1..n. Copy block and CSV download of the same list.

import { useMemo, useState } from "react";
import type { AdminEntry } from "@/lib/data/admin-types";
import { adminFirst } from "@/lib/free-entries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function RosterExportDialog({ entries }: { entries: AdminEntry[] }) {
  const [copied, setCopied] = useState(false);

  const names = useMemo(
    () =>
      entries
        .filter((e) => !e.voidedAt)
        .sort(
          (a, b) =>
            adminFirst(a, b) ||
            a.ownerName.localeCompare(b.ownerName) ||
            a.entryIndex - b.entryIndex,
        )
        .map((e) => e.entryName),
    [entries],
  );
  const block = names.join("\n");

  async function copy() {
    await navigator.clipboard.writeText(block);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function download() {
    const csv = ["NAMES", ...names.map(csvField)].join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "DellaPia_Roster.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Roster for Lynne
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Roster for Lynne</DialogTitle>
          <DialogDescription>
            {names.length} entry names, one per line, in numbering order
            (owner by owner). She assigns the numbers; import them back with
            &quot;Import numbers&quot; when they arrive.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" onClick={copy}>
            {copied ? "Copied" : "Copy list"}
          </Button>
          <Button size="sm" variant="outline" onClick={download}>
            Download CSV
          </Button>
        </div>
        <pre className="max-h-96 overflow-y-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed">
          {block}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
