"use client";

// Part H UI: merge one owner into another. Shows before/after for entry
// count, tier rate, due, and paid — merging can silently drop the due via
// the tier flip, so the screen says so — and requires typing the target's
// exact name to confirm.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminOwner } from "@/lib/data/admin-types";
import { mergeOwnerAction } from "@/app/admin/actions";
import { amountDueCents, formatCents } from "@/lib/pool";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function MergeOwnerDialog({
  source,
  owners,
  onClose,
}: {
  source: AdminOwner;
  owners: AdminOwner[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = owners.find((o) => o.id === targetId) ?? null;
  const targetName = target ? `${target.firstName} ${target.lastName}` : "";

  const after = useMemo(() => {
    if (!target) return null;
    const paidEntries = source.paidEntryCount + target.paidEntryCount;
    const entries = source.entryCount + target.entryCount;
    return {
      entries,
      paidEntries,
      due: amountDueCents(paidEntries),
      paid: source.paidCents + target.paidCents,
      rate: paidEntries >= 4 ? 2500 : 3000,
    };
  }, [source, target]);

  const beforeDue = source.dueCents + (target?.dueCents ?? 0);
  const dueDrop = after ? beforeDue - after.due : 0;

  async function merge() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const res = await mergeOwnerAction({ sourceId: source.id, targetId: target.id });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Merge failed");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Merge {source.firstName} {source.lastName} into…
          </DialogTitle>
          <DialogDescription>
            Entries move, payments reverse-and-repost (the ledger keeps
            everything), and the source becomes an archived shell. Nothing is
            deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Target owner</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose who survives…" />
              </SelectTrigger>
              <SelectContent>
                {owners
                  .filter((o) => o.id !== source.id)
                  .map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.firstName} {o.lastName}
                      {o.email ? ` — ${o.email}` : " — no email"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {target && after ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">&nbsp;</th>
                    <th className="px-2 py-1.5 text-right font-medium">Entries</th>
                    <th className="px-2 py-1.5 text-right font-medium">Rate</th>
                    <th className="px-2 py-1.5 text-right font-medium">Due</th>
                    <th className="px-2 py-1.5 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[
                    { label: `${source.firstName} ${source.lastName} (goes away)`, o: source },
                    { label: `${targetName} (survives)`, o: target },
                  ].map(({ label, o }) => (
                    <tr key={o.id} className="border-t border-border/60">
                      <td className="px-2 py-1.5">{label}</td>
                      <td className="px-2 py-1.5 text-right">{o.entryCount}</td>
                      <td className="px-2 py-1.5 text-right">
                        {o.paidEntryCount >= 4 ? "$25" : "$30"}
                      </td>
                      <td className="px-2 py-1.5 text-right">{formatCents(o.dueCents)}</td>
                      <td className="px-2 py-1.5 text-right">{formatCents(o.paidCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-surface-2 font-semibold">
                    <td className="px-2 py-1.5">After the merge</td>
                    <td className="px-2 py-1.5 text-right">{after.entries}</td>
                    <td className="px-2 py-1.5 text-right">
                      {formatCents(after.rate)}
                    </td>
                    <td className="px-2 py-1.5 text-right">{formatCents(after.due)}</td>
                    <td className="px-2 py-1.5 text-right">{formatCents(after.paid)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          {target && dueDrop !== 0 ? (
            <p className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2 text-xs text-tie">
              Tier flip: combined due {dueDrop > 0 ? "drops" : "rises"} by{" "}
              <span className="font-semibold">{formatCents(Math.abs(dueDrop))}</span>{" "}
              because pricing recomputes at the merged entry count.
            </p>
          ) : null}

          {target ? (
            <div className="space-y-1.5">
              <Label htmlFor="merge-confirm">
                Type <span className="font-semibold">{targetName}</span> to confirm
              </Label>
              <Input
                id="merge-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
            </div>
          ) : null}

          {error ? <p className="text-sm text-loss">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || !target || confirmText !== targetName}
            onClick={merge}
          >
            {busy ? "Merging…" : "Merge owners"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
