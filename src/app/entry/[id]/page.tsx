import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getData } from "@/lib/data";
import { currentPlayWeek } from "@/lib/dashboard";
import { duplicateTeamRisks, eliminationWeekOf } from "@/lib/alive";
import {
  NFL_TEAMS,
  RESULT_LABEL,
  SKIP_WEEK,
  STATUS_LABEL,
  TEAM_NAME,
} from "@/lib/standing";
import { StatusDot } from "@/components/status-dot";
import { formatEtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await props.params;
  const detail = await getData().getEntry(id);
  return { title: detail ? detail.entry.entryName : "Entry" };
}

const RESULT_BADGE: Record<string, string> = {
  win: "bg-win/15 text-win",
  loss: "bg-loss/15 text-loss",
  tie_loss: "bg-tie/15 text-tie",
  bye: "bg-bye/20 text-foreground/70",
  pending: "bg-surface-2 text-muted-foreground",
  missed: "bg-loss/15 text-loss",
};

export default async function EntryPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const data = getData();
  const [detail, games, weeks, allEntries] = await Promise.all([
    data.getEntry(id),
    data.getSchedule(),
    data.getWeeks(),
    data.getEntries(),
  ]);
  if (!detail) notFound();
  const { entry, picks } = detail;

  const usedSet = new Set(
    picks.filter((p) => p.team !== SKIP_WEEK).map((p) => p.team),
  );
  const isOut = entry.status === "eliminated";
  const elimWeek = isOut ? eliminationWeekOf(picks) : null;
  const dupRisks = duplicateTeamRisks(picks);

  // F2: weeks survived vs the group median.
  const survivedOf = (last: number | null) => last ?? 0;
  const survived = survivedOf(entry.lastScoredWeek);
  const sortedSurvived = allEntries
    .map((e) => survivedOf(e.lastScoredWeek))
    .sort((a, b) => a - b);
  const median =
    sortedSurvived.length === 0
      ? 0
      : sortedSurvived[Math.floor(sortedSurvived.length / 2)];

  // Next three matchups per remaining team, from the current play week on.
  const fromWeek = currentPlayWeek(weeks, new Date())?.week ?? 1;
  const nextThree = new Map<string, string[]>();
  for (const t of NFL_TEAMS) {
    if (usedSet.has(t.abbr)) continue;
    nextThree.set(
      t.abbr,
      games
        .filter(
          (g) =>
            g.week >= fromWeek &&
            (g.homeTeam === t.abbr || g.awayTeam === t.abbr),
        )
        .slice(0, 3)
        .map(
          (g) =>
            `W${g.week} ${g.homeTeam === t.abbr ? "" : "@"}${
              g.homeTeam === t.abbr ? g.awayTeam : g.homeTeam
            }`,
        ),
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl">{entry.entryName}</h1>
          <span
            className={
              isOut
                ? "flex items-center gap-1.5 rounded-full border border-loss/40 bg-loss/15 px-2.5 py-0.5 text-xs font-semibold text-loss"
                : "flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium"
            }
          >
            <StatusDot status={entry.status} />
            {isOut ? `OUT${elimWeek ? ` · WK ${elimWeek}` : ""}` : STATUS_LABEL[entry.status]}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {entry.ownerName}
          {entry.isFreeEntry ? " · free entry" : null}
          {survived > 0 || median > 0 ? (
            <>
              {" "}· survived {survived} {survived === 1 ? "week" : "weeks"} (group median {median})
            </>
          ) : null}
        </p>
      </div>

      {dupRisks.length > 0 ? (
        <div className="rounded-md border border-loss bg-loss/15 px-3 py-2.5 text-sm font-semibold text-loss">
          ⚠ DUPLICATE TEAM RISK —{" "}
          {dupRisks
            .map((d) => `${d.team} picked in weeks ${d.weeks.join(" and ")}`)
            .join("; ")}
          . In Lynne&apos;s pool a repeated team is an elimination.
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3 sm:max-w-md">
        <Card className="bg-surface">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Record
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xl tabular-nums">
            {entry.wins}–{entry.losses}
          </CardContent>
        </Card>
        <Card className="bg-surface">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Lives
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xl tabular-nums">
            {entry.livesRemaining}
          </CardContent>
        </Card>
        <Card className="bg-surface">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bye
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xl">
            {entry.byeUsed ? "Used" : entry.status === "bye_eligible" ? "Earned" : "—"}
          </CardContent>
        </Card>
      </div>

      <section>
        <h2 className="text-lg">Pick history</h2>
        {picks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No picks submitted yet.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {picks.map((p) => {
              const killing = isOut && elimWeek === p.week &&
                (p.result === "loss" || p.result === "tie_loss" || p.result === "missed");
              return (
              <li
                key={p.week}
                className={
                  killing
                    ? "flex items-center gap-3 rounded-md border border-loss/60 bg-loss/15 px-3 py-2.5"
                    : "flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5"
                }
              >
                <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">
                  W{p.week}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {killing ? <span className="mr-1 font-bold text-loss">✕</span> : null}
                  {p.team === SKIP_WEEK
                    ? "Bye (skip week)"
                    : (TEAM_NAME[p.team] ?? p.team)}
                  {killing ? (
                    <span className="ml-2 text-xs font-semibold text-loss">the killing pick</span>
                  ) : null}
                </span>
                {p.late ? (
                  <span className="text-xs font-medium text-tie">late</span>
                ) : null}
                <span
                  className="hidden text-xs text-muted-foreground sm:inline"
                  suppressHydrationWarning
                >
                  {formatEtDateTime(p.submittedAt)} ET
                </span>
                <span
                  className={cn(
                    "w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium",
                    RESULT_BADGE[p.result ?? "pending"],
                  )}
                >
                  {p.result ? RESULT_LABEL[p.result] : "Pending"}
                </span>
              </li>
              );
            })}
          </ol>
        )}
      </section>

      <section>
        <h2 className="text-lg">Teams remaining</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {NFL_TEAMS.length - usedSet.size} of {NFL_TEAMS.length} left, with
          each team&apos;s next three matchups — plan ahead on the{" "}
          <Link
            href="/schedule"
            className="text-primary underline-offset-2 hover:underline"
          >
            full schedule
          </Link>
          .
        </p>
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          {NFL_TEAMS.map((t) => {
            const used = usedSet.has(t.abbr);
            const upcoming = nextThree.get(t.abbr) ?? [];
            return (
              <span
                key={t.abbr}
                title={t.name}
                className={cn(
                  "rounded-sm border px-2 py-1.5 text-xs",
                  used
                    ? "border-border bg-surface-2 text-center font-medium text-muted-foreground line-through opacity-60"
                    : isOut
                      ? "border-border bg-surface text-muted-foreground line-through opacity-60"
                      : "border-border bg-surface",
                )}
              >
                {used ? (
                  t.abbr
                ) : (
                  <>
                    <span className="font-medium">{t.abbr}</span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                      {upcoming.length > 0 ? upcoming.join(" · ") : "season done"}
                    </span>
                  </>
                )}
              </span>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Shareable link — bookmark this page to follow{" "}
        <span className="font-medium">{entry.entryName}</span>.{" "}
        <Link
          href={`/entry/${entry.id}/export`}
          className="text-primary hover:underline"
        >
          Share card
        </Link>{" "}
        ·{" "}
        <Link href="/grid" className="text-primary hover:underline">
          See the full grid
        </Link>
      </p>
    </div>
  );
}
