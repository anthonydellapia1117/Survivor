// Recent activity: the one card on the dashboard that is ours and only ours,
// rendered OUTSIDE the Everyone / Our group toggle (Anthony, 2026-09-15). It
// is our intake - the picks this group recorded, in the order they were
// scored - and her sheet has no such feed, so it can only ever be ours. That
// is why it needs no label saying so: the card title is "Recent activity"
// and nothing on it names a scope. Its rows are not on ScopeData, so the
// pool scope cannot carry one and the toggle cannot reach it.
//
// Server-rendered: nothing here changes with the toggle.

import Link from "next/link";
import { MISSED_TEAM, NO_PICK_LABEL, type ActivityRow } from "@/lib/dashboard";
import { toneOfResult, TONE_TEXT_CLASS } from "@/lib/result-colour";
import { RESULT_LABEL, SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * What the team column prints. SKIP_WEEK and MISSED are values the rules
 * engine writes into the team column and never reach a screen as words: a
 * bye reads "Bye" and a missed week reads NO_PICK_LABEL, the same label the
 * distribution bar and the carnage list already give it. The feed printed
 * "MISSED Missed" until 2026-09-15 - the expression was carried over from
 * page.tsx with only the bye branch - and the rules engine does write it,
 * so it would have appeared the first week an entry missed.
 */
function teamLabel(team: string): string {
  if (team === SKIP_WEEK) return "Bye";
  if (team === MISSED_TEAM) return NO_PICK_LABEL;
  return TEAM_NAME[team] ?? team;
}

export function RecentActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <Card className="bg-surface">
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Results appear here as weeks are scored.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((a, i) => (
              <li key={i} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">W{a.week}</span>
                <Link href={`/entry/${a.entryId}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary">
                  {a.entryName}
                </Link>
                <span className="text-muted-foreground">{teamLabel(a.team)}</span>
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
  );
}
