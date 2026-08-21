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
      `Imported: ${preview.applies.length} results applied, ${preview.variances.length} variances recorded.`,
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
            <Badge variant="outline">{preview.rows.length} rows</Badge>
            <Badge variant="outline" className="text-win">
              {preview.matched.length} matched
            </Badge>
            <Badge variant="outline" className="text-loss">
              {preview.unmatched.length} unmatched
            </Badge>
            <Badge variant="outline" className="text-tie">
              {preview.variances.length} variances
            </Badge>
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
          </div>

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

          {preview.unmatched.length > 0 ? (
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
                    <th className="py-1.5 pr-3">Her label</th>
                    <th className="py-1.5 pr-3">Entry</th>
                    <th className="py-1.5 pr-3">Team</th>
                    <th className="py-1.5 pr-3">Result</th>
                    <th className="py-1.5">Matched by</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.matched.map((m, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="py-1.5 pr-3">{m.entry}</td>
                      <td className="py-1.5 pr-3 font-medium">{m.entryName}</td>
                      <td className="py-1.5 pr-3">{m.team ?? "—"}</td>
                      <td className="py-1.5 pr-3">{m.result ?? "—"}</td>
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
            Commit import — apply {preview.applies.length}{" "}
            {preview.applies.length === 1 ? "result" : "results"}, record{" "}
            {preview.variances.length}{" "}
            {preview.variances.length === 1 ? "variance" : "variances"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
