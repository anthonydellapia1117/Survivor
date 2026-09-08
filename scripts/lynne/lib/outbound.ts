// The list Anthony sends Lynne after a lock: only the entries whose teams
// locked at that deadline, in her numbering, one line each. An entry with no
// Lynne number cannot go on it and is refused by name, never padded.

import { SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
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

export function fullTeamName(team: string): string {
  if (team === SKIP_WEEK) return "BYE";
  return TEAM_NAME[team] ?? team;
}

export function formatLine(p: OutboundPick): string {
  return `${p.lynneNumber}  ${p.lynneLabel}  -  ${fullTeamName(p.team)}`;
}

export function selectForLock(picks: OutboundPick[], lock: LockDay): OutboundResult {
  const days = new Set<GameDay>(LOCK_GAME_DAYS[lock]);
  const inTier = picks.filter((p) => (p.gameDay === null ? lock === "fri" : days.has(p.gameDay)));
  const included: OutboundPick[] = [];
  const excluded: OutboundResult["excluded"] = [];
  for (const p of inTier) {
    if (p.lynneNumber === null) excluded.push({ pick: p, why: "no Lynne number on file" });
    else if (p.lynneLabel === null) excluded.push({ pick: p, why: "no Lynne label on file" });
    else included.push(p);
  }
  included.sort((a, b) => (a.lynneNumber ?? 0) - (b.lynneNumber ?? 0));
  return { lines: included.map(formatLine), included, excluded };
}

export function draftBody(week: number, lock: LockDay, lines: string[]): string {
  return ["Hey Lynne,", "", `Week ${week} picks - ${LOCK_LABEL[lock]}:`, "", ...lines, "", "Thanks,", "Anthony", ""].join("\n");
}
