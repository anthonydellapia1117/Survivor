// The dashboard's charts, drawn on the server as plain HTML: no chart
// library, no loading skeleton, nothing to hydrate. Set by Anthony on
// 2026-09-15 - sleek, dense, legible on a phone at a glance. Each one reads a
// single scope (the whole pool, or our group) handed to it by the page.
//
// Colours come from src/lib/result-colour.ts and mean what they mean on the
// Grid: subtle green won, yellow lost (a loss, a tie or a missed week), red
// out, neutral for a game with no final.

import type { ReactNode } from "react";
import { TEAM_NAME } from "@/lib/standing";
import type { DamageRow, SurvivalWeek, TeamLeft } from "@/lib/dashboard";
import {
  OUT_BAR_CLASS,
  OUT_SWATCH_CLASS,
  TONE_BAR_CLASS,
  TONE_SWATCH_CLASS,
  TONE_TEXT_CLASS,
  type ResultTone,
} from "@/lib/result-colour";
import { MISSED_TEAM } from "@/lib/master-list";
import { cn } from "@/lib/utils";

const pct = (n: number, of: number): number => (of > 0 ? Math.round((n / of) * 100) : 0);
const fmt = (n: number): string => n.toLocaleString("en-US");

/** A team code as the reader knows it; a missed week is "No pick". */
function teamLabel(team: string): string {
  return team === MISSED_TEAM ? "No pick" : team;
}

function teamTitle(team: string): string {
  return team === MISSED_TEAM ? "No pick - a loss" : (TEAM_NAME[team] ?? team);
}

