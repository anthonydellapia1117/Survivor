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
import type { ActivityRow } from "@/lib/dashboard";
import { toneOfResult, TONE_TEXT_CLASS } from "@/lib/result-colour";
import { RESULT_LABEL, SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
                <span className="text-muted-foreground">{a.team === SKIP_WEEK ? "Bye" : (TEAM_NAME[a.team] ?? a.team)}</span>
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
