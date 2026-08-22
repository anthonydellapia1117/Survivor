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
  date: string;
  time: string;
  window: string;
  confirmed: boolean;
  dirty: boolean;
  busy: boolean;
  error: string | null;
}

function initialState(w: WeekRow): RowState {
  const wall = utcToEtWall(w.deadlineAt);
  return {
    date: wall.date,
    time: wall.time,
    window: w.windowLabel,
    confirmed: w.confirmed,
    dirty: false,
    busy: false,
    error: null,
  };
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
    let deadlineAt: string;
    try {
      deadlineAt = etWallToUtc(s.date, s.time);
    } catch {
      setRows((r) => ({
        ...r,
        [week]: { ...r[week], busy: false, error: "Bad date/time" },
      }));
      return;
    }
    const res = await updateWeekAction({
      week,
      windowLabel: s.window,
      deadlineAt,
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
      {weeks.map((w) => {
        const s = rows[w.week];
        const weekday = s.date
          ? new Date(`${s.date}T12:00:00Z`).toLocaleDateString("en-US", {
              weekday: "short",
              timeZone: "UTC",
            })
          : "";
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

            <select
              value={s.window}
              onChange={(e) => patch(w.week, { window: e.target.value })}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              aria-label={`Week ${w.week} window`}
            >
              <option value="thu_fri">Thu/Fri</option>
              <option value="sat_mon">Sat–Mon</option>
            </select>

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={s.date}
                onChange={(e) => patch(w.week, { date: e.target.value })}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                aria-label={`Week ${w.week} deadline date`}
              />
              <input
                type="time"
                value={s.time}
                onChange={(e) => patch(w.week, { time: e.target.value })}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                aria-label={`Week ${w.week} deadline time (ET)`}
              />
              <span className="text-xs text-muted-foreground">
                {weekday} ET
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
