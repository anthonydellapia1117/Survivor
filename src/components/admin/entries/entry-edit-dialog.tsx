"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminEntry } from "@/lib/data/admin-types";
import { updateEntryAction } from "@/app/admin/actions";
import {
  NameCollisionWarning,
  type ExistingName,
} from "@/components/admin/name-warning";
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
import { Checkbox } from "@/components/ui/checkbox";

export function EntryEditDialog({
  entry,
  otherNames,
  open,
  onOpenChange,
}: {
  entry: AdminEntry;
  otherNames: ExistingName[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Entry name is VERBATIM: whatever is typed here is exactly what is saved.
  const [entryName, setEntryName] = useState(entry.entryName);
  const [lynneLabel, setLynneLabel] = useState(entry.lynneLabel ?? "");
  const [isFree, setIsFree] = useState(entry.isFreeEntry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleOpenChange(next: boolean) {
    if (next) {
      setEntryName(entry.entryName);
      setLynneLabel(entry.lynneLabel ?? "");
      setIsFree(entry.isFreeEntry);
      setError(null);
    }
    onOpenChange(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const result = await updateEntryAction({
      entryId: entry.id,
      entryName,
      lynneLabel,
      // Pass null when the flag is untouched so the action leaves it alone.
      isFree: isFree === entry.isFreeEntry ? null : isFree,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Update failed");
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit entry</DialogTitle>
          <DialogDescription>
            Owner: {entry.ownerName} · #{entry.entryIndex}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`entry-name-${entry.id}`}>Entry name</Label>
            <Input
              id={`entry-name-${entry.id}`}
              value={entryName}
              onChange={(e) => setEntryName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Saved exactly as typed — casing and spacing are never normalized.
            </p>
            {entryName !== entry.entryName ? (
              <NameCollisionWarning
                proposed={[entryName]}
                existing={otherNames}
              />
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`lynne-label-${entry.id}`}>Lynne label</Label>
            <Input
              id={`lynne-label-${entry.id}`}
              value={lynneLabel}
              onChange={(e) => setLynneLabel(e.target.value)}
              placeholder="What Lynne's file calls it, if different"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <Label htmlFor={`is-free-${entry.id}`} className="font-normal">
            <Checkbox
              id={`is-free-${entry.id}`}
              checked={isFree}
              onCheckedChange={(v) => setIsFree(v === true)}
            />
            Free entry
          </Label>

          {error ? <p className="text-sm text-loss">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={busy || entryName === ""} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
