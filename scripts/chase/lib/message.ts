// The text of a chase, built from the roster's answer and the week's
// deadlines and nothing else, so it can be tested without Gmail or a
// database. Plain text, hyphens only. Every entry name is printed exactly as
// stored: never cased, never trimmed.

import type { GameDay } from "@/lib/data/types";
import { teamDeadlines } from "@/lib/deadlines";
import { CONTACT_PHONE } from "@/lib/emails/pick-request";
import { TEAM_NAME } from "@/lib/standing";
import type { OpenDeadline } from "../../lib/roster";
import { formatEt, gameDayFor, type GameLite, type WeekBounds } from "../../picks/lib/deadline";

export const SIGNOFF = "AD";

export function chaseSubject(week: number): string {
  return `Survivor - Week ${week} picks needed`;
}

/** The full name a player knows the team by; an unknown abbreviation is shown as is, never guessed at. */
export function fullTeamName(abbr: string): string {
  return TEAM_NAME[abbr] ?? abbr;
}

function at(iso: string): number {
  return new Date(iso).getTime();
}

// ------------------------------------------------------------- reconcile

export interface ReconcileCounts {
  /** Live entries with no current pick, straight from the roster. */
  liveUnpicked: number;
  /** Entries across every recipient who can be mailed. */
  mailable: number;
  /** Entries of owners who play them but have no address. */
  ownersWithoutEmail: number;
  /** Gifted entries with no player address: on nobody's message. */
  giftedWithoutEmail: number;
}

export interface Reconcile {
  ok: boolean;
  accounted: number;
  unmailable: number;
  /** The arithmetic, one term per line, for printing when it does not add up. */
  lines: string[];
}

/**
 * Every unpicked entry must land on exactly one of: a recipient's message, an
 * owner with no address, or a gifted entry with no address. If the three do
 * not sum to the live count, an entry has gone missing somewhere between the
 * roster and the messages, and nothing may be created until that is looked at.
 */
export function reconcile(c: ReconcileCounts): Reconcile {
  const unmailable = c.ownersWithoutEmail + c.giftedWithoutEmail;
  const accounted = c.mailable + unmailable;
  return {
    ok: accounted === c.liveUnpicked,
    accounted,
    unmailable,
    lines: [
      `entries on recipients' messages:  ${c.mailable}`,
      `entries of owners with no email:  ${c.ownersWithoutEmail}`,
      `gifted entries with no address:   ${c.giftedWithoutEmail}`,
      `accounted for:                    ${accounted}`,
      `live entries with no pick:        ${c.liveUnpicked}`,
    ],
  };
}

export function weekLine(week: number, recipients: number, mailableEntries: number, unmailable: number): string {
  const base = `Week ${week}: ${recipients} recipient${recipients === 1 ? "" : "s"}, ${mailableEntries} entr${
    mailableEntries === 1 ? "y" : "ies"
  } with no pick`;
  return unmailable ? `${base}, plus ${unmailable} unmailable` : base;
}

// ------------------------------------------------------------- deadlines

/** The earliest of several open deadlines; null when none is open. */
export function earliestOf(deadlines: (OpenDeadline | null)[]): OpenDeadline | null {
  let best: OpenDeadline | null = null;
  for (const d of deadlines) {
    if (!d) continue;
    if (!best || at(d.deadlineIso) < at(best.deadlineIso)) best = d;
  }
  return best;
}

/** One deadline still ahead, and the teams whose picks it closes. */
export interface Tier {
  deadlineIso: string;
  /** Abbreviations, sorted. */
  teams: string[];
  /** The one day every team in the tier plays; null when they do not share one (Sat, Sun and Mon share the late tier). */
  gameDay: GameDay | null;
}

/**
 * Every deadline still ahead of `now` for the week, earliest first, with the
 * teams each closes, leaving out `excludeTeams` (an entry's used teams).
 * Same derivation as earliestOpenDeadline, kept whole instead of taking the
 * first, because the message has to be right about every tier that is still
 * open, not only the next one: on Monday of Week 1 the Wednesday game closes
 * Tuesday noon AND the Thursday game closes Wednesday noon, and Week 12 has
 * three early tiers.
 */
export function openTiers(
  games: GameLite[],
  bounds: WeekBounds,
  now: Date,
  excludeTeams: Iterable<string> = [],
): Tier[] {
  const excluded = new Set(excludeTeams);
  const byTeam = teamDeadlines(
    games.filter((g) => g.week === bounds.week),
    bounds.earlyDeadlineAt,
    bounds.lateDeadlineAt,
  );
  const teamsAt = new Map<string, string[]>();
  for (const [team, iso] of byTeam) {
    if (excluded.has(team)) continue;
    if (at(iso) <= now.getTime()) continue;
    teamsAt.set(iso, [...(teamsAt.get(iso) ?? []), team]);
  }
  return [...teamsAt]
    .map(([iso, teams]) => {
      const sorted = [...teams].sort();
      const days = new Set(sorted.map((t) => gameDayFor(t, games, bounds.week)));
      const only = days.size === 1 ? [...days][0] : null;
      return { deadlineIso: iso, teams: sorted, gameDay: only };
    })
    .sort((a, b) => at(a.deadlineIso) - at(b.deadlineIso));
}

