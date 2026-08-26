"use client";

// Roster for Lynne: entry names only, one per line, in the order they
// should be numbered — ADMIN entries (AAA 1..n) first so she sees at a
// glance which are the runner's, then owner by owner, entry 1..n.
// Two views: the full roster, and "new since last send" — entries with no
// submitted_to_lynne_at stamp — so late joiners go out as a short add-on
// list instead of a re-send. "Mark as sent" stamps the delta after the
// list has actually gone to her.

import { useMemo, useState, useTransition } from "react";
import type { AdminEntry } from "@/lib/data/admin-types";
import { adminFirst } from "@/lib/free-entries";
import { markRosterSentAction } from "@/app/admin/actions";
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

function rosterOrder(a: AdminEntry, b: AdminEntry): number {
  return (
    adminFirst(a, b) ||
    a.ownerName.localeCompare(b.ownerName) ||
    a.entryIndex - b.entryIndex
  );
}

export function RosterExportDialog({ entries }: { entries: AdminEntry[] }) {
  const [view, setView] = useState<"delta" | "full">("delta");
  const [copied, setCopied] = useState(false);
  const [marked, setMarked] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const active = useMemo(
    () => entries.filter((e) => !e.voidedAt).sort(rosterOrder),
    [entries],
  );
  const delta = useMemo(
    () => active.filter((e) => !e.submittedToLynneAt),
    [active],
  );

  const shown = view === "full" ? active : delta;
  const names = shown.map((e) => e.entryName);
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
    a.download =
      view === "full" ? "DellaPia_Roster.csv" : "DellaPia_Roster_Additions.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function markSent() {
    startTransition(async () => {
      const res = await markRosterSentAction();
      if (res.ok) setMarked(res.count ?? 0);
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Roster for Lynne
          {delta.length > 0 ? (
            <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
              +{delta.length}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Roster for Lynne</DialogTitle>
          <DialogDescription>
            {view === "full"
              ? `Full roster — ${active.length} entry names in numbering order.`
              : delta.length > 0
                ? `${delta.length} ${delta.length === 1 ? "entry" : "entries"} Lynne has not seen yet.`
                : "Lynne has seen every current entry — nothing new to send."}{" "}
            She assigns the numbers; import them back with &quot;Import
            numbers&quot; when they arrive.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={view === "delta" ? "default" : "outline"}
            onClick={() => setView("delta")}
          >
            New since last send ({delta.length})
          </Button>
          <Button
            size="sm"
            variant={view === "full" ? "default" : "outline"}
            onClick={() => setView("full")}
          >
            Full roster ({active.length})
          </Button>
        </div>
        {names.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2">
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
          </>
        ) : null}
        {view === "delta" && delta.length > 0 ? (
          <div className="rounded-md border border-border bg-surface p-3 text-sm">
            {marked !== null ? (
              <p>
                Marked {marked} {marked === 1 ? "entry" : "entries"} as sent.
              </p>
            ) : (
              <>
                <p className="mb-2 text-muted-foreground">
                  After this list has actually gone to Lynne, stamp it so the
                  next delta starts fresh:
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={markSent}
                >
                  {pending
                    ? "Marking…"
                    : `Mark ${delta.length} ${delta.length === 1 ? "entry" : "entries"} as sent to Lynne`}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
