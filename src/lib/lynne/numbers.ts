// Bulk Lynne-number import. Once a season, her numbers come back for the
// whole roster; this parses a pasted list of name-number or number-name
// pairs, matches to entries by EXACT name then case-insensitive name —
// NEVER fuzzy — and reports everything it could not place. Nothing is
// written until the admin approves the shown mapping.

export interface ParsedPair {
  no: number;
  name: string;
  /** 1-based line number in the paste, for reporting. */
  line: number;
}

export interface ParseResult {
  pairs: ParsedPair[];
  /** Lines that fit neither "name number" nor "number name". */
  unparsed: { line: number; text: string }[];
}

const INT = /^\d+$/;

/**
 * Accepts one pair per line: "993  Nick&Kels 1", "Nick&Kels 1, 993",
 * "Nick&Kels 1\t993" — number first or last, tab/comma/space separated.
 * Names may themselves contain spaces and trailing digits, so the number
 * is only ever taken from a line's FIRST or LAST token.
 */
export function parseNumberPairs(text: string): ParseResult {
  const pairs: ParsedPair[] = [];
  const unparsed: { line: number; text: string }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === "") continue;
    // Prefer explicit separators when present.
    const parts = raw.includes("\t")
      ? raw
          .split("\t")
          .map((s) => s.trim())
          .filter(Boolean)
      : raw.includes(",")
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
    if (parts && parts.length === 2) {
      if (INT.test(parts[0]) && !INT.test(parts[1])) {
        pairs.push({ no: Number(parts[0]), name: parts[1], line: i + 1 });
        continue;
      }
      if (INT.test(parts[1]) && !INT.test(parts[0])) {
        pairs.push({ no: Number(parts[1]), name: parts[0], line: i + 1 });
        continue;
      }
    }
    // Whitespace form: number is the first OR last token.
    const tokens = raw.split(/\s+/);
    if (tokens.length >= 2 && INT.test(tokens[0])) {
      pairs.push({
        no: Number(tokens[0]),
        name: tokens.slice(1).join(" "),
        line: i + 1,
      });
      continue;
    }
    if (tokens.length >= 2 && INT.test(tokens[tokens.length - 1])) {
      pairs.push({
        no: Number(tokens[tokens.length - 1]),
        name: tokens.slice(0, -1).join(" "),
        line: i + 1,
      });
      continue;
    }
    unparsed.push({ line: i + 1, text: raw });
  }
  return { pairs, unparsed };
}

export interface NumberTarget {
  id: string;
  entryName: string;
  lynneNumber: number | null;
  /** The name this entry went to Lynne under, when it has since been
   *  renamed. Her numbers come back keyed to HER list, so this is the only
   *  thing a renamed entry's row can match on. */
  submittedAsName?: string | null;
}

export interface NumberMatch {
  entryId: string;
  entryName: string; // ours, verbatim
  pastedName: string; // hers, verbatim
  no: number;
  matchedBy:
    | "entry_name"
    | "entry_name_ci"
    | "submitted_name"
    | "submitted_name_ci";
  /** Number already on this entry, when different — shown as old -> new. */
  replaces: number | null;
}

export interface NumberIssue {
  line: number;
  text: string;
  reason:
    | "no_match"
    | "ambiguous_name"
    | "duplicate_name_in_paste"
    | "duplicate_number_in_paste"
    | "number_taken_by_other_entry";
  detail?: string;
}

export interface MatchNumbersResult {
  matches: NumberMatch[];
  issues: NumberIssue[];
}

export function matchNumberPairs(
  pairs: ParsedPair[],
  targets: NumberTarget[],
): MatchNumbersResult {
  const byName = new Map<string, NumberTarget[]>();
  const byNameCi = new Map<string, NumberTarget[]>();
  // Renamed-after-submission entries: Lynne's paste still carries the OLD
  // name, so index that too. Current names always win; the submitted name is
  // only consulted when nothing current matches. Still exact-then-case-
  // insensitive, never fuzzy.
  const bySubmitted = new Map<string, NumberTarget[]>();
  const bySubmittedCi = new Map<string, NumberTarget[]>();
  for (const t of targets) {
    byName.set(t.entryName, [...(byName.get(t.entryName) ?? []), t]);
    const ci = t.entryName.toLowerCase();
    byNameCi.set(ci, [...(byNameCi.get(ci) ?? []), t]);
    const sub = t.submittedAsName;
    if (sub && sub !== t.entryName) {
      bySubmitted.set(sub, [...(bySubmitted.get(sub) ?? []), t]);
      const subCi = sub.toLowerCase();
      bySubmittedCi.set(subCi, [...(bySubmittedCi.get(subCi) ?? []), t]);
    }
  }
  const numberOwner = new Map<number, NumberTarget>();
  for (const t of targets) {
    if (t.lynneNumber !== null) numberOwner.set(t.lynneNumber, t);
  }

  const matches: NumberMatch[] = [];
  const issues: NumberIssue[] = [];
  const claimedEntries = new Set<string>();
  const numbersSeen = new Map<number, number>(); // no -> line

  for (const p of pairs) {
    const text = `${p.no} ${p.name}`;
    if (numbersSeen.has(p.no)) {
      issues.push({
        line: p.line,
        text,
        reason: "duplicate_number_in_paste",
        detail: `also on line ${numbersSeen.get(p.no)}`,
      });
      continue;
    }

    let hit: { t: NumberTarget; by: NumberMatch["matchedBy"] } | null = null;
    let ambiguous = false;
    const tiers: [
      Map<string, NumberTarget[]>,
      string,
      NumberMatch["matchedBy"],
    ][] = [
      [byName, p.name, "entry_name"],
      [byNameCi, p.name.toLowerCase(), "entry_name_ci"],
      [bySubmitted, p.name, "submitted_name"],
      [bySubmittedCi, p.name.toLowerCase(), "submitted_name_ci"],
    ];
    for (const [index, key, by] of tiers) {
      const found = index.get(key);
      if (!found) continue;
      if (found.length > 1) {
        ambiguous = true;
        break;
      }
      hit = { t: found[0], by };
      break;
    }
    if (ambiguous) {
      issues.push({ line: p.line, text, reason: "ambiguous_name" });
      continue;
    }
    if (!hit) {
      issues.push({ line: p.line, text, reason: "no_match" });
      continue;
    }
    if (claimedEntries.has(hit.t.id)) {
      issues.push({ line: p.line, text, reason: "duplicate_name_in_paste" });
      continue;
    }
    const taken = numberOwner.get(p.no);
    if (taken && taken.id !== hit.t.id) {
      issues.push({
        line: p.line,
        text,
        reason: "number_taken_by_other_entry",
        detail: `NO. ${p.no} is on "${taken.entryName}"`,
      });
      continue;
    }

    numbersSeen.set(p.no, p.line);
    claimedEntries.add(hit.t.id);
    matches.push({
      entryId: hit.t.id,
      entryName: hit.t.entryName,
      pastedName: p.name,
      no: p.no,
      matchedBy: hit.by,
      replaces:
        hit.t.lynneNumber !== null && hit.t.lynneNumber !== p.no
          ? hit.t.lynneNumber
          : null,
    });
  }

  return { matches, issues };
}
