// Eastern-time wall-clock conversion for the weeks editor. Deadlines are
// entered as ET wall time and stored as UTC; DST is resolved per date.

const ET = "America/New_York";

function etOffsetMs(atUtc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(atUtc).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - atUtc.getTime();
}

/** "2026-09-16" + "12:00" in ET -> UTC ISO string. */
export function etWallToUtc(dateStr: string, timeStr: string): string {
  const naive = Date.parse(`${dateStr}T${timeStr}:00Z`);
  if (Number.isNaN(naive)) throw new Error("bad date/time");
  // Two-pass fixed point handles the DST boundary correctly.
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    guess = naive - etOffsetMs(new Date(guess));
  }
  return new Date(guess).toISOString();
}

/** UTC ISO -> { date: "2026-09-16", time: "12:00" } in ET wall clock. */
export function utcToEtWall(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(d).map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`,
  };
}
