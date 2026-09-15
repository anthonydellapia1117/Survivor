"use client";

// The dashboard's lower section, under one Everyone / Our group toggle.
//
// Set by Anthony on 2026-09-15: every viewer KPI shows the whole pool, and
// our group's figures appear only when this toggle is set to "Our group".
// Both scopes arrive computed from the server (src/lib/dashboard-scope.ts)
// as plain data; the choice here is view state and nothing more, the same
// radiogroup and the same two words the one table at /grid and the Teams
// page use. The default is the shared defaultTeamsSource rule: Everyone once
// her sheet carries the play week, and until she publishes it our group
// stands in and the caption says so (CLAUDE.md, Public surfaces).

import Link from "next/link";
import { useState } from "react";
import type { LockBoundary } from "@/lib/dashboard";
import { SCOPE_LABEL, type ScopeData } from "@/lib/dashboard-scope";
import { formatDeadline } from "@/lib/format";
import { defaultTeamsSource, type TeamsSourceKind as Source } from "@/lib/master-list";
import { OUT_SWATCH_CLASS, toneOfResult, TONE_SWATCH_CLASS, TONE_TEXT_CLASS } from "@/lib/result-colour";
import { RESULT_LABEL, SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { TEAM_PALETTE } from "@/lib/team-colors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CarnageList } from "@/components/dashboard/carnage-list";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { LockClosedIcon } from "@/components/dashboard/lock-icon";
import { PickDistribution } from "@/components/dashboard/pick-distribution";
import { SurvivalStrip } from "@/components/dashboard/survival-strip";
import { cn } from "@/lib/utils";

interface Props {
  /** Her whole pool; null when no sheet is loaded. */
  pool: ScopeData | null;
  ours: ScopeData;
  /** Her sheet carries the play week's column, revealed or not. */
  poolHasWeek: boolean;
  week: number | null;
  deadline: LockBoundary | null;
  /** Her published Total in Pool, for the ALIVE tile's "of N"; null falls back to the sheet's rows. */
  herTotal: number | null;
}

/** Her three buckets as a bar: green, yellow, and the OUT red. */
const BUCKET_CLASS = {
  "No Losses": TONE_SWATCH_CLASS.won,
  "Loss/Bye": TONE_SWATCH_CLASS.lost,
  Out: OUT_SWATCH_CLASS,
} as const;

export function ScopeSection({ pool, ours, poolHasWeek, week, deadline, herTotal }: Props) {
  const poolLoaded = pool !== null;
  const [source, setSource] = useState<Source>(defaultTeamsSource(poolLoaded, poolHasWeek));
  const active = source === "pool" && pool ? pool : ours;
  const options: { key: Source; n: number; disabled?: boolean }[] = [
    { key: "pool", n: pool?.count ?? 0, disabled: !poolLoaded },
    { key: "ours", n: ours.count },
  ];
  const d = active.distribution;

  return (
    <section className="space-y-4" data-numeric>
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="radiogroup"
          aria-label="Everyone or our group"
          className="inline-flex rounded-lg border border-border bg-surface p-0.5"
        >
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={source === o.key}
              disabled={o.disabled}
              onClick={() => setSource(o.key)}
              className={cn(
                "flex h-11 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide transition-colors duration-150 disabled:opacity-50 sm:h-9",
                source === o.key ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {SCOPE_LABEL[o.key]}
              <span className="tabular-nums opacity-70">{o.n.toLocaleString("en-US")}</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {active.key === "pool"
            ? "Rows on her newest sheet, scored from the games; she removes eliminated entries as the season goes."
            : poolHasWeek
              ? "Our group's own entries."
              : `Our group stands in until the master pool's Week ${week ?? "-"} picks are published.`}
        </span>
      </div>

      <KpiStrip
        kpis={active.kpis}
        week={week}
        deadline={deadline}
        total={active.key === "pool" ? (herTotal ?? active.count) : active.count}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Survival</CardTitle>
          </CardHeader>
          <CardContent>
            <SurvivalStrip strip={active.survival} />
            <p className="mt-3 text-xs text-muted-foreground">
              {active.key === "pool"
                ? "Start is her published Total in Pool; the rest are rows on her newest sheet, and she removes eliminated entries as the season goes."
                : "Our group's entries, scored from the games."}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">
              Week {d.week ?? "-"} picks
              <span className="ml-2 text-xs font-normal text-muted-foreground">{SCOPE_LABEL[active.key]}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.rows ? (
              <>
                <PickDistribution rows={d.rows} />
                <p className="mt-2 text-xs text-muted-foreground">
                  {d.caption}{" "}
                  <Link href="/grid" className="inline-flex min-h-11 items-center text-primary underline-offset-2 hover:underline">
                    The Grid
                  </Link>
                </p>
              </>
            ) : d.empty === "locked" ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <LockClosedIcon className="size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{d.caption}</p>
                {d.lockedAt ? (
                  <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                    {formatDeadline(d.lockedAt)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">{d.caption}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Week {active.carnage?.week ?? week ?? "-"} carnage</CardTitle>
        </CardHeader>
        <CardContent>
          {active.carnage === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No game final yet in Week {week ?? "-"}.</p>
          ) : active.carnage.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No entry has lost yet this week - {active.carnage.finalGames} of {active.carnage.totalGames} games final.
            </p>
          ) : (
            <>
              <CarnageList carnage={active.carnage} />
              <p className="mt-2 text-xs text-muted-foreground">
                {active.carnage.lostTotal.toLocaleString("en-US")}{" "}
                {active.carnage.lostTotal === 1 ? "entry" : "entries"} lost this week,{" "}
                {active.carnage.outTotal.toLocaleString("en-US")} of them out - {active.carnage.finalGames} of{" "}
                {active.carnage.totalGames} games final.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Standings - official count</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
            {active.standings.buckets
              .filter((b) => b.n > 0)
              .map((b) => (
                <div
                  key={b.label}
                  className={cn("h-full", BUCKET_CLASS[b.label])}
                  style={{ width: `${(b.n / Math.max(1, active.standings.total)) * 100}%` }}
                  title={`${b.label}: ${b.n}`}
                />
              ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            {active.standings.buckets
              .filter((b) => b.n > 0)
              .map((b) => (
                <span key={b.label} className="flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", BUCKET_CLASS[b.label])} />
                  {b.label}
                  <span className="tabular-nums text-foreground">{b.n.toLocaleString("en-US")}</span>
                </span>
              ))}
          </div>
          <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm">{active.standings.sentence}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Chalk vs contrarian</CardTitle>
          </CardHeader>
          <CardContent>
            {active.chalk.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Once a week&apos;s games have all kicked off: the most-picked team that week, and whether the crowd was right.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {active.chalk.map((c) => (
                  <li key={c.week} className="flex items-center gap-2">
                    <span className="w-9 tabular-nums text-muted-foreground">W{c.week}</span>
                    <span className={cn("font-medium", TONE_TEXT_CLASS[c.tone])}>{c.team}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {c.count.toLocaleString("en-US")} picks, {c.pct}%
                    </span>
                    <span className={cn("ml-auto text-xs font-semibold", TONE_TEXT_CLASS[c.tone] || "text-muted-foreground")}>
                      {c.state === "won" ? "chalk held" : c.state === "lost" ? "chalk fell" : "not final"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Teams running out</CardTitle>
          </CardHeader>
          <CardContent>
            {active.scarcity.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Every alive entry still holds all 32 teams. Scarcity shows up as picks burn teams.
              </p>
            ) : (
              <>
                <ul className="space-y-1.5 text-sm">
                  {active.scarcity.rows.map((sc) => (
                    <li key={sc.team} className="flex items-center gap-2">
                      <span className="w-9 font-medium" style={{ color: TEAM_PALETTE[sc.team]?.display }}>
                        {sc.team}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${(sc.left / Math.max(1, active.scarcity.alive)) * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-muted-foreground">
                        {sc.left.toLocaleString("en-US")}/{active.scarcity.alive.toLocaleString("en-US")}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Alive entries that still hold the team
                  {active.scarcity.throughWeek !== null ? `, through Week ${active.scarcity.throughWeek}` : ""}.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {active.activity ? (
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {active.activity.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Results appear here as weeks are scored.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {active.activity.map((a, i) => (
                  <li key={i} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">W{a.week}</span>
                    <Link href={`/entry/${a.entryId}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary">
                      {a.entryName}
                    </Link>
                    <span className="text-muted-foreground">
                      {a.team === SKIP_WEEK ? "Bye" : (TEAM_NAME[a.team] ?? a.team)}
                    </span>
                    <span
                      className={cn(
                        "w-16 shrink-0 text-right text-xs font-medium",
                        TONE_TEXT_CLASS[toneOfResult(a.result)] || "text-muted-foreground",
                      )}
                    >
                      {RESULT_LABEL[a.result]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
