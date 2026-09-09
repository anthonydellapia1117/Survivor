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
