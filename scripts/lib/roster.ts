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

// --------------------------------------------------------- retired addresses
//
// The incident this exists for: on 2026-09-09 a Week 1 reminder went to a
// HAND-BUILT Bcc list that still carried ernie706@gmail.com. That mailbox does
// not exist and the message hard-bounced 550 5.1.1. The owner's real address,
// dellapia706@gmail.com, was corrected in the database the same day, so the
// dead address is already gone from every table a send derives from.
//
// It survives only in HISTORY - owners.notes, two audit_log rows and one
// pending_actions bounce record - and history is append-only: scrubbing the
// record of a bounce destroys the evidence the bounce happened, which is the
// opposite of this fix. So this list is not a data cleanup. It is a checked-in
// statement that these addresses are dead, and the guard below proves a
// derived recipient list cannot carry one back in.

export interface RetiredAddress {
  /** The dead address, as it was last seen. Compared case-insensitively. */
  address: string;
  /** ISO date it was retired. */
  retiredOn: string;
  /** Why it is dead, and what replaced it where anything did. */
  reason: string;
}

/**
 * Every address that must never reach a send again. Adding one is a reviewed
 * change to this list, never a flag and never a runtime lookup: a dead address
 * is a fact about the world, and the checked-in file is where this project
 * keeps facts a run must not be able to talk itself out of.
 */
export const RETIRED_ADDRESSES: readonly RetiredAddress[] = [
  {
    address: "ernie706@gmail.com",
    retiredOn: "2026-09-09",
    reason:
      "Does not exist; hard-bounced 550 5.1.1 on the Week 1 reminder, which went to a hand-built Bcc list. The owner's real address is dellapia706@gmail.com and the database was corrected the same day.",
  },
];

/** One comparison shape for every address here: trimmed copy, lower-cased. */
function addressKey(address: string): string {
  return address.trim().toLowerCase();
}

const RETIRED_KEYS: ReadonlySet<string> = new Set(RETIRED_ADDRESSES.map((r) => addressKey(r.address)));

/** True when this address is on the retired list, whatever its casing or padding. */
export function isRetiredAddress(address: string): boolean {
  return RETIRED_KEYS.has(addressKey(address));
}

/**
 * The retired addresses present in a list, returned AS GIVEN so the caller
 * prints the offending string rather than a normalized one - the casing or the
 * stray space is part of what went wrong. Empty when the list is clean.
 */
export function retiredAddressesIn(addresses: Iterable<string>): string[] {
  return [...addresses].filter((a) => isRetiredAddress(a));
}

/**
 * The list with every retired address removed. Order and the remaining strings
 * are untouched: this filters, it does not normalize, and a clean list comes
 * back exactly as it went in.
 */
export function withoutRetiredAddresses(addresses: Iterable<string>): string[] {
  return [...addresses].filter((a) => !isRetiredAddress(a));
}

/** Thrown by assertNoRetiredAddresses. Named so a caller can tell it apart. */
export class RetiredAddressError extends Error {
  readonly offenders: string[];
  constructor(offenders: string[], context: string) {
    super(
      `retired address in ${context}: ${offenders.join(", ")} - ` +
        `see RETIRED_ADDRESSES in scripts/lib/roster.ts. The roster this list was ` +
        `derived from is wrong; fix the roster, do not filter this away.`,
    );
    this.name = "RetiredAddressError";
    this.offenders = offenders;
  }
}

/**
 * Throw if a list about to be mailed carries a retired address.
 *
 * A silent filter is NOT enough, and that is the whole point. The retired
 * addresses are already gone from every table a send derives from, so a derived
 * list cannot contain one unless the roster itself has gone wrong - somebody
 * re-typed the dead address onto an owner, or a hand-built list crept back in,
 * which is exactly what caused the bounce. Quietly dropping it would send the
 * message to everyone else and leave nobody knowing the roster is wrong; the
 * owner it belongs to would go on having no working address and nobody would
 * find out until the next thing that needed to reach them. Failing loudly, by
 * name, stops the run and puts the broken row in front of a person.
 *
 * withoutRetiredAddresses is the filter for the places that want one - a
 * report, a preview, anything that is not a send. A send calls this.
 *
 * WHERE IT IS CALLED, and why those places (added 2026-09-10, after Copilot
 * and Codex both raised on #54 that the guard existed and nothing ran it):
 *
 *   scripts/lib/gmail.ts   encodeRaw          the narrowest point there is.
 *                                             Every messages.send in the repo
 *                                             takes raw: encodeRaw(m), and so
 *                                             does createDraft, so no caller
 *                                             can get a message out past it.
 *   scripts/lib/gmail.ts   createDraftReply   builds its own RFC 822 text and
 *                                             never reaches encodeRaw, so the
 *                                             backstop does not cover it.
 *   scripts/lib/send.ts    sendWeekReminder   BEFORE the claim row, so a
 *   scripts/lib/send.ts    sendAllowlisted    refusal cannot consume the slot
 *                                             or the recipient's lock day.
 *   scripts/remind/cli.ts  main               BEFORE the count gate, because
 *                                             counting cannot see a SWAP: a
 *                                             dead address typed onto an owner
 *                                             replaces that owner's live one
 *                                             and the total is still 40.
 *
 * The chase and distribute Bcc lists are covered by the encodeRaw backstop
 * alone and deliberately have no call of their own. Two checks on one list is
 * a second thing to keep in step; the backstop cannot be forgotten, which is
 * the property that matters.
 */
export function assertNoRetiredAddresses(
  addresses: Iterable<string>,
  context = "recipient list",
): void {
  const offenders = retiredAddressesIn(addresses);
  if (offenders.length > 0) throw new RetiredAddressError(offenders, context);
}
