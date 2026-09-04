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
import { isPlausibleAddress } from "@/lib/emails/address";

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
  const [lynneNumber, setLynneNumber] = useState(
    entry.lynneNumber === null ? "" : String(entry.lynneNumber),
  );
  const [isFree, setIsFree] = useState(entry.isFreeEntry);
  // Who plays it. Empty is a real, meaningful state when isGifted is on:
  // somebody else plays this entry and we do not have their address yet.
  const [isGifted, setIsGifted] = useState(entry.isGifted);
  const [playerEmail, setPlayerEmail] = useState(entry.playerEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleOpenChange(next: boolean) {
    if (next) {
      setEntryName(entry.entryName);
      setLynneLabel(entry.lynneLabel ?? "");
      setLynneNumber(entry.lynneNumber === null ? "" : String(entry.lynneNumber));
      setIsFree(entry.isFreeEntry);
      setIsGifted(entry.isGifted);
      setPlayerEmail(entry.playerEmail ?? "");
      setError(null);
    }
    onOpenChange(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const parsedNum = lynneNumber.trim() === "" ? null : Number(lynneNumber);
    if (parsedNum !== null && (!Number.isInteger(parsedNum) || parsedNum < 1)) {
      setBusy(false);
      setError("Lynne number must be a positive whole number");
      return;
    }
    // The Save button calls this directly rather than submitting a form, so
    // the input's type="email" never runs a native validity check. Without
    // this a mistyped address saves, and the entry's pick request is then
    // generated for a destination that cannot receive it -- silently, because
    // nothing here ever sends the mail and sees it bounce.
    if (!isPlausibleAddress(playerEmail)) {
      setBusy(false);
      setError("Player email does not look like an address");
      return;
    }
    const result = await updateEntryAction({
      entryId: entry.id,
      entryName,
      lynneLabel,
      lynneNumber: parsedNum,
      // Pass null when the flag is untouched so the action leaves it alone.
      isFree: isFree === entry.isFreeEntry ? null : isFree,
      // An address is proof of the arrangement, so entering one turns the
      // flag on; the RPC applies the same rule, so the two cannot disagree.
      isGifted: isGifted || playerEmail.trim() !== "",
      playerEmail,
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
            <Label htmlFor={`lynne-number-${entry.id}`}>Lynne number</Label>
            <Input
              id={`lynne-number-${entry.id}`}
              value={lynneNumber}
              onChange={(e) => setLynneNumber(e.target.value)}
              inputMode="numeric"
              placeholder="Her entry number — required for submissions"
              autoComplete="off"
            />
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

          {/*
            Who plays it. The buyer keeps the money and the tier — nothing
            here touches billing. What it changes is where this one entry's
            pick request goes, and who Anthony acts on a reply from.
          */}
          <div className="space-y-2 rounded-md border border-border px-3 py-2.5">
            <Label htmlFor={`is-gifted-${entry.id}`} className="font-normal">
              <Checkbox
                id={`is-gifted-${entry.id}`}
                checked={isGifted || playerEmail.trim() !== ""}
                onCheckedChange={(v) => {
                  const on = v === true;
                  setIsGifted(on);
                  // Turning it off drops the address with it — leaving one
                  // behind would be an arrangement the roster no longer
                  // records but the mail still honours.
                  if (!on) setPlayerEmail("");
                }}
              />
              Played by someone else
            </Label>
            {isGifted || playerEmail.trim() !== "" ? (
              <div className="space-y-1.5">
                <Label htmlFor={`player-email-${entry.id}`}>
                  Player&apos;s email
                </Label>
                <Input
                  id={`player-email-${entry.id}`}
                  type="email"
                  value={playerEmail}
                  onChange={(e) => setPlayerEmail(e.target.value)}
                  placeholder="they@example.com"
                  aria-describedby={`player-email-hint-${entry.id}`}
                />
                <p
                  id={`player-email-hint-${entry.id}`}
                  className="text-xs text-muted-foreground"
                >
                  This entry&apos;s pick request goes here instead of to{" "}
                  {entry.ownerName}, and a reply from this address is acted on.
                  Billing is unaffected — {entry.ownerName} still pays and keeps
                  the tier. Leave blank if you do not have it yet; the entry is
                  then listed as a gap to chase.
                </p>
              </div>
            ) : null}
          </div>

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
