"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WeekRow } from "@/lib/data/types";
import { deadlineSweepAction } from "@/app/admin/actions";
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

interface SweepRow {
  entryId: string;
  entryName: string;
  ownerName: string;
}

export function DeadlineSweep({ weeks }: { weeks: WeekRow[] }) {
  const router = useRouter();
  const now = Date.now();
  const defaultWeek =
    [...weeks].reverse().find((w) => new Date(w.deadlineAt).getTime() <= now)
      ?.week ?? weeks[0]?.week ?? 1;

  const [week, setWeek] = useState(defaultWeek);
  const [rows, setRows] = useState<SweepRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = weeks.find((w) => w.week === week);
  const deadlinePassed = selected
    ? new Date(selected.deadlineAt).getTime() <= now
    : false;

  async function preview() {
    setBusy(true);
    setError(null);
    setCommitted(null);
    const res = await deadlineSweepAction({ week, commit: false });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Preview failed");
      return;
    }
    setRows(res.rows ?? []);
  }

  async function commit() {
    setBusy(true);
    setError(null);
    const res = await deadlineSweepAction({ week, commit: true });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Sweep failed");
      return;
    }
    setCommitted(res.rows?.length ?? 0);
    setRows(null);
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={String(week)}
          onValueChange={(v) => {
            setWeek(Number(v));
            setRows(null);
            setCommitted(null);
            setError(null);
          }}
        >
          <SelectTrigger size="sm" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {weeks.map((w) => (
              <SelectItem key={w.week} value={String(w.week)}>
                Week {w.week} — locks {formatDeadline(w.deadlineAt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={preview} disabled={busy}>
          Preview
        </Button>
      </div>

      {selected && !deadlinePassed ? (
        <p className="text-sm text-tie">
          Week {week}&apos;s deadline has not passed yet — preview works, but
          the sweep will refuse to commit.
        </p>
      ) : null}

      {error ? <p className="text-sm text-loss">{error}</p> : null}

      {committed !== null ? (
        <p className="text-sm text-win">
          Sweep committed: {committed} automatic{" "}
          {committed === 1 ? "loss" : "losses"} recorded for week {week}.
        </p>
      ) : null}

      {rows !== null ? (
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">
              {rows.length === 0
                ? `Nothing to sweep — every alive entry has a week ${week} pick.`
                : `${rows.length} ${rows.length === 1 ? "entry" : "entries"} would take an automatic loss`}
            </CardTitle>
          </CardHeader>
          {rows.length > 0 ? (
            <CardContent className="space-y-3">
              <ul className="divide-y divide-border/60 text-sm">
                {rows.map((r) => (
                  <li key={r.entryId} className="flex items-center gap-3 py-1.5">
                    <span className="font-medium">{r.entryName}</span>
                    <span className="ml-auto text-muted-foreground">
                      {r.ownerName}
                    </span>
                  </li>
                ))}
              </ul>
              <Button
                onClick={commit}
                disabled={busy || !deadlinePassed}
                variant="destructive"
                size="sm"
              >
                Commit {rows.length} automatic{" "}
                {rows.length === 1 ? "loss" : "losses"}
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
