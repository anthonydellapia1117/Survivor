// A small 5-field cron matcher (minute hour day-of-month month day-of-week,
// UTC), enough for the schedules in config.json: *, lists, ranges, steps.
// Pure, so the schedules are tested without a clock.

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

function field(expr: string, min: number, max: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of expr.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`cron ${name}: cannot read "${part}"`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`cron ${name}: step must be positive`);
    let lo = min;
    let hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b === undefined ? (m[2] ? max : a) : b;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`cron ${name}: ${part} is outside ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron: expected 5 fields, got ${parts.length} in "${expr}"`);
  return {
    minute: field(parts[0], 0, 59, "minute"),
    hour: field(parts[1], 0, 23, "hour"),
    dom: field(parts[2], 1, 31, "day-of-month"),
    month: field(parts[3], 1, 12, "month"),
    dow: field(parts[4], 0, 6, "day-of-week"),
  };
}

/** Whether the expression names this minute (UTC). */
export function cronMatches(expr: string, at: Date): boolean {
  const c = parseCron(expr);
  return (
    c.minute.has(at.getUTCMinutes()) &&
    c.hour.has(at.getUTCHours()) &&
    c.dom.has(at.getUTCDate()) &&
    c.month.has(at.getUTCMonth() + 1) &&
    c.dow.has(at.getUTCDay())
  );
}

