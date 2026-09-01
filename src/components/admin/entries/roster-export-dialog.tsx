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
//   • Removed — entries she HAS that we have since voided (someone asked out
//     after the roster went over). Shown under the name SHE holds, because
//     that is what she has to find on her sheet. Without this view a void
//     simply vanished from every screen and her sheet kept carrying a live
//     entry nobody was picking for.
//   • Full roster — everything, for a fresh send.
// The three stamps are INDEPENDENT, because the three emails are: telling her
// about a rename says nothing about whether late joiners have gone out, and
// stamping them together would have quietly marked unsent entries as sent.
// Each view carries its own button.

import { useMemo, useState, useTransition } from "react";
import type { AdminEntry } from "@/lib/data/admin-types";
import { adminFirst } from "@/lib/free-entries";
import {
  isRemovedSinceSubmission,
  isRenamedSinceSubmission,
  isUnsentToLynne,
  nameOnLynnesSheet,
} from "@/lib/lynne/roster-drift";
import {
  markNewEntriesSentAction,
  markRemovalsCommunicatedAction,
  markRenamesCommunicatedAction,
} from "@/app/admin/actions";
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

type View = "delta" | "renamed" | "removed" | "full";

export function RosterExportDialog({ entries }: { entries: AdminEntry[] }) {
  const [view, setView] = useState<View>("delta");
  const [copied, setCopied] = useState(false);
  const [sentDone, setSentDone] = useState<number | null>(null);
  const [renamedDone, setRenamedDone] = useState<number | null>(null);
  const [removedDone, setRemovedDone] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const active = useMemo(
    () => entries.filter((e) => !e.voidedAt).sort(rosterOrder),
    [entries],
  );
  const delta = useMemo(() => active.filter(isUnsentToLynne), [active]);
  const renamed = useMemo(
    () => active.filter(isRenamedSinceSubmission),
    [active],
  );
  // Drawn from ALL entries, not `active` — the whole point is that these are
  // voided, and `active` has already dropped them.
  const removed = useMemo(
    () => entries.filter(isRemovedSinceSubmission).sort(rosterOrder),
    [entries],
  );

  const shown =
    view === "full"
      ? active
      : view === "delta"
        ? delta
        : view === "renamed"
          ? renamed
          : removed;
  const lines =
    view === "renamed"
      ? shown.map((e) => `${e.submittedAsName}  ->  ${e.entryName}`)
      : view === "removed"
        ? // The name on HER sheet, which is what she has to strike.
          shown.map(nameOnLynnesSheet)
        : shown.map((e) => e.entryName);
  const block = lines.join("\n");
  const pendingWork = delta.length + renamed.length + removed.length;

  async function copy() {
    await navigator.clipboard.writeText(block);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function download() {
    const csv =
      view === "removed"
        ? ["NAME TO REMOVE", ...lines.map(csvField)].join("\n") + "\n"
        : view === "renamed"
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
          : view === "renamed"
            ? "DellaPia_Roster_Renames.csv"
            : "DellaPia_Roster_Removals.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function markNewSent() {
    startTransition(async () => {
      const res = await markNewEntriesSentAction();
      if (res.ok) setSentDone(res.count ?? 0);
    });
  }

  function markRenamesTold() {
    startTransition(async () => {
      const res = await markRenamesCommunicatedAction();
      if (res.ok) setRenamedDone(res.count ?? 0);
    });
  }

  function markRemovalsTold() {
    startTransition(async () => {
      const res = await markRemovalsCommunicatedAction();
      if (res.ok) setRemovedDone(res.count ?? 0);
    });
  }

  const description =
    view === "full"
      ? `Full roster — ${active.length} entry names in numbering order.`
      : view === "delta"
        ? delta.length > 0
          ? `${delta.length} ${delta.length === 1 ? "entry" : "entries"} Lynne has not seen yet.`
          : "Lynne has seen every current entry — nothing new to send."
        : view === "renamed"
          ? renamed.length > 0
            ? `${renamed.length} ${renamed.length === 1 ? "entry was" : "entries were"} renamed after she got the list. Send her the corrections below.`
            : "No entry has been renamed since Lynne's list."
          : removed.length > 0
            ? `${removed.length} ${removed.length === 1 ? "entry is" : "entries are"} still on her sheet after being voided here. Ask her to remove ${removed.length === 1 ? "it" : "them"}.`
            : "Nothing she holds has been voided since her list.";

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
              {(delta.length > 0 || renamed.length > 0) && removed.length > 0
                ? " "
                : null}
              {removed.length > 0 ? `−${removed.length}` : null}
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
            variant={view === "removed" ? "default" : "outline"}
            onClick={() => setView("removed")}
          >
            Removed ({removed.length})
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
        {/* Each stamp belongs to its own view and its own email. Marking
            corrections as communicated never touches entries she has not
            been sent, and vice versa. */}
        {view === "delta" && delta.length > 0 ? (
          <div className="rounded-md border border-border bg-surface p-3 text-sm">
            {sentDone !== null ? (
              <p>
                Marked {sentDone} new {sentDone === 1 ? "entry" : "entries"} as
                sent to Lynne. Renames were not touched.
              </p>
            ) : (
              <>
                <p className="mb-2 text-muted-foreground">
                  After this additions list has gone to Lynne:
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={markNewSent}
                >
                  {pending
                    ? "Marking…"
                    : `Mark ${delta.length} new ${delta.length === 1 ? "entry" : "entries"} as sent`}
                </Button>
              </>
            )}
          </div>
        ) : null}
        {view === "renamed" && renamed.length > 0 ? (
          <div className="rounded-md border border-border bg-surface p-3 text-sm">
            {renamedDone !== null ? (
              <p>
                Marked {renamedDone} {renamedDone === 1 ? "rename" : "renames"}{" "}
                as communicated. New entries were not touched.
              </p>
            ) : (
              <>
                <p className="mb-2 text-muted-foreground">
                  After Lynne has acknowledged these corrections:
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={markRenamesTold}
                >
                  {pending
                    ? "Marking…"
                    : `Mark ${renamed.length} ${renamed.length === 1 ? "rename" : "renames"} as communicated`}
                </Button>
              </>
            )}
          </div>
        ) : null}
        {view === "removed" && removed.length > 0 ? (
          <div className="rounded-md border border-border bg-surface p-3 text-sm">
            {removedDone !== null ? (
              <p>
                Marked {removedDone}{" "}
                {removedDone === 1 ? "removal" : "removals"} as communicated.
                New entries and renames were not touched.
              </p>
            ) : (
              <>
                <p className="mb-2 text-muted-foreground">
                  After Lynne has confirmed she pulled{" "}
                  {removed.length === 1 ? "it" : "them"} from her sheet:
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={markRemovalsTold}
                >
                  {pending
                    ? "Marking…"
                    : `Mark ${removed.length} ${removed.length === 1 ? "removal" : "removals"} as communicated`}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
