import type { Metadata } from "next";
import Link from "next/link";
import { getAdminData } from "@/lib/data/admin";
import { getData } from "@/lib/data";
import { DEFAULT_PRICING, formatCents, lynneRemittanceCents } from "@/lib/pool";
import { computeMargin, freeEntitlement } from "@/lib/free-entries";
import { duplicateTeamRisks } from "@/lib/alive";
import { formatEtDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SheetsExportButton } from "@/components/admin/sheets-export-button";
import { PoolPotForm } from "@/components/admin/pool-pot-form";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  const data = getAdminData();
  const pub = getData();
  const [
    owners,
    entries,
    payments,
    audit,
    weeks,
    pubEntries,
    cells,
    config,
    pot,
  ] = await Promise.all([
    data.listOwners(),
    data.listEntries(),
    data.listPayments(),
    data.auditTail(50),
    pub.getWeeks(),
    data.listEntrySummaries(),
    data.listGridCells(),
    data.getConfig(),
    pub.getPot(),
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

  // Renamed after Lynne already had them: her list — and the numbers she
  // will send back — still carry the old name until she is told.
  const renamedSinceSubmission = entries.filter(
    (e) =>
      !e.voidedAt &&
      e.submittedToLynneAt !== null &&
      e.submittedAsName !== null &&
      e.submittedAsName !== e.entryName,
  );

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

  // Free-entry rule: FLOOR(recruited / ratio) free entries, mine only,
  // auto-created by the sync after every entry change. Here we surface
  // discrepancies and new AAA entries still needing Lynne numbers.
  const liveAll = entries.filter((e) => !e.voidedAt);
  const recruitedCount = liveAll.filter((e) => !e.isFreeEntry).length;
  const entitlement = freeEntitlement(recruitedCount, config.freeEntryRatio);
  const myFree = liveAll.filter((e) => e.isFreeEntry);
  const freeNeedingNumber = myFree.filter((e) => e.lynneNumber === null);

  const confirmed = owners.filter((o) => o.participationStatus === "confirmed");
  const liveEntries = entries.filter((e) => !e.voidedAt);
  const dueCents = confirmed.reduce((s, o) => s + o.dueCents, 0);
  const paidCents = confirmed.reduce((s, o) => s + o.paidCents, 0);
  // ADMIN-ONLY margin figures — behind the same gate as payments, never
  // on a public route or player-reachable export.
  const margin = computeMargin(liveAll, paidCents, {
    ...DEFAULT_PRICING,
    tier13Cents: config.tier13Cents,
    tier4PlusCents: config.tier4PlusCents,
    lynneRateCents: config.lynneRateCents,
    freeEntryRatio: config.freeEntryRatio,
  });
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
            .map(
              (w) =>
                `week ${w.week} has ${w.missing} alive ${w.missing === 1 ? "entry" : "entries"} without a pick`,
            )
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
          <span className="font-bold">
            ⚠ DUPLICATE TEAM — elimination risk:
          </span>{" "}
          {dupRisks
            .map(
              (d) =>
                `${d.entryName} has ${d.team} in weeks ${d.weeks.join(" and ")}`,
            )
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
            {nextLockMissing.length === 1 ? "entry" : "entries"} still without a
            pick
          </span>{" "}
          — first lock in{" "}
          {hoursToLock < 1 ? "under an hour" : `${Math.round(hoursToLock)}h`}:{" "}
          {nextLockMissing
            .slice(0, 8)
            .map((e) => e.entryName)
            .join(", ")}
          {nextLockMissing.length > 8
            ? ` +${nextLockMissing.length - 8} more`
            : ""}
        </Link>
      ) : null}
      {liveNoNumber > 0 ? (
        <Link
          href="/admin/entries"
          className="block rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie"
        >
          {liveNoNumber} {liveNoNumber === 1 ? "entry has" : "entries have"} no
          Lynne number — they cannot go on the weekly submission block. Set them
          on the Entries screen.
        </Link>
      ) : null}
      {renamedSinceSubmission.length > 0 ? (
        <Link
          href="/admin/entries"
          className="block rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie"
        >
          <span className="font-semibold">
            {renamedSinceSubmission.length}{" "}
            {renamedSinceSubmission.length === 1 ? "entry was" : "entries were"}{" "}
            renamed after Lynne got the list
          </span>{" "}
          —{" "}
          {renamedSinceSubmission
            .map((e) => `${e.submittedAsName} → ${e.entryName}`)
            .join(", ")}
          . Send her the corrections (Roster for Lynne → Renamed), then mark her
          list current. Until then her numbers come back under the old names —
          the import still matches them.
        </Link>
      ) : null}
      {unconfirmedWeeks > 0 ? (
        <Link
          href="/admin/weeks"
          className="block rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie"
        >
          {unconfirmedWeeks} week{" "}
          {unconfirmedWeeks === 1 ? "deadline" : "deadlines"} still unconfirmed
          — verify them against the released NFL schedule on the Weeks screen.
        </Link>
      ) : null}
      {freeNeedingNumber.length > 0 ? (
        <Link
          href="/admin/entries"
          className="block rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie"
        >
          <span className="font-semibold">
            {freeNeedingNumber.length} free{" "}
            {freeNeedingNumber.length === 1 ? "entry needs" : "entries need"} a
            Lynne number
          </span>{" "}
          — {freeNeedingNumber.map((e) => e.entryName).join(", ")}. She numbers
          everyone; register these before submitting picks for them.
        </Link>
      ) : null}
      {myFree.length < entitlement ? (
        <Link
          href="/admin/entries"
          className="block rounded-md border border-loss/50 bg-loss/10 px-3 py-2.5 text-sm text-loss"
        >
          <span className="font-semibold">
            Free entries behind the rule: {myFree.length} exist, {entitlement}{" "}
            earned
          </span>{" "}
          (FLOOR({recruitedCount} recruited / {config.freeEntryRatio})). The
          sync creates them on the next entry change — or add the missing AAA on
          the Entries screen.
        </Link>
      ) : null}
      {myFree.length > entitlement ? (
        <Link
          href="/admin/entries"
          className="block rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie"
        >
          <span className="font-semibold">
            Free entries above the rule: {myFree.length} exist, only{" "}
            {entitlement} earned
          </span>{" "}
          — recruited count dropped. Nothing is auto-deleted; decide whether to
          void an AAA entry.
        </Link>
      ) : null}

      <SheetsExportButton lastExportAt={lastExport} />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Data backup</p>
          <p className="text-xs text-muted-foreground">
            The free plan keeps no backups. One file restores everything: build
            a fresh database from the repo migrations, run this file in the SQL
            editor, done. Download one after every data day.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <a href="/api/admin/backup" download>
            Download backup (.sql)
          </a>
        </Button>
      </div>

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

      {/* POOL POT — Lynne's whole pool. Public by design once set: this is
          pool information, unlike the margin panel below. */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">
            Pool pot — Lynne&apos;s full pool
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {pot.poolPotCents === null && pot.poolEntryCount === null ? (
              <>
                Not set — the public dashboard shows &quot;Pending&quot; until
                Lynne confirms the 2026 pool size.
              </>
            ) : (
              <>
                Public card currently reads{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {pot.poolPotCents === null
                    ? "Pending"
                    : formatCents(pot.poolPotCents)}
                </span>
                {pot.poolEntryCount !== null ? (
                  <>
                    {" "}
                    across{" "}
                    <span className="tabular-nums">
                      {pot.poolEntryCount.toLocaleString()}
                    </span>{" "}
                    pool entries
                  </>
                ) : null}
                .
              </>
            )}
          </p>
          <PoolPotForm
            entryCount={pot.poolEntryCount}
            potCents={pot.poolPotCents}
          />
        </CardContent>
      </Card>

      {/* MARGIN — admin eyes only. Never on a public route, never in a
          player-reachable export. */}
      <Card className="border-primary/30 bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Margin — private</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Collected from recruits</dt>
              <dd className="font-medium tabular-nums">
                {formatCents(margin.collectedCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                Owed to Lynne ({margin.recruited} ×{" "}
                {formatCents(config.lynneRateCents)})
              </dt>
              <dd className="font-medium tabular-nums">
                {formatCents(margin.owedLynneCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                Spread margin ({margin.spreadEntryCount} entries at{" "}
                {formatCents(config.tier13Cents)} ×{" "}
                {formatCents(config.tier13Cents - config.lynneRateCents)})
              </dt>
              <dd className="font-medium tabular-nums text-win">
                {formatCents(margin.spreadCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                Free entries earned ({margin.freeCount} ×{" "}
                {formatCents(config.lynneRateCents)} notional)
              </dt>
              <dd className="font-medium tabular-nums text-win">
                {formatCents(margin.freeNotionalCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border/60 pt-2 sm:col-span-2">
              <dt className="font-semibold">
                Net position (spread + free value)
              </dt>
              <dd className="font-semibold tabular-nums text-win">
                {formatCents(margin.netCents)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {margin.recruited} recruited + {margin.freeCount} free ={" "}
            {margin.totalEntries} total entries. Remittance covers recruited
            only ({formatCents(lynneRemittanceCents(margin.recruited))}). Cash
            today: {formatCents(margin.collectedCents)} collected vs{" "}
            {formatCents(margin.owedLynneCents)} owed her.
          </p>
        </CardContent>
      </Card>

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
                  <span className="text-muted-foreground">{a.targetTable}</span>
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
