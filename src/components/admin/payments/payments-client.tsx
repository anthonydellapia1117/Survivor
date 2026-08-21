"use client";

// /admin/payments — the ledger beside the computed balances. Balances come
// from listOwners() (database views), never from summing the ledger here:
// the two panels agreeing is the whole point. The ledger is append-only —
// there is no delete or edit control anywhere on this screen.

import { useMemo, useState } from "react";
import { Check, CornerUpLeft, Plus, Undo2 } from "lucide-react";
import type { AdminOwner, AdminPayment } from "@/lib/data/admin-types";
import { formatCents } from "@/lib/pool";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PaymentFormDialog } from "./payment-form-dialog";
import { formatPaidOn } from "./payment-format";

const TH =
  "whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground";

export function PaymentsClient({
  payments,
  owners,
}: {
  payments: AdminPayment[];
  owners: AdminOwner[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [correcting, setCorrecting] = useState<AdminPayment | null>(null);

  const confirmed = useMemo(
    () =>
      owners
        .filter((o) => o.participationStatus === "confirmed")
        .sort((a, b) => {
          // Owners still owing float to the top.
          const aOwing = a.dueCents - a.paidCents > 0 ? 0 : 1;
          const bOwing = b.dueCents - b.paidCents > 0 ? 0 : 1;
          if (aOwing !== bOwing) return aOwing - bOwing;
          return `${a.firstName} ${a.lastName}`.localeCompare(
            `${b.firstName} ${b.lastName}`,
          );
        }),
    [owners],
  );

  const totals = useMemo(
    () =>
      confirmed.reduce(
        (t, o) => ({
          entries: t.entries + o.paidEntryCount,
          due: t.due + o.dueCents,
          paid: t.paid + o.paidCents,
        }),
        { entries: 0, due: 0, paid: 0 },
      ),
    [confirmed],
  );

  const ledger = useMemo(
    () =>
      [...payments].sort((a, b) => {
        if (a.paidOn !== b.paidOn) return a.paidOn < b.paidOn ? 1 : -1;
        return a.createdAt < b.createdAt ? 1 : -1;
      }),
    [payments],
  );

  const byId = useMemo(
    () => new Map(payments.map((p) => [p.id, p])),
    [payments],
  );

  const unmatchedCount = ledger.filter((p) => !p.ownerId).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Payments</h1>
        <Button
          size="sm"
          onClick={() => {
            setCorrecting(null);
            setFormOpen(true);
          }}
        >
          <Plus /> Add payment
        </Button>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Computed balances — from the database views, not the ledger rows. */}
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Owner balances</CardTitle>
            <CardDescription>
              Computed by the database from entries and ledger. If this and the
              ledger disagree, something is wrong — neither is editable here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2">
                  <tr>
                    <th className={TH}>Owner</th>
                    <th className={cn(TH, "text-right")}>Entries</th>
                    <th className={cn(TH, "text-right")}>Due</th>
                    <th className={cn(TH, "text-right")}>Paid</th>
                    <th className={cn(TH, "text-right")}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmed.map((o) => {
                    const balance = o.dueCents - o.paidCents;
                    return (
                      <tr
                        key={o.id}
                        className="h-12 border-b border-border/60 transition-colors duration-150 ease-out last:border-0 hover:bg-surface-2/60 sm:h-10"
                      >
                        <td className="whitespace-nowrap px-3 font-medium">
                          {o.firstName} {o.lastName}
                        </td>
                        <td className="whitespace-nowrap px-3 text-right tabular-nums">
                          {o.paidEntryCount}
                        </td>
                        <td className="whitespace-nowrap px-3 text-right tabular-nums">
                          {formatCents(o.dueCents)}
                        </td>
                        <td className="whitespace-nowrap px-3 text-right tabular-nums">
                          {formatCents(o.paidCents)}
                        </td>
                        <td className="whitespace-nowrap px-3 text-right tabular-nums">
                          {balance === 0 ? (
                            <Check
                              className="ml-auto size-4 text-win"
                              aria-label="Settled"
                            />
                          ) : (
                            <span
                              className={
                                balance > 0 ? "text-loss" : "text-tie"
                              }
                            >
                              {formatCents(balance)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {confirmed.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-muted-foreground"
                      >
                        No confirmed owners yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                {confirmed.length > 0 ? (
                  <tfoot>
                    <tr className="h-10 border-t border-border bg-surface-2 font-medium">
                      <td className="whitespace-nowrap px-3">Total</td>
                      <td className="whitespace-nowrap px-3 text-right tabular-nums">
                        {totals.entries}
                      </td>
                      <td className="whitespace-nowrap px-3 text-right tabular-nums">
                        {formatCents(totals.due)}
                      </td>
                      <td className="whitespace-nowrap px-3 text-right tabular-nums">
                        {formatCents(totals.paid)}
                      </td>
                      <td className="whitespace-nowrap px-3 text-right tabular-nums">
                        {totals.due - totals.paid === 0 ? (
                          <Check
                            className="ml-auto size-4 text-win"
                            aria-label="Settled"
                          />
                        ) : (
                          <span
                            className={
                              totals.due - totals.paid > 0
                                ? "text-loss"
                                : "text-tie"
                            }
                          >
                            {formatCents(totals.due - totals.paid)}
                          </span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </CardContent>
        </Card>

        {/* The raw ledger — append only. */}
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Ledger</CardTitle>
            <CardDescription>
              Append-only. Corrections are new rows referencing what they
              correct — nothing here is ever edited or deleted.
              {unmatchedCount > 0
                ? ` ${unmatchedCount} unmatched row${unmatchedCount === 1 ? "" : "s"} in quarantine.`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TooltipProvider>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2">
                    <tr>
                      <th className={TH}>Date</th>
                      <th className={TH}>Owner</th>
                      <th className={cn(TH, "text-right")}>Amount</th>
                      <th className={TH}>Method</th>
                      <th className={TH}>Venmo txn</th>
                      <th className={TH}>Note</th>
                      <th className={TH}>
                        <span className="sr-only">Corrects</span>
                      </th>
                      <th className={TH}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((p) => {
                      const corrected = p.correctsPaymentId
                        ? (byId.get(p.correctsPaymentId) ?? null)
                        : null;
                      return (
                        <tr
                          key={p.id}
                          className="h-12 border-b border-border/60 transition-colors duration-150 ease-out last:border-0 hover:bg-surface-2/60 sm:h-10"
                        >
                          <td className="whitespace-nowrap px-3 tabular-nums">
                            {formatPaidOn(p.paidOn)}
                          </td>
                          <td className="whitespace-nowrap px-3">
                            {p.ownerId ? (
                              p.ownerName
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-tie/40 bg-tie/10 text-tie"
                              >
                                Unmatched
                              </Badge>
                            )}
                          </td>
                          <td
                            className={cn(
                              "whitespace-nowrap px-3 text-right tabular-nums",
                              p.amountCents < 0 && "text-loss",
                            )}
                          >
                            {formatCents(p.amountCents)}
                          </td>
                          <td
                            className={cn(
                              "whitespace-nowrap px-3",
                              p.method === "correction"
                                ? "text-tie"
                                : "text-muted-foreground",
                            )}
                          >
                            {p.method}
                          </td>
                          <td className="whitespace-nowrap px-3">
                            {p.venmoTxnId ? (
                              <span
                                className="font-mono text-xs"
                                title={p.venmoTxnId}
                              >
                                {p.venmoTxnId.length > 12
                                  ? `${p.venmoTxnId.slice(0, 12)}…`
                                  : p.venmoTxnId}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="max-w-[14rem] truncate px-3 text-muted-foreground">
                            {p.note ?? ""}
                          </td>
                          <td className="whitespace-nowrap px-3">
                            {p.correctsPaymentId ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <CornerUpLeft
                                      className="size-3.5 text-tie"
                                      aria-label="Correction"
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {corrected
                                    ? `Corrects ${corrected.ownerName ?? "Unmatched"} · ${formatCents(corrected.amountCents)} on ${formatPaidOn(corrected.paidOn)} (${corrected.id.slice(0, 8)}…)`
                                    : `Corrects payment ${p.correctsPaymentId}`}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-3 text-right">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => {
                                setCorrecting(p);
                                setFormOpen(true);
                              }}
                            >
                              <Undo2 /> Correct
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {ledger.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-10 text-center text-muted-foreground"
                        >
                          No payments recorded yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      </div>

      {formOpen ? (
        <PaymentFormDialog
          owners={owners}
          correcting={correcting}
          onClose={() => setFormOpen(false)}
        />
      ) : null}
    </div>
  );
}
