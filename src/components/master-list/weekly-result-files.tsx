// The weekly result files from the master pool (lynne_imports): the variance
// panel, the unmatched rows and the table as received, carried over from the
// old results page. The uploaded filename is admin-only: it is whatever the
// master pool's runner named the file, so it never renders on a public
// route. Week, time and counts identify the import.

import type { LynneImportRow } from "@/lib/data/types";
import { EmptyState } from "@/components/empty-state";
import { formatEtDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MASTER_POOL } from "@/lib/site-copy";

interface VarianceShape {
  type?: string;
  entryName?: string;
  lynne?: { team?: string | null; result?: string | null };
  local?: { team?: string | null; result?: string | null };
}

interface RowShape {
  entry?: string;
  team?: string | null;
  result?: string | null;
}

export function WeeklyResultFiles({ imports }: { imports: LynneImportRow[] }) {
  const latest = imports[0];
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg">Weekly result files</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The master pool&apos;s published results are authoritative on wins,
          losses and eliminations. This app is authoritative on what was
          submitted and when. Disagreements are listed here - reported, never
          auto-resolved.
        </p>
      </div>

      {!latest ? (
        <EmptyState
          title="No weekly result file yet"
          detail="Each week's result file from the master pool will be listed here with match counts and any variances against this app's record."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {latest.week ? `Week ${latest.week}` : "Latest import"}
            </span>
            <span className="text-muted-foreground" suppressHydrationWarning>
              imported {formatEtDateTime(latest.importedAt)} ET
            </span>
            <Badge variant="outline">{latest.rowCount ?? 0} rows</Badge>
            <Badge variant="outline" className="text-win">
              {latest.matchedCount ?? 0} matched
            </Badge>
            <Badge variant="outline" className="text-tie">
              {(latest.variances ?? []).length} variances
            </Badge>
          </div>

          {(latest.variances ?? []).length > 0 ? (
            <Card className="border-tie/40 bg-surface">
              <CardHeader>
                <CardTitle className="text-base text-tie">
                  Variance panel - published vs. this app
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3">Entry</th>
                      <th className="py-1.5 pr-3">Type</th>
                      <th className="py-1.5 pr-3">Published</th>
                      <th className="py-1.5">Local record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(latest.variances as VarianceShape[]).map((v, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-1.5 pr-3 font-medium">
                          {v.entryName ?? "?"}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {(v.type ?? "").replaceAll("_", " ")}
                        </td>
                        <td className="py-1.5 pr-3">
                          {v.lynne?.team ?? "-"}
                          {v.lynne?.result ? ` · ${v.lynne.result}` : ""}
                        </td>
                        <td className="py-1.5">
                          {v.local?.team ?? "no pick"}
                          {v.local?.result ? ` · ${v.local.result}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-win">
              No open variances - {MASTER_POOL.possessive} latest file agrees
              with this app&apos;s record.
            </p>
          )}

          {(latest.unmatched ?? []).length > 0 ? (
            <Card className="border-loss/40 bg-surface">
              <CardHeader>
                <CardTitle className="text-base text-loss">
                  Unmatched rows
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 font-mono text-xs">
                  {(latest.unmatched as RowShape[]).map((r, i) => (
                    <li key={i}>
                      {r.entry}
                      {r.team ? ` - ${r.team}` : ""}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card className="bg-surface">
            <CardHeader>
              <CardTitle className="text-base">Table as received</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3">Entry label</th>
                    <th className="py-1.5 pr-3">Team</th>
                    <th className="py-1.5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {((latest.rows ?? []) as RowShape[]).map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="py-1.5 pr-3">{r.entry}</td>
                      <td className="py-1.5 pr-3">{r.team ?? "-"}</td>
                      <td className="py-1.5">{r.result ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {imports.length > 1 ? (
            <div>
              <h3 className="text-base">Earlier files</h3>
              <ul className="mt-2 divide-y divide-border/60 text-sm">
                {imports.slice(1).map((im) => (
                  <li key={im.id} className="flex items-center gap-3 py-2">
                    <span className="font-medium">
                      {im.week ? `W${im.week}` : "-"}
                    </span>
                    <span
                      className="ml-auto text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {formatEtDateTime(im.importedAt)} ET ·{" "}
                      {im.matchedCount ?? 0}/{im.rowCount ?? 0} matched ·{" "}
                      {(im.variances ?? []).length} variances
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
