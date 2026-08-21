// Helpers for the payments screen: dollar-string <-> cents conversion and
// plain-date formatting that never routes a YYYY-MM-DD through a timezone
// (new Date("2026-08-14") is UTC midnight and shifts a day when rendered
// in ET, so paid_on is formatted from its parts).

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatPaidOn(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return date;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/**
 * "30", "30.00", "$30", "-25", "-$12.50" -> cents. Null when unparseable.
 * Negative amounts are legal: corrections subtract.
 */
export function parseDollarsToCents(raw: string): number | null {
  const m = /^\s*(-?)\s*\$?\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(raw);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + (m[3] ? Number(m[3].padEnd(2, "0")) : 0);
  return m[1] === "-" ? -cents : cents;
}

/** Cents -> the dollar string an admin would type: 3000 -> "30", -1250 -> "-12.50". */
export function centsToDollarInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return abs % 100 === 0
    ? `${sign}${abs / 100}`
    : `${sign}${(abs / 100).toFixed(2)}`;
}

/** Today as YYYY-MM-DD in the admin's local timezone (for the date input default). */
export function todayIsoLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