// ------------------------------------------------------- the same, in ET
//
// A schedule written as a fixed UTC cron is a schedule that MOVES when the
// clock does: 3 AM ET is 07:00 UTC until 2026-11-01 and 08:00 UTC after it, so
// a cron pinned to either is an hour wrong for half the season. Every slot
// here is stated on the ET wall clock and read against the ET wall clock, so
// nothing has to be re-pinned and nothing drifts. It is the same reason
// nothing in scripts/remind/lib/due.ts knows an hour.

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const DOW_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** An instant as the ET wall clock reads it: day-of-week 0-6, hour 0-23, minute. */
export function etClock(at: Date): { dow: number; hour: number; minute: number } {
  const p = Object.fromEntries(ET_PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  const dow = DOW_INDEX[p.weekday as string];
  if (dow === undefined) throw new Error(`cron: cannot read an ET weekday from ${JSON.stringify(p.weekday)}`);
  // en-US with hour12:false renders midnight as "24" in some ICU versions.
  const hour = Number(p.hour) % 24;
  return { dow, hour, minute: Number(p.minute) };
}

/**
 * Whether the expression names this minute on the ET wall clock.
 *
 * Day-of-month and month must both be `*`: an ET expression is a weekly
 * pattern, and a date field would have to be resolved in a zone as well,
 * which is the ambiguity this exists to remove.
 */
export function cronMatchesEt(expr: string, at: Date): boolean {
  const c = parseCron(expr);
  if (c.dom.size !== 31 || c.month.size !== 12) {
    throw new Error(`cron ET: day-of-month and month must both be * ("${expr}")`);
  }
  const t = etClock(at);
  return c.minute.has(t.minute) && c.hour.has(t.hour) && c.dow.has(t.dow);
}

/** dueInWindow, read against the ET wall clock. */
export function dueInWindowEt(expr: string, now: Date, windowMinutes: number): boolean {
  const floor = new Date(now.getTime());
  floor.setUTCSeconds(0, 0);
  for (let k = 0; k < windowMinutes; k++) {
    if (cronMatchesEt(expr, new Date(floor.getTime() - k * 60_000))) return true;
  }
  return false;
}

/**
 * Whether the expression named any minute in the last `windowMinutes`,
 * this minute included. A tick that runs on a coarse clock asks this rather
 * than "is it exactly now", and the jobs' own once-only guards (audit rows,
 * sha256, read marks) keep a second tick in the same window from acting twice.
 */
export function dueInWindow(expr: string, now: Date, windowMinutes: number): boolean {
  const floor = new Date(now.getTime());
  floor.setUTCSeconds(0, 0);
  for (let k = 0; k < windowMinutes; k++) {
    if (cronMatches(expr, new Date(floor.getTime() - k * 60_000))) return true;
  }
  return false;
}

const MINUTES_PER_WEEK = 7 * 24 * 60;

/** Every minute-of-week a `* *` day-of-month/month expression names. Throws when it restricts either. */
function minutesOfWeek(expr: string, name: string): number[] {
  const c = parseCron(expr);
  if (c.dom.size !== 31 || c.month.size !== 12) {
    throw new Error(`cron ${name}: day-of-month and month must both be * to compare schedules ("${expr}")`);
  }
  const out: number[] = [];
  for (const d of c.dow) for (const h of c.hour) for (const m of c.minute) out.push(d * 1440 + h * 60 + m);
  return out.sort((a, b) => a - b);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A minute-of-week as "Wed 10:00 UTC", for naming a slot a tick never sees. */
export function describeSlot(minuteOfWeek: number): string {
  const d = Math.floor(minuteOfWeek / 1440);
  const h = Math.floor((minuteOfWeek % 1440) / 60);
  const m = minuteOfWeek % 60;
  return `${DAYS[d]} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} UTC`;
}

/**
 * The slots of `jobExpr` that no run of `tickExpr` would observe, given that a
 * tick looks back `windowMinutes` (itself included).
 */
export function unobservedSlots(jobExpr: string, tickExpr: string, windowMinutes: number): string[] {
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1) throw new Error("cron: windowMinutes must be a positive integer");
  const ticks = minutesOfWeek(tickExpr, "tick");
  if (ticks.length === 0) throw new Error(`cron tick: "${tickExpr}" names no minute`);
  const covered = (slot: number): boolean =>
    ticks.some((t) => (((t - slot) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK <= windowMinutes - 1);
  return minutesOfWeek(jobExpr, "job").filter((s) => !covered(s)).map(describeSlot);
}

/** Whether every run of `tickExpr` finds `jobExpr` due: the job cannot lose a run however the ticks fall. */
export function dueAtEveryTick(jobExpr: string, tickExpr: string, windowMinutes: number): boolean {
  const job = new Set(minutesOfWeek(jobExpr, "job"));
  return minutesOfWeek(tickExpr, "tick").every((t) => {
    for (let k = 0; k < windowMinutes; k++) if (job.has((((t - k) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK)) return true;
    return false;
  });
}

/**
 * The slots a job would lose to the tick, or none when it loses nothing.
 *
 * A schedule is only as good as the tick that observes it: a slot falling in
 * the gap between two ticks never runs, which is how the pick-reminder's
 * 10:00 UTC slot sat before the first tick of the day and the EDT early
 * reminder would have gone four hours late (issue #41). Two shapes lose
 * nothing, and a job has to be one of them: either every slot it names is
 * observed, or it is due at every tick anyway. The sweep is the second - it
 * names every hour on purpose, so the overnight hours the Routine sleeps
 * through are not lost runs but hours nobody meant to sweep.
 */
export function missedSlots(jobExpr: string, tickExpr: string, windowMinutes: number): string[] {
  if (dueAtEveryTick(jobExpr, tickExpr, windowMinutes)) return [];
  return unobservedSlots(jobExpr, tickExpr, windowMinutes);
}

// ------------------------------ does the tick observe an ET-stated schedule?
//
// The tick's own cron is UTC, so an ET slot has to be compared in a common
// frame - and it lands on TWO different UTC minutes across a season, four
// hours ahead in EDT and five in EST. Both have to be observed or the slot
// runs for half the year and silently does not for the other half, which is
// the failure a fixed UTC cron makes certain and this makes visible.

/** The two offsets America/New_York takes, as hours ahead of ET. */
export const ET_OFFSET_HOURS: ReadonlyArray<{ label: "EDT" | "EST"; hours: number }> = [
  { label: "EDT", hours: 4 },
  { label: "EST", hours: 5 },
];

/** Every minute-of-week an ET weekly expression names, on the ET clock. */
function etMinutesOfWeek(expr: string, name: string): number[] {
  const c = parseCron(expr);
  if (c.dom.size !== 31 || c.month.size !== 12) {
    throw new Error(`cron ${name}: day-of-month and month must both be * in an ET schedule ("${expr}")`);
  }
  const out: number[] = [];
  for (const d of c.dow) for (const h of c.hour) for (const m of c.minute) out.push(d * 1440 + h * 60 + m);
  return out.sort((a, b) => a - b);
}

/** "Sun 22:00 ET = Mon 03:00 UTC (EST)" - both readings, so the shift is visible. */
export function describeEtSlot(etMinuteOfWeek: number, offset: { label: string; hours: number }): string {
  const utc = (((etMinuteOfWeek + offset.hours * 60) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  const et = describeSlot(etMinuteOfWeek).replace(" UTC", " ET");
  return `${et} = ${describeSlot(utc)} (${offset.label})`;
}

/**
 * The slots of an ET-stated schedule that no run of `tickExpr` would observe,
 * in either offset. Empty means the schedule is safe all year.
 */
export function unobservedEtSlots(etExpr: string, tickExpr: string, windowMinutes: number): string[] {
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1) throw new Error("cron: windowMinutes must be a positive integer");
  const ticks = minutesOfWeek(tickExpr, "tick");
  if (ticks.length === 0) throw new Error(`cron tick: "${tickExpr}" names no minute`);
  const covered = (slot: number): boolean =>
    ticks.some((t) => (((t - slot) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK <= windowMinutes - 1);
  const out: string[] = [];
  for (const slot of etMinutesOfWeek(etExpr, "job")) {
    for (const off of ET_OFFSET_HOURS) {
      const utc = (((slot + off.hours * 60) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
      if (!covered(utc)) out.push(describeEtSlot(slot, off));
    }
  }
  return out;
}
