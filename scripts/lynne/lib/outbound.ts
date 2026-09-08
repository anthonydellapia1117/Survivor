// The list Anthony sends Lynne after a lock: only the entries whose teams
// locked at that deadline, in her numbering, one line each. An entry with no
// Lynne number cannot go on it and is refused by name, never padded.

import { SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { LYNNE_TEAM_NAME } from "@/lib/lynne/names";
import { pickDeadlineIso } from "@/lib/deadlines";
import { isAliveStatus } from "@/lib/alive";
import type { EntryStatus, GameDay } from "@/lib/data/types";

/** The missed-pick sweep's automatic-loss row. A sentinel, not a team; never sent to her. */
export const MISSED = "MISSED";

/** The lock day, noon ET, and the game days it closes. */
export type LockDay = "tue" | "wed" | "thu" | "fri";

export const LOCK_GAME_DAYS: Record<LockDay, GameDay[]> = {
  tue: ["Wednesday"],
  wed: ["Thursday"],
  thu: ["Friday"],
  fri: ["Saturday", "Sunday", "Monday"],
};

export const LOCK_LABEL: Record<LockDay, string> = {
  tue: "Tuesday noon lock (Wednesday game)",
  wed: "Wednesday noon lock (Thursday games)",
  thu: "Thursday noon lock (Friday games)",
  fri: "Friday noon lock (Saturday, Sunday and Monday games)",
};

export function isLockDay(s: string): s is LockDay {
  return s === "tue" || s === "wed" || s === "thu" || s === "fri";
}

export interface OutboundPick {
  entryName: string;
  lynneNumber: number | null;
  lynneLabel: string | null;
  team: string;
  /** Null for a bye or a team with no game that week; those take the Friday lock. */
  gameDay: GameDay | null;
}

export interface OutboundResult {
  lines: string[];
  included: OutboundPick[];
  excluded: { pick: OutboundPick; why: string }[];
}

/** Her vocabulary first (the city names her sheet uses), the app's full name as the fallback. */
export function fullTeamName(team: string): string {
  if (team === SKIP_WEEK) return "BYE";
  return LYNNE_TEAM_NAME[team] ?? TEAM_NAME[team] ?? team;
}

/** When the lock day's tier closes: noon ET the day before its game day. */
export function lockDeadlineIso(lock: LockDay, earlyDeadlineAt: string, lateDeadlineAt: string): string {
  return pickDeadlineIso(LOCK_GAME_DAYS[lock][0], earlyDeadlineAt, lateDeadlineAt);
}

/** Her label when her file calls it something else, our name otherwise. */
export function labelFor(p: OutboundPick): string {
  return p.lynneLabel ?? p.entryName;
}

export function formatLine(p: OutboundPick): string {
  return `${p.lynneNumber}  ${labelFor(p)}  -  ${fullTeamName(p.team)}`;
}

export function selectForLock(picks: OutboundPick[], lock: LockDay): OutboundResult {
  const days = new Set<GameDay>(LOCK_GAME_DAYS[lock]);
  const inTier = picks.filter((p) => (p.gameDay === null ? lock === "fri" : days.has(p.gameDay)));
  const included: OutboundPick[] = [];
  const excluded: OutboundResult["excluded"] = [];
  for (const p of inTier) {
    // lynne_label is set only when her file calls the entry something other
    // than our name (admin_update_entry stores nullif(label, '')); a null
    // label is normal and means the entry name is what she holds.
    if (p.lynneNumber === null) excluded.push({ pick: p, why: "no Lynne number on file" });
    else included.push(p);
  }
  included.sort((a, b) => (a.lynneNumber ?? 0) - (b.lynneNumber ?? 0));
  return { lines: included.map(formatLine), included, excluded };
}

export function draftBody(week: number, lock: LockDay, lines: string[]): string {
  return ["Hey Lynne,", "", `Week ${week} picks - ${LOCK_LABEL[lock]}:`, "", ...lines, "", "Thanks,", "Anthony", ""].join("\n");
}

export interface OutboundSkip {
  entryName: string;
  team: string;
  why: string;
}

/**
 * The current picks that can go to Lynne at all, before the tier is chosen:
 * an entry that is still alive, with a real team. MISSED is the sweep's
 * automatic loss and is no pick (src/lib/lynne/submit.ts treats it as
 * missing); an entry the standings mark eliminated is already out of her
 * pool, so a Week N pick it made early is never forwarded (the same
 * isAliveStatus line /admin/lynne-submit draws); an entry with no standings
 * row is not on the roster the views carry and is named, never assumed
 * alive. Every skip is returned so the command prints it.
 */
export function buildOutboundPicks(
  entries: { id: string; entry_name: string; lynne_number: number | null; lynne_label: string | null }[],
  current: { entry_id: string; team: string }[],
  statusById: Map<string, string>,
  gameDay: (team: string) => GameDay | null,
): { picks: OutboundPick[]; skipped: OutboundSkip[] } {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const picks: OutboundPick[] = [];
  const skipped: OutboundSkip[] = [];
  for (const p of current) {
    const e = byId.get(p.entry_id);
    if (!e) continue;
    const status = statusById.get(e.id);
    if (p.team === MISSED) {
      skipped.push({ entryName: e.entry_name, team: p.team, why: "missed-pick sweep row, not a team" });
      continue;
    }
    if (status === undefined) {
      skipped.push({ entryName: e.entry_name, team: p.team, why: "not on the standings (owner not confirmed?)" });
      continue;
    }
    if (!isAliveStatus(status as EntryStatus)) {
      skipped.push({ entryName: e.entry_name, team: p.team, why: `eliminated (status ${status})` });
      continue;
    }
    picks.push({
      entryName: e.entry_name,
      lynneNumber: e.lynne_number,
      lynneLabel: e.lynne_label,
      team: p.team,
      gameDay: gameDay(p.team),
    });
  }
  return { picks, skipped };
}
