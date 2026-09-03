import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { getAdminData } from "@/lib/data/admin";
import { buildPickRequests } from "@/lib/emails/pick-request";
import { PickEmailsClient } from "@/components/admin/emails/pick-emails-client";

export const metadata: Metadata = { title: "Pick emails" };

/**
 * Per-owner pick requests, generated for copying by hand.
 *
 * Read-only by construction: this route renders text and nothing else. There
 * is no send action and no public write path — Anthony copies each message
 * into Gmail himself, which is also what keeps the reply address his.
 */
export default async function PickEmailsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const pub = getData();
  const admin = getAdminData();
  const [owners, entries, weeks, games] = await Promise.all([
    admin.listOwners(),
    admin.listEntries(),
    pub.getWeeks(),
    pub.getSchedule(),
  ]);

  const now = Date.now();
  // Default to the week still open — the one he would be chasing picks for.
  const defaultWeek =
    weeks.find((w) => new Date(w.lateDeadlineAt).getTime() > now)?.week ??
    weeks.at(-1)?.week ??
    1;
  const requested = Number((await searchParams).week);
  const week =
    weeks.find((w) => w.week === requested) ??
    weeks.find((w) => w.week === defaultWeek) ??
    weeks[0];

  const live = entries.filter((e) => e.voidedAt === null);
  const byOwner = new Map<string, string[]>();
  for (const e of [...live].sort((a, b) => a.entryIndex - b.entryIndex)) {
    byOwner.set(e.ownerId, [...(byOwner.get(e.ownerId) ?? []), e.entryName]);
  }

  const batch = buildPickRequests(
    owners
      .filter((o) => o.participationStatus === "confirmed")
      .map((o) => ({
        id: o.id,
        greetingName:
          o.firstName.trim() || `${o.firstName} ${o.lastName}`.trim(),
        fullName: `${o.firstName} ${o.lastName}`.trim(),
        email: o.email,
        entryNames: byOwner.get(o.id) ?? [],
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    week,
    games,
  );

  return (
    <PickEmailsClient
      week={week.week}
      weeks={weeks.map((w) => w.week)}
      built={batch.built}
      skippedNoEmail={batch.skippedNoEmail}
    />
  );
}
