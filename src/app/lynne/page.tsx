import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { EmptyState } from "@/components/empty-state";
import { formatEtDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Lynne's Board" };
export const dynamic = "force-dynamic";

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

export default async function LynnePage() {
  const imports = await getData().getLynneImports();
  const latest = imports[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Lynne&apos;s Board</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The master pool&apos;s data as received. Lynne&apos;s published
          results are authoritative on wins, losses, and eliminations; this
          app&apos;s record is authoritative on what was submitted and when.
          Disagreements appear below — reported, never auto-resolved.
        </p>
      </div>

      {!latest ? (
        <EmptyState
          title="No imports yet"
          detail="Weekly result files from the master pool will be listed here with match counts and any variances against local state."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {latest.week ? `Week ${latest.week}` : "Latest import"}
            </span>
            <span className="text-muted-foreground">{latest.filename}</span>
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
                  Variance panel — Lynne vs. local record
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3">Entry</th>
                      <th className="py-1.5 pr-3">Type</th>
                      <th className="py-1.5 pr-3">Lynne&apos;s file</th>
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
                          {v.lynne?.team ?? "—"}
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
              No open variances — her latest file agrees with the local record.
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
                      {r.team ? ` → ${r.team}` : ""}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card className="bg-surface">
            <CardHeader>
              <CardTitle className="text-base">
                Her table, as received
              </CardTitle>
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
                      <td className="py-1.5 pr-3">{r.team ?? "—"}</td>
                      <td className="py-1.5">{r.result ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {imports.length > 1 ? (
            <section>
              <h2 className="text-lg">Earlier imports</h2>
              <ul className="mt-2 divide-y divide-border/60 text-sm">
                {imports.slice(1).map((im) => (
                  <li key={im.id} className="flex items-center gap-3 py-2">
                    <span className="font-medium">
                      {im.week ? `W${im.week}` : "—"}
                    </span>
                    <span className="text-muted-foreground">{im.filename}</span>
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
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
