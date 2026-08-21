import type { Metadata } from "next";
import Link from "next/link";
import { getAdminData } from "@/lib/data/admin";
import { formatCents } from "@/lib/pool";
import { formatEtDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SheetsExportButton } from "@/components/admin/sheets-export-button";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  const data = getAdminData();
  const [owners, entries, payments, audit] = await Promise.all([
    data.listOwners(),
    data.listEntries(),
    data.listPayments(),
    data.auditTail(50),
  ]);
  const lastExport =
    audit.find((a) => a.action === "sheets_export")?.at ?? null;

  const confirmed = owners.filter((o) => o.participationStatus === "confirmed");
  const liveEntries = entries.filter((e) => !e.voidedAt);
  const dueCents = confirmed.reduce((s, o) => s + o.dueCents, 0);
  const paidCents = confirmed.reduce((s, o) => s + o.paidCents, 0);
  const unmatched = payments.filter((p) => !p.ownerId);
  const outstanding = confirmed.filter((o) => o.paidCents < o.dueCents);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Admin</h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/admin/picks">Enter picks</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/payments">Add payment</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/import">Import Lynne file</Link>
          </Button>
        </div>
      </div>

      <SheetsExportButton lastExportAt={lastExport} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Collected
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl tabular-nums">
            {formatCents(paidCents)}
            <span className="text-sm text-muted-foreground">
              {" "}
              / {formatCents(dueCents)}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Owners owing
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl tabular-nums">
            {outstanding.length}
            <span className="text-sm text-muted-foreground">
              {" "}
              of {confirmed.length}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Entries
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl tabular-nums">
            {liveEntries.length}
            {entries.length !== liveEntries.length ? (
              <span className="text-sm text-muted-foreground">
                {" "}
                (+{entries.length - liveEntries.length} voided)
              </span>
            ) : null}
          </CardContent>
        </Card>
        <Card className="bg-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Unmatched payments
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl tabular-nums">
            {unmatched.length}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Audit log</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No writes recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {audit.slice(0, 15).map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <span
                    className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {formatEtDateTime(a.at)}
                  </span>
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground">
                    {a.targetTable}
                  </span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {a.actor}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
