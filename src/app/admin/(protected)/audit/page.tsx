import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import { AuditClient } from "@/components/admin/audit/audit-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit log" };

// Every admin write in this app lands in audit_log. The table is fed by the
// same transactional RPCs that do the writing, so it is complete by
// construction — it just had nowhere to be read. Gated by the (protected)
// layout's requireAdmin, exactly like payments.
const AUDIT_LIMIT = 1000;

export default async function AdminAuditPage() {
  const rows = await getAdminData().auditTail(AUDIT_LIMIT);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every write, with what actually changed. Read-only.
        </p>
      </div>
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">
            {rows.length} recorded {rows.length === 1 ? "write" : "writes"}
          </CardTitle>
          <CardDescription>
            Update rows store the whole record twice, so each one is shown as
            the fields that changed. Open a row for the full detail, including
            the raw payload.
            {rows.length >= AUDIT_LIMIT
              ? ` Showing the most recent ${AUDIT_LIMIT}.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditClient rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
