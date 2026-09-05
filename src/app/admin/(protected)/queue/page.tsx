import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import type { PendingAction } from "@/lib/data/admin-types";
import { QueueClient } from "@/components/admin/queue/queue-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Queue" };

// NEEDS ANTHONY, as rows. The hourly sweep stages what it may not act on by
// itself through admin_stage_pending; each open row is listed here with
// Approve and Dismiss. Approve applies the row only by calling an existing
// admin_* RPC chosen by kind inside admin_approve_pending, so the ledger, the
// mint trigger and the audit rule all hold; a kind with no RPC is recorded as
// approved and left for the relevant screen. Gated by the (protected)
// layout's requireAdmin, exactly like payments and audit.
export default async function AdminQueuePage() {
  // The migration is applied by hand after the SQL suites pass. Until then
  // the table is absent and the read fails; say so rather than 500.
  let rows: PendingAction[] = [];
  let unavailable: string | null = null;
  try {
    rows = await getAdminData().listPendingActions();
  } catch (e) {
    unavailable = e instanceof Error ? e.message : String(e);
  }
  if (unavailable) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Queue</h1>
        <p className="text-sm text-muted-foreground">
          The queue table is not available. If migration 20260905000063 has
          not been applied yet, that is why.
        </p>
        <p className="font-mono text-xs text-muted-foreground">{unavailable}</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Queue</h1>
        <p className="text-sm text-muted-foreground">
          What the sweep found and could not decide. Approve applies it,
          Dismiss records that it should not be. Both are audited.
        </p>
      </div>
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">
            {rows.length} open {rows.length === 1 ? "item" : "items"}
          </CardTitle>
          <CardDescription>
            Payments, picks and entry top-ups are applied on Approve through
            the same RPCs the admin screens use. Anything else is marked
            approved and still has to be entered by hand on its own screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueueClient rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
