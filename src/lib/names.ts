// Entry-name collision detection. Lynne's weekly import matches picks to
// entries BY NAME, so two entries whose names are identical, differ only in
// case/spacing, or sit one typo apart can silently swap picks — and a
// swapped pick looks like an entry that never submitted. These checks warn;
// they never block, because near-identical names (Nick&Kels 1–4) can be
// deliberate.

export type CollisionKind = "exact" | "case" | "edit1";

const KIND_SEVERITY: Record<CollisionKind, number> = {
  exact: 2,
  case: 1,
  edit1: 0,
};

export const KIND_LABEL: Record<CollisionKind, string> = {
  exact: "identical",
  case: "case/spacing only",
  edit1: "one edit apart",
};

/** Casefold + collapse runs of whitespace, so "Tommy  Brads" ~ "tommy brads". */
function fold(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Optimal-string-alignment distance (Levenshtein + adjacent transposition),
 * capped: returns maxOut when the true distance exceeds `max`. Transpositions
 * count because swapped letters are the most common real typo.
 */
export function editDistance(a: string, b: string, max = 1): number {
  if (a === b) return 0;
  const maxOut = max + 1;
  if (Math.abs(a.length - b.length) > max) return maxOut;
  const m = a.length;
  const n = b.length;
  let prev2: number[] | null = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...Array<number>(n).fill(0)];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(
        prev[j] + 1, // deletion
        cur[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
      if (
        prev2 !== null &&
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d = Math.min(d, prev2[j - 2] + 1); // transposition
      }
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return maxOut;
    prev2 = prev;
    prev = cur;
  }
  return prev[n] > max ? maxOut : prev[n];
}

const SET_SUFFIX = /^(.*?)[\s#]*(\d+)$/;

/**
 * The pool's naming convention: "Waggs1"–"Waggs4", "ReRe #1"–"#4",
 * "Nick&Kels 1"–"4". Two names are a deliberate numbered set when they
 * share the IDENTICAL base (case- and punctuation-sensitive — a base that
 * differs only by case is the dangerous tommybrads1/Tommybrads2 class and
 * stays flagged) and carry DIFFERENT trailing numbers (the same number
 * spaced differently is a likely typo duplicate and stays flagged).
 */
export function deliberateSetPair(a: string, b: string): boolean {
  const ma = SET_SUFFIX.exec(a);
  const mb = SET_SUFFIX.exec(b);
  if (!ma || !mb) return false;
  return ma[1] === mb[1] && Number(ma[2]) !== Number(mb[2]);
}

/**
 * How `a` and `b` collide, or null when they are safely distinct.
 * exact  — the very same string
 * case   — equal once case and whitespace are folded
 * edit1  — one insertion/deletion/substitution/transposition apart (folded)
 *
 * Numbered-set pairs (see deliberateSetPair) are the naming convention,
 * not a hazard — they never count as edit1. Pass `sameOwner: false` when
 * the two names belong to DIFFERENT owners: a cross-owner numbered pair
 * is back to being suspicious and is flagged.
 */
export function collisionKind(
  a: string,
  b: string,
  opts?: { sameOwner?: boolean },
): CollisionKind | null {
  if (a === b) return "exact";
  const fa = fold(a);
  const fb = fold(b);
  if (fa === fb) return "case";
  if (editDistance(fa, fb, 1) > 1) return null;
  if (opts?.sameOwner !== false && deliberateSetPair(a, b)) return null;
  return "edit1";
}

export interface NameCollision {
  name: string;
  kind: CollisionKind;
}

/** Every existing name a proposed name collides with, worst kind first. */
export function findCollisions(
  proposed: string,
  existing: string[],
): NameCollision[] {
  const out: NameCollision[] = [];
  for (const name of existing) {
    const kind = collisionKind(proposed, name);
    if (kind) out.push({ name, kind });
  }
  return out.sort((a, b) => KIND_SEVERITY[b.kind] - KIND_SEVERITY[a.kind]);
}

export interface CollisionGroup {
  names: string[];
  kind: CollisionKind; // worst kind found inside the group
}

/**
 * Cluster an existing name list into groups of mutual near-collisions
 * (connected components over pairwise collisions), so Nick&Kels 1–4 read as
 * one group instead of six pairs. Groups keep the input's name order.
 * Pass `owners` (parallel to `names`) so a numbered set is only excused
 * within one owner — the same pattern across two owners stays flagged.
 */
export function collisionGroups(
  names: string[],
  owners?: string[],
): CollisionGroup[] {
  const parent = names.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  const worst = new Map<number, CollisionKind>();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const kind = collisionKind(names[i], names[j], {
        sameOwner: owners ? owners[i] === owners[j] : undefined,
      });
      if (!kind) continue;
      const ri = find(i);
      const rj = find(j);
      const prior = [worst.get(ri), worst.get(rj), kind].filter(
        (k): k is CollisionKind => k !== undefined,
      );
      const merged = prior.sort(
        (a, b) => KIND_SEVERITY[b] - KIND_SEVERITY[a],
      )[0];
      worst.delete(ri);
      worst.delete(rj);
      parent[rj] = ri;
      worst.set(find(ri), merged);
    }
  }
  const members = new Map<number, string[]>();
  for (let i = 0; i < names.length; i++) {
    const r = find(i);
    if (!worst.has(r)) continue;
    if (!members.has(r)) members.set(r, []);
    members.get(r)!.push(names[i]);
  }
  return [...members.entries()].map(([r, ns]) => ({
    names: ns,
    kind: worst.get(r)!,
  }));
}
