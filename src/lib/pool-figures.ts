// Her four pool-wide figures as typed on the admin form, checked before
// they are saved: each count must be a whole number, and the three counts
// must agree with each other. Pure, so the form's helper text and its save
// path read the same verdict. The implied per-entry figure is an admin-only
// sanity check and is computed only when every count typed is valid.

export function parseCount(s: string): number | null | false {
  const t = s.replace(/[,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : false;
}

export type FigureCheck =
  /** A count that is not a whole number; nothing else is judged. */
  | { kind: "invalid" }
  /** All three counts typed and they do not agree. */
  | { kind: "mismatch"; free: number; paid: number; total: number }
  /** Saveable. The implied rate is null when no divisor or no pot is typed. */
  | { kind: "ok"; perEntryCents: number | null; per: "paying entry" | "entry" };

export function checkFigures(count: string, free: string, paid: string, potCents: number | null): FigureCheck {
  const c = parseCount(count);
  const f = parseCount(free);
  const p = parseCount(paid);
  if (c === false || f === false || p === false) return { kind: "invalid" };
  if (c !== null && f !== null && p !== null && f + p !== c) return { kind: "mismatch", free: f, paid: p, total: c };
  const divisor = p !== null && p > 0 ? p : c !== null && c > 0 ? c : null;
  return {
    kind: "ok",
    perEntryCents: divisor !== null && potCents !== null ? potCents / divisor : null,
    per: p !== null && p > 0 ? "paying entry" : "entry",
  };
}
