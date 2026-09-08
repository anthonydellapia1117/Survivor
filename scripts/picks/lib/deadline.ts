// Which deadline a team's pick takes, and whether a moment is past it. The
// tiers come from src/lib/deadlines.ts, which mirrors pick_deadline() in SQL.

import { teamDeadlines } from "@/lib/deadlines";
import { SKIP_WEEK } from "@/lib/standing";
import type { GameDay } from "@/lib/data/types";

export interface WeekBounds {
  week: number;
  earlyDeadlineAt: string;
  lateDeadlineAt: string;
}

export interface GameLite {
  week: number;
  dayOfWeek: GameDay;
  homeTeam: string;
  awayTeam: string;
}

export function deadlineFor(team: string, week: WeekBounds, games: GameLite[]): string {
  if (team === SKIP_WEEK) return week.lateDeadlineAt;
  const map = teamDeadlines(
    games.filter((g) => g.week === week.week),
    week.earlyDeadlineAt,
    week.lateDeadlineAt,
  );
  return map.get(team) ?? week.lateDeadlineAt;
}

export function gameDayFor(team: string, games: GameLite[], week: number): GameDay | null {
  const g = games.find((x) => x.week === week && (x.homeTeam === team || x.awayTeam === team));
  return g?.dayOfWeek ?? null;
}

export function isLate(deadlineIso: string, at: Date): boolean {
  return at.getTime() > new Date(deadlineIso).getTime();
}

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatEt(iso: string): string {
  const p = Object.fromEntries(ET.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day} ${p.hour}:${p.minute} ${p.dayPeriod} ET`;
}
