// Anthony's own picks, dictated into a self-email.
//
// He takes picks by text and by phone. Set by him on 2026-09-10: he enters
// them by emailing HIMSELF, subject carrying "Survivor", one pick per line:
//
//     1073 LAC
//     Nolan Lawrence #1 Los Angeles Chargers
//
// Until this existed the sweep could not see those mails at all - and that is
// on purpose, not an oversight. intakeAddresses drops the admin's own mailbox
// because his free entries sit under his own owner row, so every self-sent
// chase or distribute copy would otherwise be read as a player's picks. This
// module is the ONE narrow way back in, and it is strict where the ordinary
// intake is forgiving:
//
//   - the sender must be the admin mailbox, checked by the caller;
//   - a NUMBER is an exact lynne_number, never a near one;
//   - a NAME must match exactly one live entry, normalised only for case and
//     surrounding whitespace. There is NO fuzzy match here. The ordinary
//     intake's resolveEntry falls back to tokens and owner names, which is
//     right for a player naming their own entry and wrong for a line that
//     will be written without anyone reading it again;
//   - a TEAM must resolve to exactly one team that PLAYS THAT WEEK. A team on
//     a bye, a team that does not play, and a bye pick itself all stage.
//
// Anything that does not satisfy all of that is staged as a question. Nothing
// here guesses.

import { strictTeam } from "./resolve";
import { SKIP_WEEK } from "@/lib/standing";

/** The subject must carry this word, so an ordinary self-sent mail is not a pick list. */
export const SELF_PICK_SUBJECT_TERM = "survivor";

/** The most trailing words tried as a team name ("Los Angeles Chargers" is three). */
export const MAX_TEAM_WORDS = 4;

export function isSelfPickSubject(subject: string): boolean {
  return new RegExp(`\\b${SELF_PICK_SUBJECT_TERM}\\b`, "i").test(subject ?? "");
}

export interface SelfEntry {
  id: string;
  entryName: string;
  lynneNumber: number | null;
}

export type SelfPickRow =
  | { ok: true; entryId: string; entryName: string; lynneNumber: number | null; team: string; line: string }
  | { ok: false; line: string; reason: string };

/** Case and surrounding whitespace only. Internal spacing is the owner's and still counts. */
function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The team at the END of the line and the reference in front of it.
 *
 * Longest trailing match wins, or "1073 Los Angeles Chargers" would split at
 * "Chargers" and leave "1073 Los Angeles" as the reference.
 */
export function splitRefAndTeam(line: string): { ref: string; team: string } | null {
  const words = line.trim().split(/\s+/);
  for (let take = Math.min(MAX_TEAM_WORDS, words.length - 1); take >= 1; take--) {
    const team = strictTeam(words.slice(words.length - take).join(" "));
    if (team !== null) return { ref: words.slice(0, words.length - take).join(" "), team };
  }
  return null;
}

/** The one live entry a reference names, or why it names none. Exact only. */
export function resolveSelfRef(ref: string, entries: SelfEntry[]): SelfEntry | { reason: string } {
  const raw = ref.trim();
  if (raw === "") return { reason: "no entry named before the team" };
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const hit = entries.filter((e) => e.lynneNumber === n);
    if (hit.length === 1) return hit[0];
    return { reason: `no live entry carries Lynne number ${n}` };
  }
  const want = norm(raw);
  const hit = entries.filter((e) => norm(e.entryName) === want);
  if (hit.length === 1) return hit[0];
  if (hit.length === 0) return { reason: `no live entry is named exactly "${raw}"` };
  return { reason: `${hit.length} live entries are named "${raw}" - use the Lynne number` };
}

/**
 * One row per non-empty line of the body, in order. A row is either a pick
 * ready to write or a reason it was not.
 *
 * `playsThisWeek` is the set of team codes with a game in this week, which is
 * what stops a dictated typo landing on a team that is not playing.
 */
export function parseSelfPickEmail(
  body: string,
  week: number,
  entries: SelfEntry[],
  playsThisWeek: ReadonlySet<string>,
): SelfPickRow[] {
  const out: SelfPickRow[] = [];
  for (const rawLine of (body ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (line === "") continue;
    const split = splitRefAndTeam(line);
    if (split === null) {
      out.push({ ok: false, line, reason: "no team recognised at the end of this line" });
      continue;
    }
    if (split.team === SKIP_WEEK) {
      out.push({ ok: false, line, reason: "a bye is not entered this way - use the admin screen" });
      continue;
    }
    if (!playsThisWeek.has(split.team)) {
      out.push({ ok: false, line, reason: `${split.team} has no game in week ${week}` });
      continue;
    }
    const entry = resolveSelfRef(split.ref, entries);
    if ("reason" in entry) {
      out.push({ ok: false, line, reason: entry.reason });
      continue;
    }
    out.push({
      ok: true,
      entryId: entry.id,
      entryName: entry.entryName,
      lynneNumber: entry.lynneNumber,
      team: split.team,
      line,
    });
  }
  return out;
}

/** One entry, one team, per message: two lines for the same entry stage both. */
export function conflictingSelfRows(rows: SelfPickRow[]): Set<string> {
  const teams = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.ok) continue;
    const seen = teams.get(r.entryId) ?? new Set<string>();
    seen.add(r.team);
    teams.set(r.entryId, seen);
  }
  return new Set([...teams.entries()].filter(([, t]) => t.size > 1).map(([id]) => id));
}

/** The reply Anthony gets: what applied, what did not, under ten lines. */
export function selfPickReply(rows: SelfPickRow[], week: number): string {
  const applied = rows.filter((r): r is Extract<SelfPickRow, { ok: true }> => r.ok);
  const staged = rows.filter((r): r is Extract<SelfPickRow, { ok: false }> => !r.ok);
  const lines: string[] = [`Week ${week}: ${applied.length} applied, ${staged.length} staged.`];
  for (const r of applied.slice(0, 4)) lines.push(`applied ${r.lynneNumber ?? r.entryName} ${r.team}`);
  if (applied.length > 4) lines.push(`applied ${applied.length - 4} more`);
  for (const r of staged.slice(0, 3)) lines.push(`staged "${r.line}" - ${r.reason}`);
  if (staged.length > 3) lines.push(`staged ${staged.length - 3} more - see /admin/queue`);
  return lines.slice(0, 9).join("\n");
}
