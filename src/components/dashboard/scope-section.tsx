"use client";

// The dashboard's lower section, under one Everyone / Our group toggle.
//
// Set by Anthony on 2026-09-15, and restated the same day as a rule rather
// than a list of fixes: every panel on the dashboard shows the WHOLE POOL,
// 1,318, unless the toggle is set to our group. Both scopes arrive computed
// from the server (src/lib/dashboard-scope.ts) as plain data; the choice
// here is view state and nothing more, the same radiogroup and the same two
// words the one table at /grid and the Teams page use.
//
// The panels are a separate component that takes ONE ScopeData - the active
// one - and nothing else. That is the rule in the props: a panel cannot read
// our group under Everyone because our group is not handed to it. Recent
// activity is not here at all; it is our intake, can only ever be ours, and
// the page renders it outside the toggle with no label saying so
// (src/components/dashboard/recent-activity.tsx).
//
// The default is Everyone whenever a sheet is loaded, and NOT the Teams
// page's defaultTeamsSource, which waits for the play week's column. Alive,
// the survival strip, the standings bar, the chalk list and the teams
// running out are all computable from her sheet before she publishes the
// week, so from the Friday lock until her sheet lands they would otherwise
// default to our 121. A card that needs the week's column says "not
// published yet" until she does - the picks card included. Our group does
// not stand in anywhere in this section any more: under Everyone no figure
// is derived from our entries, whatever her sheet lacks.

import Link from "next/link";
import { useState } from "react";
import type { LockBoundary } from "@/lib/dashboard";
import { SCOPE_LABEL, type ScopeData } from "@/lib/dashboard-scope";
import { formatDeadline } from "@/lib/format";
import type { TeamsSourceKind as Source } from "@/lib/master-list";
import { OUT_SWATCH_CLASS, TONE_SWATCH_CLASS, TONE_TEXT_CLASS } from "@/lib/result-colour";
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

export function ScopeSection({ pool, ours, week, deadline, herTotal }: Props) {
  const poolLoaded = pool !== null;
  const [source, setSource] = useState<Source>(poolLoaded ? "pool" : "ours");
  const active = source === "pool" && pool ? pool : ours;
  const options: { key: Source; n: number; disabled?: boolean }[] = [
    { key: "pool", n: pool?.count ?? 0, disabled: !poolLoaded },
    { key: "ours", n: ours.count },
  ];

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
            : poolLoaded
              ? "Our group's own entries."
              : "Our group's own entries; Everyone appears once the master pool's sheet is loaded."}
        </span>
      </div>

      <ScopePanels
        scope={active}
        week={week}
        deadline={deadline}
        total={active.key === "pool" ? (herTotal ?? active.count) : active.count}
      />
    </section>
  );
}

interface PanelProps {
  /** The ONE scope showing. Nothing of the other scope is passed. */
  scope: ScopeData;
  week: number | null;
  deadline: LockBoundary | null;
  /** What ALIVE is out of: her published Total in Pool, or the scope's count. */
  total: number;
}

/**
 * Every panel under the toggle, drawn from one ScopeData. Exported so a test
 * can render the panels on either scope without a click, which a server
 * render cannot make.
 */
export function ScopePanels({ scope, week, deadline, total }: PanelProps) {
  const d = scope.distribution;
  return (
    <>
      <KpiStrip kpis={scope.kpis} week={week} deadline={deadline} total={total} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Survival</CardTitle>
          </CardHeader>
          <CardContent>
            <SurvivalStrip strip={scope.survival} />
            <p className="mt-3 text-xs text-muted-foreground">
              {scope.key === "pool"
                ? "Start is her published Total in Pool; the rest are rows on her newest sheet, and she removes eliminated entries as the season goes."
                : "Our group's entries, scored from the games."}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Week {d.week ?? "-"} picks</CardTitle>
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
          <CardTitle className="text-base">
            Week {scope.carnage.state === "no final" ? (week ?? "-") : scope.carnage.week} carnage
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scope.carnage.state === "no final" ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No game final yet in Week {week ?? "-"}.</p>
          ) : scope.carnage.state === "unpublished" ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              The master pool&apos;s Week {scope.carnage.week} picks are not published yet.
            </p>
          ) : scope.carnage.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No entry has lost yet this week - {scope.carnage.finalGames} of {scope.carnage.totalGames} games final.
            </p>
          ) : (
            <>
              <CarnageList carnage={scope.carnage} />
              <p className="mt-2 text-xs text-muted-foreground">
                {scope.carnage.lostTotal.toLocaleString("en-US")}{" "}
                {scope.carnage.lostTotal === 1 ? "entry" : "entries"} lost this week,{" "}
                {scope.carnage.outTotal.toLocaleString("en-US")} of them out - {scope.carnage.finalGames} of{" "}
                {scope.carnage.totalGames} games final.
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
            {scope.standings.buckets
              .filter((b) => b.n > 0)
              .map((b) => (
                <div
                  key={b.label}
                  className={cn("h-full", BUCKET_CLASS[b.label])}
                  style={{ width: `${(b.n / Math.max(1, scope.standings.total)) * 100}%` }}
                  title={`${b.label}: ${b.n}`}
                />
              ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            {scope.standings.buckets
              .filter((b) => b.n > 0)
              .map((b) => (
                <span key={b.label} className="flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", BUCKET_CLASS[b.label])} />
                  {b.label}
                  <span className="tabular-nums text-foreground">{b.n.toLocaleString("en-US")}</span>
                </span>
              ))}
          </div>
          <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm">{scope.standings.sentence}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Chalk vs contrarian</CardTitle>
          </CardHeader>
          <CardContent>
            {scope.chalk.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Once a week&apos;s games have all kicked off: the most-picked team that week, and whether the crowd was right.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {scope.chalk.map((c) => (
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
            {scope.scarcity.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Every alive entry still holds all 32 teams. Scarcity shows up as picks burn teams.
              </p>
            ) : (
              <>
                <ul className="space-y-1.5 text-sm">
                  {scope.scarcity.rows.map((sc) => (
                    <li key={sc.team} className="flex items-center gap-2">
                      <span className="w-9 font-medium" style={{ color: TEAM_PALETTE[sc.team]?.display }}>
                        {sc.team}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${(sc.left / Math.max(1, scope.scarcity.alive)) * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-muted-foreground">
                        {sc.left.toLocaleString("en-US")}/{scope.scarcity.alive.toLocaleString("en-US")}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Alive entries that still hold the team
                  {scope.scarcity.throughWeek !== null ? `, through Week ${scope.scarcity.throughWeek}` : ""}.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
