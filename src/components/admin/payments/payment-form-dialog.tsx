"use client";

// Add-payment / add-correction dialog. The ledger is append-only: this form
// only ever inserts. A correction is a new row carrying corrects_payment_id;
// the corrected row is never touched.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CornerUpLeft } from "lucide-react";
import type { AdminOwner, AdminPayment } from "@/lib/data/admin-types";
import { recordPaymentAction } from "@/app/admin/actions";
import { formatCents } from "@/lib/pool";
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
import {
  centsToDollarInput,
  formatPaidOn,
  parseDollarsToCents,
  todayIsoLocal,
} from "./payment-format";

const UNMATCHED = "__unmatched__";
const METHODS = ["venmo", "cash", "check", "correction", "comp"] as const;

export function PaymentFormDialog({
  owners,
  correcting,
  onClose,
}: {
  owners: AdminOwner[];
  /** The ledger row being corrected, or null for a plain payment. */
  correcting: AdminPayment | null;
  onClose: () => void;
}) {
  // The parent mounts this dialog fresh each time it opens, so initial state
  // from props is the reset.
  const [ownerId, setOwnerId] = useState<string>(
    correcting ? (correcting.ownerId ?? UNMATCHED) : UNMATCHED,
  );
  const [amount, setAmount] = useState(
    correcting ? centsToDollarInput(-correcting.amountCents) : "",
  );
  const [method, setMethod] = useState<string>(
    correcting ? "correction" : "venmo",
  );
  const [paidOn, setPaidOn] = useState(todayIsoLocal());
  const [venmoTxnId, setVenmoTxnId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Confirmed owners, plus the corrected row's owner even if not confirmed —
  // a correction must be able to land on the same owner as the original.
  const options = owners
    .filter(
      (o) =>
        o.participationStatus === "confirmed" || o.id === correcting?.ownerId,
    )
    .sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(
        `${b.firstName} ${b.lastName}`,
      ),
    );

  async function save() {
    const cents = parseDollarsToCents(amount);
    if (cents === null || cents === 0) {
      setError(
        'Amount must be dollars like "30" or "30.00" — negative for corrections.',
      );
      return;
    }
    if (!paidOn) {
      setError("Pick a date.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await recordPaymentAction({
      ownerId: ownerId === UNMATCHED ? null : ownerId,
      amountCents: cents,
      method,
      paidOn,
      venmoTxnId: venmoTxnId.trim(),
      note,
      corrects: correcting ? correcting.id : null,
    });
    setBusy(false);
    if (!result.ok) {
      // Surface the raw error — on a duplicate venmo txn id the database
      // rejected the row, and the admin should see exactly why.
      setError(result.error ?? "Payment was not recorded.");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {correcting ? "Add correction" : "Add payment"}
          </DialogTitle>
          <DialogDescription>
            The ledger is append-only — this adds a row, nothing is ever edited
            or deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {correcting ? (
            <div className="space-y-0.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs">
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <CornerUpLeft className="size-3.5 text-tie" />
                Corrects {correcting.ownerName ?? "Unmatched"} ·{" "}
                <span className="tabular-nums">
                  {formatCents(correcting.amountCents)}
                </span>{" "}
                on {formatPaidOn(correcting.paidOn)}
              </p>
              <p className="truncate font-mono text-muted-foreground">
                {correcting.id}
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="payment-owner">Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger id="payment-owner" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNMATCHED}>
                  Unmatched / quarantine
                </SelectItem>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.firstName} {o.lastName}
                    {o.participationStatus !== "confirmed"
                      ? ` (${o.participationStatus})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payment-amount">Amount ($)</Label>
              <Input
                id="payment-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="30 or 30.00"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Negative for corrections.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-method">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="payment-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payment-date">Date</Label>
              <Input
                id="payment-date"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-txn">Venmo txn ID</Label>
              <Input
                id="payment-txn"
                value={venmoTxnId}
                onChange={(e) => setVenmoTxnId(e.target.value)}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-note">Note</Label>
            <Input
              id="payment-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoComplete="off"
            />
          </div>

          {error ? <p className="text-sm text-loss">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || amount.trim() === ""} onClick={save}>
            {busy
              ? "Saving…"
              : correcting
                ? "Record correction"
                : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
