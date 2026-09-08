// The list Anthony sends Lynne after a lock: only the entries whose teams
// locked at that deadline, in her numbering, one line each. An entry with no
// Lynne number cannot go on it and is refused by name, never padded.

import { SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { LYNNE_TEAM_NAME } from "@/lib/lynne/names";
import { pickDeadlineIso } from "@/lib/deadlines";
import type { GameDay } from "@/lib/data/types";

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
