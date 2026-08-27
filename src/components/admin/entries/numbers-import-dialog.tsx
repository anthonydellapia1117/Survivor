"use client";

// Season-start bulk import of Lynne's numbers. Paste her list (name-number
// or number-name, either order), see the exact mapping, approve, write.
// Matching is exact name then case-insensitive — never fuzzy. An entry
// renamed after it went to Lynne also matches on the name SHE has (again
// exact then case-insensitive), and the mapping row says so. Unmatched
// lines are reported, never guessed.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminEntry } from "@/lib/data/admin-types";
import { matchNumberPairs, parseNumberPairs } from "@/lib/lynne/numbers";
import { bulkSetLynneNumbersAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const REASON_LABEL: Record<string, string> = {
  no_match: "no entry with this name",
  ambiguous_name: "matches more than one entry",
  duplicate_name_in_paste: "entry appears twice in the paste",
  duplicate_number_in_paste: "number appears twice in the paste",
  number_taken_by_other_entry: "number already on another entry",
};

export function NumbersImportDialog({ entries }: { entries: AdminEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = useMemo(() => entries.filter((e) => !e.voidedAt), [entries]);
  const preview = useMemo(() => {
    if (!confirming) return null;
    const parsed = parseNumberPairs(text);
    const matched = matchNumberPairs(
      parsed.pairs,
      live.map((e) => ({
        id: e.id,
        entryName: e.entryName,
        lynneNumber: e.lynneNumber,
        submittedAsName: e.submittedAsName,
      })),
    );
    return { ...matched, unparsed: parsed.unparsed };
  }, [confirming, text, live]);

  async function apply() {
    if (!preview || preview.matches.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await bulkSetLynneNumbersAction({
      rows: preview.matches.map((m) => ({
        entryId: m.entryId,
        lynneNumber: m.no,
      })),
    });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.failures?.length
          ? `Applied ${res.applied ?? 0}; failed: ${res.failures.join("; ")}`
          : (res.error ?? "Import failed"),
      );
      return;
    }
    setDone(`${res.applied} numbers written.`);
    setConfirming(false);
    setText("");
    router.refresh();
  }

  function reset(next: boolean) {
    setOpen(next);
    if (next) {
      setConfirming(false);
      setDone(null);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Import numbers
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Lynne&apos;s numbers</DialogTitle>
          <DialogDescription>
            Paste her list — one entry per line, number first or last (&quot;993
            Nick&amp;Kels 1&quot; or &quot;Nick&amp;Kels 1, 993&quot;). Exact
            then case-insensitive name matching, never fuzzy. Nothing is written
            until you approve the mapping.
          </DialogDescription>
        </DialogHeader>

        {done ? <p className="text-sm text-win">{done}</p> : null}
        {error ? <p className="text-sm text-loss">{error}</p> : null}

        {!confirming ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder={
                "977\tAnthony DellaPia 1\n978\tAnthony DellaPia 2\n…"
              }
              className="w-full rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed"
            />
            <DialogFooter>
              <Button
                size="sm"
                onClick={() => setConfirming(true)}
                disabled={text.trim() === ""}
              >
                Preview mapping
              </Button>
            </DialogFooter>
          </>
        ) : preview ? (
          <div className="space-y-3">
            {preview.unparsed.length > 0 ? (
              <div className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">
                <p className="font-semibold">
                  {preview.unparsed.length} unreadable{" "}
                  {preview.unparsed.length === 1 ? "line" : "lines"} (no number
                  found):
                </p>
                {preview.unparsed.map((u) => (
                  <p key={u.line} className="mt-0.5 font-mono">
                    line {u.line}: {u.text}
                  </p>
                ))}
              </div>
            ) : null}
            {preview.issues.length > 0 ? (
              <div className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">
                <p className="font-semibold">
                  {preview.issues.length} not applied — reported, never guessed:
                </p>
                {preview.issues.map((iss, i) => (
                  <p key={i} className="mt-0.5 font-mono">
                    line {iss.line}: {iss.text} —{" "}
                    {REASON_LABEL[iss.reason] ?? iss.reason}
                    {iss.detail ? ` (${iss.detail})` : ""}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">NO.</th>
                    <th className="px-2 py-1.5">Her line says</th>
                    <th className="px-2 py-1.5">Writes to entry</th>
                    <th className="px-2 py-1.5">Matched by</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.matches.map((m) => (
                    <tr key={m.entryId} className="border-t border-border/60">
                      <td className="px-2 py-1 tabular-nums">
                        {m.no}
                        {m.replaces !== null ? (
                          <span className="ml-1 text-xs text-tie">
                            (was {m.replaces})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs">
                        {m.pastedName}
                      </td>
                      <td className="px-2 py-1 font-medium">{m.entryName}</td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">
                        {m.matchedBy.replaceAll("_", " ")}
                      </td>
                    </tr>
                  ))}
                  {preview.matches.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        Nothing matched.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Back
              </Button>
              <Button
                size="sm"
                disabled={busy || preview.matches.length === 0}
                onClick={apply}
              >
                {busy
                  ? "Writing…"
                  : `Write ${preview.matches.length} ${preview.matches.length === 1 ? "number" : "numbers"}`}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
