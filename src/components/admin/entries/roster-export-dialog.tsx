"use client";

// Roster for Lynne: entry names only, one per line, in the order they should
// be numbered — ADMIN entries (AAA 1..n) first so she sees at a glance which
// are the runner's, then owner by owner, entry 1..n.
//
// Three views, because a roster drifts from her copy in two different ways:
//   • New since last send — entries she has never seen (late joiners).
//   • Renamed — entries she HAS, under a name we have since changed. Shown
//     as "her name -> our name" so the correction can be pasted straight
//     into an email. Until she is told, her numbers come back keyed to the
//     old name; the number import matches those on the recorded name.
//   • Full roster — everything, for a fresh send.
// "Mark Lynne's list as current" stamps both: new entries become submitted,
// renamed entries re-record the name she now has.

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

/** Renamed after she got it: she holds submittedAsName, we hold entryName. */
export function isRenamedSinceSubmission(e: AdminEntry): boolean {
  return (
    e.submittedAsName !== null &&
    e.submittedToLynneAt !== null &&
    e.submittedAsName !== e.entryName
  );
}

type View = "delta" | "renamed" | "full";

export function RosterExportDialog({ entries }: { entries: AdminEntry[] }) {
  const [view, setView] = useState<View>("delta");
  const [copied, setCopied] = useState(false);
  const [marked, setMarked] = useState<{
    sent: number;
    renamed: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const active = useMemo(
    () => entries.filter((e) => !e.voidedAt).sort(rosterOrder),
    [entries],
  );
  const delta = useMemo(
    () => active.filter((e) => !e.submittedToLynneAt),
    [active],
  );
  const renamed = useMemo(
    () => active.filter(isRenamedSinceSubmission),
    [active],
  );

  const shown = view === "full" ? active : view === "delta" ? delta : renamed;
  const lines =
    view === "renamed"
      ? shown.map((e) => `${e.submittedAsName}  ->  ${e.entryName}`)
      : shown.map((e) => e.entryName);
  const block = lines.join("\n");
  const pendingWork = delta.length + renamed.length;

  async function copy() {
    await navigator.clipboard.writeText(block);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function download() {
    const csv =
      view === "renamed"
        ? [
            "HER NAME,OUR NAME",
            ...shown.map((e) =>
              [csvField(e.submittedAsName ?? ""), csvField(e.entryName)].join(
                ",",
              ),
            ),
          ].join("\n") + "\n"
        : ["NAMES", ...lines.map(csvField)].join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      view === "full"
        ? "DellaPia_Roster.csv"
        : view === "delta"
          ? "DellaPia_Roster_Additions.csv"
          : "DellaPia_Roster_Renames.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function markSent() {
    startTransition(async () => {
      const res = await markRosterSentAction();
      if (res.ok) {
        setMarked({ sent: res.sent ?? 0, renamed: res.renamed ?? 0 });
      }
    });
  }

  const description =
    view === "full"
      ? `Full roster — ${active.length} entry names in numbering order.`
      : view === "delta"
        ? delta.length > 0
          ? `${delta.length} ${delta.length === 1 ? "entry" : "entries"} Lynne has not seen yet.`
          : "Lynne has seen every current entry — nothing new to send."
        : renamed.length > 0
          ? `${renamed.length} ${renamed.length === 1 ? "entry was" : "entries were"} renamed after she got the list. Send her the corrections below.`
          : "No entry has been renamed since Lynne's list.";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Roster for Lynne
          {pendingWork > 0 ? (
            <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
              {delta.length > 0 ? `+${delta.length}` : null}
              {delta.length > 0 && renamed.length > 0 ? " " : null}
              {renamed.length > 0 ? `✎${renamed.length}` : null}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Roster for Lynne</DialogTitle>
          <DialogDescription>
            {description} She assigns the numbers; import them back with
            &quot;Import numbers&quot; when they arrive.
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
            variant={view === "renamed" ? "default" : "outline"}
            onClick={() => setView("renamed")}
          >
            Renamed ({renamed.length})
          </Button>
          <Button
            size="sm"
            variant={view === "full" ? "default" : "outline"}
            onClick={() => setView("full")}
          >
            Full roster ({active.length})
          </Button>
        </div>
        {lines.length > 0 ? (
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
        {view !== "full" && pendingWork > 0 ? (
          <div className="rounded-md border border-border bg-surface p-3 text-sm">
            {marked !== null ? (
              <p>
                Marked {marked.sent} new{" "}
                {marked.sent === 1 ? "entry" : "entries"} as sent
                {marked.renamed > 0
                  ? ` and re-recorded ${marked.renamed} renamed ${marked.renamed === 1 ? "entry" : "entries"}`
                  : ""}
                .
              </p>
            ) : (
              <>
                <p className="mb-2 text-muted-foreground">
                  Once Lynne has the additions and the corrections above, stamp
                  them so the next round starts clean:
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={markSent}
                >
                  {pending
                    ? "Marking…"
                    : `Mark Lynne's list as current (${delta.length} new, ${renamed.length} renamed)`}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