export function Legend({ items }: { items: { label: string; swatch: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1">
          <span className={cn("size-2 rounded-[2px]", i.swatch)} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * One column per week of the season, each the whole field stacked: No Losses
 * at the bottom in green, 1 Loss/Bye above it in yellow, Out on top in red.
 * Weeks not yet scored are empty slots, so the season's progress shows too.
 * A rule after the double-elimination boundary marks where one loss starts to
 * finish an entry.
 */
export function SurvivalColumns({
  series,
  seasonWeeks = 18,
  doubleElimThrough = 7,
}: {
  series: SurvivalWeek[];
  seasonWeeks?: number;
  doubleElimThrough?: number;
}) {
  const byWeek = new Map(series.map((s) => [s.week, s]));
  const latest = series.at(-1);
  const total = latest ? latest.noLosses + latest.lossBye + latest.out : 0;
  const scored = latest && latest.week > 0 ? latest : null;
  const summary = scored
    ? `After Week ${scored.week}: ${fmt(scored.noLosses + scored.lossBye)} of ${fmt(total)} alive (${pct(scored.noLosses + scored.lossBye, total)}%), ${fmt(scored.noLosses)} without a loss (${pct(scored.noLosses, total)}%), ${fmt(scored.out)} out.`
    : `No week scored yet: ${fmt(total)} ${total === 1 ? "entry" : "entries"}, all alive with no losses.`;
  return (
    <div className="space-y-2">
      <div role="img" aria-label={summary} className="flex h-28 items-end gap-[3px]">
        {Array.from({ length: seasonWeeks }, (_, i) => i + 1).map((w) => {
          const s = byWeek.get(w);
          const boundary = w === doubleElimThrough + 1;
          return (
            <div key={w} className={cn("flex h-full min-w-0 flex-1 flex-col", boundary && "border-l border-dashed border-muted-foreground/50 pl-[3px]")}>
              {s ? (
                <div
                  className="flex h-full flex-col-reverse overflow-hidden rounded-[3px]"
                  title={`Week ${w}: ${fmt(s.noLosses)} no losses, ${fmt(s.lossBye)} one loss or bye, ${fmt(s.out)} out`}
                >
                  <div className={TONE_BAR_CLASS.won} style={{ height: `${(s.noLosses / Math.max(1, total)) * 100}%` }} />
                  <div className={TONE_BAR_CLASS.lost} style={{ height: `${(s.lossBye / Math.max(1, total)) * 100}%` }} />
                  <div className={OUT_BAR_CLASS} style={{ height: `${(s.out / Math.max(1, total)) * 100}%` }} />
                </div>
              ) : (
                <div className="h-full rounded-[3px] border border-dashed border-border" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] text-center text-[9px] tabular-nums text-muted-foreground" aria-hidden>
        {Array.from({ length: seasonWeeks }, (_, i) => i + 1).map((w) => (
          <span key={w} className={cn("min-w-0 flex-1", w === doubleElimThrough + 1 && "pl-[4px]")}>
            {w}
          </span>
        ))}
      </div>
      <p className="text-sm">{summary}</p>
      <Legend
        items={[
          { label: "No losses", swatch: TONE_SWATCH_CLASS.won },
          { label: "1 loss or bye", swatch: TONE_SWATCH_CLASS.lost },
          { label: "Out", swatch: OUT_SWATCH_CLASS },
          { label: `One loss is out from Week ${doubleElimThrough + 1}`, swatch: "border border-dashed border-muted-foreground/60" },
        ]}
      />
    </div>
  );
}

export interface ToneRow {
  team: string;
  count: number;
  pct: number;
  tone: ResultTone;
}

function BarRow({
  label,
  title,
  width,
  bar,
  overlay,
  value,
  sub,
}: {
  label: string;
  title: string;
  width: number;
  bar: string;
  overlay?: number;
  value: string;
  sub?: string;
}) {
  return (
    <li className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-2" title={title}>
      <span className="truncate text-xs font-semibold">{label}</span>
      <span className="relative h-5 overflow-hidden rounded-[3px] bg-surface-2">
        <span className={cn("absolute inset-y-0 left-0 rounded-[3px]", bar)} style={{ width: `${width}%` }} />
        {overlay ? <span className={cn("absolute inset-y-0 left-0", OUT_BAR_CLASS)} style={{ width: `${overlay}%` }} /> : null}
      </span>
      <span className="min-w-[4.5rem] text-right text-xs tabular-nums">
        {value}
        {sub ? <span className="ml-1 text-muted-foreground">{sub}</span> : null}
      </span>
    </li>
  );
}

/** Rows past `visible` fold into a native disclosure, so the first screen stays short. */
function Folded<T>({ rows, visible, render, noun }: { rows: T[]; visible: number; render: (r: T) => ReactNode; noun: string }) {
  const head = rows.slice(0, visible);
  const rest = rows.slice(visible);
  return (
    <>
      <ul className="space-y-1.5">{head.map(render)}</ul>
      {rest.length > 0 ? (
        <details className="group mt-1.5">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
            <span className="group-open:hidden">+{rest.length} more {noun}</span>
            <span className="hidden group-open:inline">Fewer</span>
          </summary>
          <ul className="mt-1.5 space-y-1.5">{rest.map(render)}</ul>
        </details>
      ) : null}
    </>
  );
}

/**
 * The week's picks, one bar per team, each bar in its team's result colour:
 * green where the team won, yellow where it lost, neutral while its game has
 * no final. The counts are the sheet's (or our group's) as they stand.
 */
export function DistributionBars({ rows, visible = 8 }: { rows: ToneRow[]; visible?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Folded
      rows={rows}
      visible={visible}
      noun="teams"
      render={(r) => (
        <BarRow
          key={r.team}
          label={teamLabel(r.team)}
          title={`${teamTitle(r.team)}: ${fmt(r.count)} picks, ${r.pct}%${r.tone === "won" ? ", won" : r.tone === "lost" ? ", lost" : ""}`}
          width={(r.count / max) * 100}
          bar={TONE_BAR_CLASS[r.tone]}
          value={fmt(r.count)}
          sub={`${r.pct}%`}
        />
      )}
    />
  );
}

export const DISTRIBUTION_LEGEND = [
  { label: "Won", swatch: TONE_SWATCH_CLASS.won },
  { label: "Lost", swatch: TONE_SWATCH_CLASS.lost },
  { label: "No final yet", swatch: TONE_SWATCH_CLASS.none },
];

/** The chalk verdict for a week's most-picked team, as a phrase and its colour. */
export function chalkVerdict(tone: ResultTone): { text: string; cls: string } {
  if (tone === "won") return { text: "chalk held", cls: TONE_TEXT_CLASS.won };
  if (tone === "lost") return { text: "chalk fell", cls: TONE_TEXT_CLASS.lost };
  return { text: "not final", cls: "text-muted-foreground" };
}

/**
 * What a scored week cost, by team: a yellow bar for every entry that lost a
 * life on that team, with a red share for the entries it finished.
 */
export function DamageBars({ rows, visible = 6 }: { rows: DamageRow[]; visible?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.lost));
  return (
    <Folded
      rows={rows}
      visible={visible}
      noun="teams"
      render={(r) => (
        <BarRow
          key={r.team}
          label={teamLabel(r.team)}
          title={`${teamTitle(r.team)}: ${fmt(r.lost)} lost a life, ${fmt(r.out)} out`}
          width={(r.lost / max) * 100}
          bar={TONE_BAR_CLASS.lost}
          overlay={r.out > 0 ? (r.out / max) * 100 : undefined}
          value={fmt(r.lost)}
          sub={r.out > 0 ? `${fmt(r.out)} out` : undefined}
        />
      )}
    />
  );
}

/** The teams the fewest alive entries still hold, as a share of the alive field. */
export function TeamsLeftBars({ rows, alive }: { rows: TeamLeft[]; alive: number }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <BarRow
          key={r.team}
          label={r.team}
          title={`${teamTitle(r.team)}: ${fmt(r.left)} of ${fmt(alive)} alive entries can still take it`}
          width={pct(r.left, alive)}
          bar="bg-primary/45"
          value={`${pct(r.left, alive)}%`}
          sub={fmt(r.left)}
        />
      ))}
    </ul>
  );
}
