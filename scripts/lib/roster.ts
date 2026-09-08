// The roster as the local commands see it, built on the same rule the admin
// screens use: recipientsForPicks decides who is asked for which entry, so
// a giftee gets their own message and an addressless gift goes on nobody's.

import { recipientsForPicks, type RecipientOwner, type RecipientSplit } from "@/lib/emails/recipients";
import { teamDeadlines } from "@/lib/deadlines";
import type { EntryRow, OwnerRow, StandingRow } from "./db";
import type { GameLite, WeekBounds } from "../picks/lib/deadline";

/** Confirmed, undeleted owners only: a declined owner is not on any list. */
export function confirmedOwners(owners: OwnerRow[]): OwnerRow[] {
  return owners.filter((o) => o.participation_status === "confirmed");
}

/**
 * Live entries of confirmed owners: the set every command acts on. Changing
 * an owner's participation_status does not void their entries, so a
 * declined owner's rows are still on the table and must be left off here,
 * the same line the app's views draw.
 */
export function entriesOfConfirmedOwners(owners: OwnerRow[], entries: EntryRow[]): EntryRow[] {
  const confirmed = new Set(confirmedOwners(owners).map((o) => o.id));
  return entries.filter((e) => e.voided_at === null && confirmed.has(e.owner_id));
}

export function ownerFullName(o: OwnerRow): string {
  return `${o.first_name} ${o.last_name}`.trim();
}

/** First name where there is one, the way the pick-request screen greets. */
export function ownerGreeting(o: OwnerRow): string {
  const first = o.first_name.trim();
  return first || ownerFullName(o);
}

/**
 * The owners-with-entries shape recipientsForPicks takes, restricted to the
 * entries `include` keeps. Owners left with no entries are dropped, and an
 * owner who is not confirmed contributes nothing.
 */
export function buildRecipientOwners(
  owners: OwnerRow[],
  entries: EntryRow[],
  include: (e: EntryRow) => boolean,
): RecipientOwner[] {
  const byOwner = new Map<string, EntryRow[]>();
  for (const e of entries) {
    if (e.voided_at !== null || !include(e)) continue;
    byOwner.set(e.owner_id, [...(byOwner.get(e.owner_id) ?? []), e]);
  }
  const out: RecipientOwner[] = [];
  for (const o of confirmedOwners(owners)) {
    const mine = byOwner.get(o.id);
    if (!mine || mine.length === 0) continue;
    out.push({
      id: o.id,
      greetingName: ownerGreeting(o),
      fullName: ownerFullName(o),
      email: o.email,
      entries: mine.map((e) => ({
        id: e.id,
        entryName: e.entry_name,
        isGifted: e.is_gifted,
        playerEmail: e.player_email,
      })),
    });
  }
  return out;
}

/** Who is asked for the entries `include` keeps, and who cannot be. */
export function splitRecipients(
  owners: OwnerRow[],
  entries: EntryRow[],
  include: (e: EntryRow) => boolean,
): RecipientSplit {
  return recipientsForPicks(buildRecipientOwners(owners, entries, include));
}

/**
 * Live entries with no current pick for the week that are still playing.
 * An eliminated entry has nothing to pick; a voided one is not on the roster.
 */
/**
 * The entries that still take a pick: live, and alive on the app's own
 * standings. An eliminated entry is off the intake roster (the pick-email
 * screen filters by standing the same way), and so is one with no standings
 * row, which is not on the roster the views carry; both are returned by
 * name so the command prints them rather than dropping them silently.
 */
export function aliveEntries(
  entries: EntryRow[],
  standings: StandingRow[],
): { alive: EntryRow[]; out: { entry: EntryRow; why: string }[] } {
  const status = new Map(standings.map((s) => [s.entry_id, s.status]));
  const alive: EntryRow[] = [];
  const out: { entry: EntryRow; why: string }[] = [];
  for (const e of entries) {
    if (e.voided_at !== null) continue;
    const st = status.get(e.id);
    if (st === undefined) out.push({ entry: e, why: "no standings row" });
    else if (st === "eliminated") out.push({ entry: e, why: "eliminated" });
    else alive.push(e);
  }
  return { alive, out };
}

export function unpickedEntries(
  entries: EntryRow[],
  currentPickEntryIds: Iterable<string>,
  standings: StandingRow[],
): EntryRow[] {
  const picked = new Set(currentPickEntryIds);
  const status = new Map(standings.map((s) => [s.entry_id, s.status]));
  return entries.filter(
    (e) => e.voided_at === null && !picked.has(e.id) && status.get(e.id) !== "eliminated",
  );
}

export interface OpenDeadline {
  /** ISO time of the earliest deadline still ahead of `now`. */
  deadlineIso: string;
  /** Teams whose picks close at that deadline. */
  teams: string[];
  /** The week's final boundary (Friday noon), for the rest of the teams. */
  lateDeadlineIso: string;
}

/**
 * The earliest deadline still ahead of `now` among the week's games, leaving
 * out `excludeTeams` (teams an entry has already used, so cannot pick).
 * Null when every tier has closed.
 */
export function earliestOpenDeadline(
  games: GameLite[],
  bounds: WeekBounds,
  now: Date,
  excludeTeams: Iterable<string> = [],
): OpenDeadline | null {
  const excluded = new Set(excludeTeams);
  const byTeam = teamDeadlines(
    games.filter((g) => g.week === bounds.week),
    bounds.earlyDeadlineAt,
    bounds.lateDeadlineAt,
  );
  let best: { at: number; iso: string } | null = null;
  const teamsAt = new Map<string, string[]>();
  for (const [team, iso] of byTeam) {
    if (excluded.has(team)) continue;
    const at = new Date(iso).getTime();
    if (at <= now.getTime()) continue;
    teamsAt.set(iso, [...(teamsAt.get(iso) ?? []), team]);
    if (!best || at < best.at) best = { at, iso };
  }
  if (!best) return null;
  return {
    deadlineIso: best.iso,
    teams: (teamsAt.get(best.iso) ?? []).sort(),
    lateDeadlineIso: bounds.lateDeadlineAt,
  };
}

/**
 * The addresses the picks intake reads mail from: every confirmed owner's
 * own address and every player_email on their live entries, once each,
 * never the admin's own mailbox. The free entries sit under the admin's
 * owner row, so without the exclusion every self-sent mail (a chase or
 * distribute copy, a DECISION note) would be read as a player's picks.
 */
export function intakeAddresses(owners: OwnerRow[], entries: EntryRow[], adminMailbox: string): string[] {
  const admin = adminMailbox.trim().toLowerCase();
  const confirmed = new Set(confirmedOwners(owners).map((o) => o.id));
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (a: string | null) => {
    const key = (a ?? "").trim().toLowerCase();
    if (!key || key === admin || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const o of confirmedOwners(owners)) add(o.email);
  for (const e of entries) {
    if (e.voided_at !== null || !confirmed.has(e.owner_id)) continue;
    add(e.player_email);
  }
  return out;
}
