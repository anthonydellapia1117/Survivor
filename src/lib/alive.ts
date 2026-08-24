// Part B: alive/out/all filtering. Eliminated entries are never deleted or
// hidden beyond reach — the default view narrows to who is still alive and
// the toggle brings everyone back, full history intact.

import type { EntryStatus, GridCell } from "@/lib/data/types";

export type ShowMode = "alive" | "out" | "all";

export const SHOW_MODES: ShowMode[] = ["alive", "out", "all"];

export function isShowMode(v: unknown): v is ShowMode {
  return v === "alive" || v === "out" || v === "all";
}

export function isAliveStatus(status: EntryStatus): boolean {
  return status !== "eliminated";
}

export function matchesShowMode(status: EntryStatus, mode: ShowMode): boolean {
  if (mode === "all") return true;
  return mode === "alive" ? isAliveStatus(status) : !isAliveStatus(status);
}

export interface ShowCounts {
  alive: number;
  out: number;
  all: number;
}

export function showCounts(statuses: { status: EntryStatus }[]): ShowCounts {
  const alive = statuses.filter((s) => isAliveStatus(s.status)).length;
  return { alive, out: statuses.length - alive, all: statuses.length };
}

/**
 * The week an eliminated entry died: the second loss through the double-elim
 * window, or the first loss after it. Null while the entry lives.
 * (Duplicated from the dashboard's eliminationWeek shape so callers can pass
 * one entry's cells.)
 */
export function eliminationWeekOf(cells: GridCell[]): number | null {
  const losses = cells
    .filter((c) => c.result === "loss" || c.result === "tie_loss" || c.result === "missed")
    .map((c) => c.week)
    .sort((a, b) => a - b);
  if (losses.length === 0) return null;
  const late = losses.find((w) => w > 7);
  if (losses.length >= 2) {
    const second = losses[1];
    return late !== undefined ? Math.min(second, late) : second;
  }
  return late ?? null;
}

export const SHOW_STORAGE_KEY = "survivor-show-mode";
