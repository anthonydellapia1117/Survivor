import type { Metadata } from "next";
import Link from "next/link";
import { getAdminData } from "@/lib/data/admin";
import { getData } from "@/lib/data";
import { DEFAULT_PRICING, formatCents, freeEntryStatus } from "@/lib/pool";
import { duplicateTeamRisks } from "@/lib/alive";
import { formatEtDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SheetsExportButton } from "@/components/admin/sheets-export-button";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  const data = getAdminData();
  const pub = getData();
  const [owners, entries, payments, audit, weeks, pubEntries, cells, config] =
    await Promise.all([
      data.listOwners(),
      data.listEntries(),
      data.listPayments(),
      data.auditTail(50),
      pub.getWeeks(),
      data.listEntrySummaries(),
      data.listGridCells(),
      data.getConfig(),
    ]);
  const lastExport =
    audit.find((a) => a.action === "sheets_export")?.at ?? null;

  // Safety alerts: a passed deadline with pickless alive entries means the
  // sweep is pending and standings are silently wrong until it runs.
  const now = Date.now();
  const alive = pubEntries.filter((e) => e.status !== "eliminated");
  const pickedByWeek = new Map<number, Set<string>>();
  for (const c of cells) {
    if (!pickedByWeek.has(c.week)) pickedByWeek.set(c.week, new Set());
    pickedByWeek.get(c.week)!.add(c.entryId);
  }
  const sweepPending = weeks
    .filter((w) => new Date(w.deadlineAt).getTime() <= now)
    .map((w) => ({
      week: w.week,
      missing: alive.filter((e) => !pickedByWeek.get(w.week)?.has(e.id)).length,
    }))
    .filter((w) => w.missing > 0);
  const unconfirmedWeeks = weeks.filter((w) => !w.confirmed).length;

  // F3: entries with no lynne_number cannot go on the weekly submission.
  const liveNoNumber = entries.filter(
    (e) => !e.voidedAt && e.lynneNumber === null,
  ).length;

  // F3/E2: missing picks for the next lock, sorted by urgency; pulses
  // when the deadline is under 6 hours.
  const nextLock = weeks
    .filter((w) => new Date(w.deadlineAt).getTime() > now)
    .sort((a, b) => +new Date(a.deadlineAt) - +new Date(b.deadlineAt))[0];
  const nextLockMissing = nextLock
    ? alive.filter((e) => !pickedByWeek.get(nextLock.week)?.has(e.id))
    : [];
  const hoursToLock = nextLock
    ? (new Date(nextLock.earlyDeadlineAt).getTime() - now) / 3600000
    : Infinity;

  // C3: a current pick reusing a team is an elimination in Lynne's pool.
  const entryNameById = new Map(pubEntries.map((e) => [e.id, e.entryName]));
  const dupRisks = duplicateTeamRisks(cells).map((d) => ({
    ...d,
    entryName: entryNameById.get(d.entryId) ?? d.entryId,
  }));

  // Free entries: FLOOR(covered paid entries / ratio), earned as payments
  // land. Earned-but-unnamed ones must be named and registered with Lynne
  // before Week 1 picks lock — nobody notices this on their own.
  const namedFree = entries.filter((e) => e.isFreeEntry && !e.voidedAt).length;
  const free = freeEntryStatus(owners, namedFree, {
    ...DEFAULT_PRICING,
    freeEntryRatio: config.freeEntryRatio,
  });

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
            <Link href="/admin/quick">Quick add</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/admin/week/${weeks.find((w) => new Date(w.deadlineAt).getTime() > now)?.week ?? 18}`}
            >
              Week cockpit
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
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

      {sweepPending.length > 0 ? (
        <Link
          href="/admin/deadline"
          className="block rounded-md border border-loss/50 bg-loss/10 px-3 py-2.5 text-sm text-loss"
        >
          <span className="font-semibold">Sweep pending:</span>{" "}
          {sweepPending
            .map((w) => `week ${w.week} has ${w.missing} alive ${w.missing === 1 ? "entry" : "entries"} without a pick`)
            .join("; ")}{" "}
          past the deadline. Standings are wrong until the missed-pick sweep
          runs — go to the Deadline screen.
        </Link>
      ) : null}
      {dupRisks.length > 0 ? (
        <Link
          href="/admin/picks"
          className="block rounded-md border border-loss bg-loss/15 px-3 py-2.5 text-sm text-loss"
        >
          <span className="font-bold">⚠ DUPLICATE TEAM — elimination risk:</span>{" "}
          {dupRisks
            .map((d) => `${d.entryName} has ${d.team} in weeks ${d.weeks.join(" and ")}`)
            .join("; ")}
          . In Lynne&apos;s pool this puts the entry OUT.
        </Link>
      ) : null}
      {nextLock && nextLockMissing.length > 0 && hoursToLock < 72 ? (
        <Link
          href="/admin/picks"
          className={
            hoursToLock < 6
              ? "block animate-pulse rounded-md border border-loss/60 bg-loss/15 px-3 py-2.5 text-sm text-loss"
              : "block rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie"
          }
        >
          <span className="font-semibold">
            Week {nextLock.week}: {nextLockMissing.length}{" "}
            {nextLockMissing.length === 1 ? "entry" : "entries"} still without
            a pick
          </span>{" "}
          — first lock in {hoursToLock < 1 ? "under an hour" : `${Math.round(hoursToLock)}h`}:{" "}
          {nextLockMissing.slice(0, 8).map((e) => e.entryName).join(", ")}
          {nextLockMissing.length > 8 ? ` +${nextLockMissing.length - 8} more` : ""}
        </Link>
      ) : null}
      {liveNoNumber > 0 ? (
        <Link
          href="/admin/entries"
          className="block rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie"
        >
          {liveNoNumber} {liveNoNumber === 1 ? "entry has" : "entries have"} no
          Lynne number — they cannot go on the weekly submission block. Set
          them on the Entries screen.
        </Link>
      ) : null}
      {unconfirmedWeeks > 0 ? (
        <Link
          href="/admin/weeks"
          className="block rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie"
        >
          {unconfirmedWeeks} week {unconfirmedWeeks === 1 ? "deadline" : "deadlines"} still
          unconfirmed — verify them against the released NFL schedule on the
          Weeks screen.
        </Link>
      ) : null}
      {free.unnamed > 0 ? (
        <Link
          href="/admin/entries"
          className="block rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie"
        >
          <span className="font-semibold">
            {free.unnamed} free {free.unnamed === 1 ? "entry" : "entries"} earned
            but not yet named
          </span>{" "}
          — {free.covered} paid entries are covered by payments (1 free per{" "}
          {config.freeEntryRatio}). Name {free.unnamed === 1 ? "it" : "them"} on
          the Entries screen and register with Lynne before Week 1 picks lock.
        </Link>
      ) : null}
      {free.overNamed > 0 ? (
        <Link
          href="/admin/entries"
          className="block rounded-md border border-loss/50 bg-loss/10 px-3 py-2.5 text-sm text-loss"
        >
          <span className="font-semibold">
            More free entries named ({free.named}) than earned ({free.earned})
          </span>{" "}
          — only {free.covered} paid entries are covered by payments so far.
          Check the Free flags on the Entries screen.
        </Link>
      ) : null}

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
