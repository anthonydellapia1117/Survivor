"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WeekRow } from "@/lib/data/types";
import { updateWeekAction } from "@/app/admin/actions";
import { etWallToUtc, utcToEtWall } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface RowState {
  earlyDate: string;
  earlyTime: string;
  lateDate: string;
  lateTime: string;
  confirmed: boolean;
  dirty: boolean;
  busy: boolean;
  error: string | null;
}

function initialState(w: WeekRow): RowState {
  const early = utcToEtWall(w.earlyDeadlineAt);
  const late = utcToEtWall(w.lateDeadlineAt);
  return {
    earlyDate: early.date,
    earlyTime: early.time,
    lateDate: late.date,
    lateTime: late.time,
    confirmed: w.confirmed,
    dirty: false,
    busy: false,
    error: null,
  };
}

function weekdayOf(date: string): string {
  if (!date) return "";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function WeeksEditor({ weeks }: { weeks: WeekRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<number, RowState>>(() =>
    Object.fromEntries(weeks.map((w) => [w.week, initialState(w)])),
  );

  function patch(week: number, p: Partial<RowState>) {
    setRows((r) => ({
      ...r,
      [week]: { ...r[week], ...p, dirty: true, error: null },
    }));
  }

  async function save(week: number, confirmOverride?: boolean) {
    const s = rows[week];
    const confirmed = confirmOverride ?? s.confirmed;
    setRows((r) => ({ ...r, [week]: { ...r[week], busy: true, error: null } }));
    let earlyDeadlineAt: string;
    let lateDeadlineAt: string;
    try {
      earlyDeadlineAt = etWallToUtc(s.earlyDate, s.earlyTime);
      lateDeadlineAt = etWallToUtc(s.lateDate, s.lateTime);
    } catch {
      setRows((r) => ({
        ...r,
        [week]: { ...r[week], busy: false, error: "Bad date/time" },
      }));
      return;
    }
    const res = await updateWeekAction({
      week,
      earlyDeadlineAt,
      lateDeadlineAt,
      confirmed,
    });
    setRows((r) => ({
      ...r,
      [week]: {
        ...r[week],
        busy: false,
        dirty: !res.ok,
        confirmed: res.ok ? confirmed : r[week].confirmed,
        error: res.ok ? null : (res.error ?? "Save failed"),
      },
    }));
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="hidden items-center gap-x-3 px-3 text-xs font-medium text-muted-foreground lg:flex">
        <span className="w-10" />
        <span className="w-64">Wed/Thu/Fri picks lock (ET)</span>
        <span className="w-64">Sat–Mon picks lock (ET)</span>
      </div>
      {weeks.map((w) => {
        const s = rows[w.week];
        return (
          <div
            key={w.week}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5",
              s.confirmed && !s.dirty
                ? "border-border bg-surface"
                : "border-tie/50 bg-tie/5",
            )}
          >
            <span className="w-10 font-semibold tabular-nums">W{w.week}</span>

            <div className="flex w-64 items-center gap-1.5">
              <input
                type="date"
                value={s.earlyDate}
                onChange={(e) => patch(w.week, { earlyDate: e.target.value })}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                aria-label={`Week ${w.week} early (Thu/Fri) deadline date`}
              />
              <input
                type="time"
                value={s.earlyTime}
                onChange={(e) => patch(w.week, { earlyTime: e.target.value })}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                aria-label={`Week ${w.week} early deadline time (ET)`}
              />
              <span className="w-9 text-xs text-muted-foreground">
                {weekdayOf(s.earlyDate)}
              </span>
            </div>

            <div className="flex w-64 items-center gap-1.5">
              <input
                type="date"
                value={s.lateDate}
                onChange={(e) => patch(w.week, { lateDate: e.target.value })}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                aria-label={`Week ${w.week} late (Sat-Mon) deadline date`}
              />
              <input
                type="time"
                value={s.lateTime}
                onChange={(e) => patch(w.week, { lateTime: e.target.value })}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                aria-label={`Week ${w.week} late deadline time (ET)`}
              />
              <span className="w-9 text-xs text-muted-foreground">
                {weekdayOf(s.lateDate)}
              </span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {s.error ? (
                <span className="max-w-48 truncate text-xs text-loss">
                  {s.error}
                </span>
              ) : null}
              {s.confirmed && !s.dirty ? (
                <span className="flex items-center gap-1 text-xs font-medium text-win">
                  <Check className="size-3.5" /> Confirmed
                </span>
              ) : (
                <span className="text-xs font-medium text-tie">
                  Unconfirmed
                </span>
              )}
              {s.dirty ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={s.busy}
                  onClick={() => save(w.week)}
                >
                  Save
                </Button>
              ) : null}
              {!s.confirmed || s.dirty ? (
                <Button
                  size="sm"
                  disabled={s.busy}
                  onClick={() => save(w.week, true)}
                >
                  {s.dirty ? "Save + confirm" : "Confirm"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={s.busy}
                  onClick={() => save(w.week, false)}
                  className="text-muted-foreground"
                >
                  Unconfirm
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