/**
 * One person's tiers across all their entries: a tier is open for the person
 * if it is open for any of their entries, and its teams are the union, so an
 * entry that has already used the Rams does not hide the Thursday game from
 * a sibling entry that has not.
 */
export function mergeTiers(lists: Tier[][]): Tier[] {
  const byIso = new Map<string, Tier>();
  for (const list of lists) {
    for (const t of list) {
      const cur = byIso.get(t.deadlineIso);
      if (!cur) byIso.set(t.deadlineIso, { ...t, teams: [...t.teams] });
      else cur.teams = [...new Set([...cur.teams, ...t.teams])].sort();
    }
  }
  return [...byIso.values()].sort((a, b) => at(a.deadlineIso) - at(b.deadlineIso));
}

/** "A or B"; three or more read "A, B or C". */
export function joinOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * The deadline paragraph. When only the late deadline is still open it is the
 * one sentence "Deadline: Fri Sep 11 12:00 PM ET." Otherwise each open early
 * tier is named with its teams, then the late deadline for everything else.
 */
export function deadlineParagraph(tiers: Tier[], lateDeadlineIso: string): string {
  const late = formatEt(lateDeadlineIso);
  const early = tiers.filter((t) => at(t.deadlineIso) < at(lateDeadlineIso) && t.teams.length > 0);
  if (early.length === 0) return `Deadline: ${late}.`;
  const clauses = early.map((t) => {
    const teams = joinOr(t.teams.map(fullTeamName));
    const day = t.gameDay ? ` (${t.gameDay} game)` : "";
    return `${formatEt(t.deadlineIso)} if you take ${teams}${day}`;
  });
  return `Deadline: ${clauses.join(", or ")}. Everything else this week closes ${late}.`;
}

// -------------------------------------------------------------- bodies

const MISSED = "A missed pick is a loss, and a team can only be used once all season.";

function replyLine(plural: boolean): string {
  return plural
    ? `Reply to this email with your picks, one team per entry, or text them to ${CONTACT_PHONE}.`
    : `Reply to this email with your pick, or text it to ${CONTACT_PHONE}.`;
}

export interface RecipientMessageInput {
  week: number;
  /** An owner's first name, or a giftee's entry names: whatever the recipient rule gave. */
  greetingName: string;
  /** As stored. Printed one per line, verbatim. */
  entryNames: string[];
  /**
   * A note after an entry name, keyed by that name: on a mixed message
   * (some entries the person owns, some bought for them) each gifted entry
   * says who bought it, so one message says plainly which is which
   * (CLAUDE.md, Gifted entries). The name itself is never altered.
   */
  entryNotes?: Record<string, string>;
  /** This person's open tiers, earliest first (openTiers merged across their entries). */
  tiers: Tier[];
  lateDeadlineIso: string;
}

export function recipientBody(i: RecipientMessageInput): string {
  const plural = i.entryNames.length > 1;
  const notes = i.entryNotes ?? {};
  return [
    `${i.greetingName},`,
    "",
    `I do not have a Week ${i.week} pick yet for:`,
    ...i.entryNames.map((name) => `  ${name}${notes[name] ? ` (${notes[name]})` : ""}`),
    "",
    replyLine(plural),
    "",
    deadlineParagraph(i.tiers, i.lateDeadlineIso),
    "",
    MISSED,
    "",
    SIGNOFF,
    "",
  ].join("\n");
}

export interface BccMessageInput {
  week: number;
  /** Entry count per recipient on the Bcc: the wording goes plural when anyone has more than one. */
  entryCounts: number[];
  /** Open tiers across every recipient. */
  tiers: Tier[];
  lateDeadlineIso: string;
}

/** The group form: no entry names, because every recipient reads the same text. */
export function bccBody(i: BccMessageInput): string {
  const plural = i.entryCounts.some((n) => n > 1);
  return [
    "Hi all,",
    "",
    `I do not have your Week ${i.week} pick${plural ? "s" : ""} yet.`,
    "",
    replyLine(plural),
    "",
    deadlineParagraph(i.tiers, i.lateDeadlineIso),
    "",
    MISSED,
    "",
    SIGNOFF,
    "",
  ].join("\n");
}

/** Addresses once each, judged case-insensitively, in the order first seen and as first written. */
export function dedupeAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addresses) {
    const key = a.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * The per-entry notes for a recipient's message: on a mixed message (some
 * entries the person owns, some bought for them) each gifted entry names its
 * buyer, so one message says plainly which is which. Owner-only and
 * player-only messages carry no note; nothing there is ambiguous.
 */
export function entryNotesFor(
  recipient: { kind: "owner" | "player" | "mixed"; entries: { id: string; entryName: string; isGifted: boolean }[] },
  buyerByEntryId: Map<string, string>,
): Record<string, string> | undefined {
  if (recipient.kind !== "mixed") return undefined;
  const notes: Record<string, string> = {};
  for (const e of recipient.entries) {
    if (!e.isGifted) continue;
    const buyer = buyerByEntryId.get(e.id);
    if (buyer) notes[e.entryName] = `bought by ${buyer}`;
  }
  return notes;
}
