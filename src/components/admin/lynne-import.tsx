"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WeekRow } from "@/lib/data/types";
import {
  lynneImportCommitAction,
  lynneImportPreviewAction,
  type LynnePreview,
} from "@/app/admin/actions";
import { formatDeadline } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export function LynneImport({ weeks }: { weeks: WeekRow[] }) {
  const router = useRouter();
  const now = Date.now();
  const defaultWeek =
    [...weeks].reverse().find((w) => new Date(w.deadlineAt).getTime() <= now)
      ?.week ??
    weeks[0]?.week ??
    1;

  const fileRef = useRef<HTMLInputElement>(null);
  const [week, setWeek] = useState(defaultWeek);
  const [preview, setPreview] = useState<LynnePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("week", String(week));
    const res = await lynneImportPreviewAction(fd);
    setBusy(false);
    if (!res.ok || !res.preview) {
      setError(res.error ?? "Preview failed");
      return;
    }
    setPreview(res.preview);
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const res = await lynneImportCommitAction(preview);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Commit failed");
      return;
    }
    setDone(
      preview.format === "grid"
        ? `Imported: ${preview.matched.length} of our entries checked against her sheet, ${preview.variances.length} variances recorded. Nothing auto-applied.`
        : `Imported: ${preview.applies.length} results applied, ${preview.variances.length} variances recorded.`,
    );
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-surface"
          onChange={() => {
            setPreview(null);
            setDone(null);
            setError(null);
          }}
        />
        <Select
          value={String(week)}
          onValueChange={(v) => {
            setWeek(Number(v));
            setPreview(null);
          }}
        >
          <SelectTrigger size="sm" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {weeks.map((w) => (
              <SelectItem key={w.week} value={String(w.week)}>
                Week {w.week} — {formatDeadline(w.deadlineAt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={runPreview} disabled={busy}>
          {busy ? "Working…" : "Preview"}
        </Button>
      </div>

      {error ? <p className="text-sm text-loss">{error}</p> : null}
      {done ? <p className="text-sm text-win">{done}</p> : null}

      {preview ? (
        <div className="space-y-4">
          {preview.alreadyImported ? (
            <p className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2 text-sm text-tie">
              Already imported — this exact file was committed before.
              Committing again will be refused by the database.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">
              {preview.format === "grid"
                ? "Her NO./NAMES format"
                : "Legacy format"}
            </Badge>
            <Badge variant="outline" className="text-win">
              {preview.matched.length} of ours matched
            </Badge>
            {preview.grid ? (
              <Badge variant="outline">
                {preview.grid.otherPoolCount} other pool entries (ignored)
              </Badge>
            ) : (
              <Badge variant="outline" className="text-loss">
                {preview.unmatched.length} unmatched
              </Badge>
            )}
            <Badge variant="outline" className="text-tie">
              {preview.variances.length} variances
            </Badge>
            {preview.grid ? (
              <>
                {preview.unmatched.length > 0 ? (
                  <Badge variant="outline" className="text-loss">
                    {preview.unmatched.length} conflicts
                  </Badge>
                ) : null}
                <Badge variant="outline">
                  {preview.grid.teamAgreements} picks in agreement
                </Badge>
                {preview.grid.statusAgreements > 0 ? (
                  <Badge variant="outline">
                    {preview.grid.statusAgreements} OUT in agreement
                  </Badge>
                ) : null}
                {preview.grid.confirmedRemovals > 0 ? (
                  <Badge variant="outline">
                    {preview.grid.confirmedRemovals} eliminated entries she
                    already removed
                  </Badge>
                ) : null}
              </>
            ) : (
              <>
                <Badge variant="outline">
                  {preview.applies.length} results to apply
                </Badge>
                {preview.alreadyApplied > 0 ? (
                  <Badge variant="outline">
                    {preview.alreadyApplied} already in agreement
                  </Badge>
                ) : null}
                {preview.noResultYet > 0 ? (
                  <Badge variant="outline">
                    {preview.noResultYet} picks without results
                  </Badge>
                ) : null}
              </>
            )}
          </div>

          {preview.grid &&
          preview.grid.latestFilledWeek !== null &&
          preview.grid.latestFilledWeek !== preview.week ? (
            <p className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2 text-sm text-tie">
              You picked Week {preview.week}, but the latest filled week in
              her sheet is Week {preview.grid.latestFilledWeek}. Make sure
              the week selection is right before committing.
            </p>
          ) : null}

          {preview.grid?.noFillInfo ? (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
              This file carried no fill colors (a CSV or stripped export) —
              OUT status was read from cell values and missing rows only.
            </p>
          ) : null}

          {preview.grid?.herCounts ? (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
              Her pool-wide counts for Week {preview.week}:{" "}
              <span className="font-medium text-win">
                {preview.grid.herCounts.noLosses ?? "—"} No Losses
              </span>{" "}
              ·{" "}
              <span className="font-medium text-tie">
                {preview.grid.herCounts.lossBye ?? "—"} Loss/Bye
              </span>{" "}
              ·{" "}
              <span className="font-medium text-loss">
                {preview.grid.herCounts.out ?? "—"} Out
              </span>{" "}
              <span className="text-xs text-muted-foreground">
                (her whole pool, not just our entries)
              </span>
            </p>
          ) : null}

          {preview.grid && preview.grid.numberSuggestions.length > 0 ? (
            <p className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2 text-xs text-tie">
              Numbers on her sheet not on file (set them in Entries if
              they&apos;re right — never applied automatically):{" "}
              {preview.grid.numberSuggestions
                .map((s) => `${s.entryName} → NO. ${s.sheetNo}`)
                .join(", ")}
            </p>
          ) : null}

          {preview.variances.length > 0 ? (
            <Card className="border-tie/40 bg-surface">
              <CardHeader>
                <CardTitle className="text-base text-tie">
                  Variances — reported, never auto-resolved
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3">Entry</th>
                      <th className="py-1.5 pr-3">Type</th>
                      <th className="py-1.5 pr-3">Lynne says</th>
                      <th className="py-1.5">Local record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.variances.map((v, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-1.5 pr-3 font-medium">
                          {v.entryName}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {v.type.replaceAll("_", " ")}
                        </td>
                        <td className="py-1.5 pr-3">
                          {v.lynne.team ?? "—"}
                          {v.lynne.result ? ` · ${v.lynne.result}` : ""}
                        </td>
                        <td className="py-1.5">
                          {v.local.team ?? "no pick"}
                          {v.local.result ? ` · ${v.local.result}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {preview.grid && preview.grid.conflicts.length > 0 ? (
            <Card className="border-loss/40 bg-surface">
              <CardHeader>
                <CardTitle className="text-base text-loss">
                  Conflicts — her number and our records disagree. Review
                  before trusting this import.
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {preview.grid.conflicts.map((c, i) => (
                    <li key={i} className="font-mono text-xs">
                      NO. {c.no} “{c.name}” — {c.reason.replaceAll("_", " ")}
                      {c.entryName ? ` (our NO. points at “${c.entryName}”)` : ""}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {!preview.grid && preview.unmatched.length > 0 ? (
            <Card className="border-loss/40 bg-surface">
              <CardHeader>
                <CardTitle className="text-base text-loss">
                  Unmatched rows — fix names or set Lynne labels, then
                  re-preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {preview.unmatched.map((r, i) => (
                    <li key={i} className="font-mono text-xs">
                      {r.entry}
                      {r.team ? ` → ${r.team}` : ""}
                      {r.result ? ` (${r.result})` : ""}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card className="bg-surface">
            <CardHeader>
              <CardTitle className="text-base">
                Matched rows ({preview.matched.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    {preview.format === "grid" ? (
                      <th className="py-1.5 pr-3">NO.</th>
                    ) : null}
                    <th className="py-1.5 pr-3">Her label</th>
                    <th className="py-1.5 pr-3">Entry</th>
                    <th className="py-1.5 pr-3">Team</th>
                    <th className="py-1.5 pr-3">
                      {preview.format === "grid" ? "Status" : "Result"}
                    </th>
                    <th className="py-1.5">Matched by</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.matched.map((m, i) => (
                    <tr key={i} className="border-t border-border/60">
                      {preview.format === "grid" ? (
                        <td className="py-1.5 pr-3 tabular-nums">
                          {m.no ?? "—"}
                        </td>
                      ) : null}
                      <td className="py-1.5 pr-3">{m.entry}</td>
                      <td className="py-1.5 pr-3 font-medium">{m.entryName}</td>
                      <td className="py-1.5 pr-3">{m.team ?? "—"}</td>
                      <td className="py-1.5 pr-3">
                        {m.result === "out" ? (
                          <span className="font-semibold text-loss">OUT</span>
                        ) : (
                          (m.result ?? "—")
                        )}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">
                        {m.matchedBy.replaceAll("_", " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Button
            onClick={commit}
            disabled={busy || preview.alreadyImported}
            size="sm"
          >
            {preview.format === "grid" ? (
              <>
                Commit import — record {preview.variances.length}{" "}
                {preview.variances.length === 1 ? "variance" : "variances"}{" "}
                (results come from scores, nothing auto-applied)
              </>
            ) : (
              <>
                Commit import — apply {preview.applies.length}{" "}
                {preview.applies.length === 1 ? "result" : "results"}, record{" "}
                {preview.variances.length}{" "}
                {preview.variances.length === 1 ? "variance" : "variances"}
              </>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
