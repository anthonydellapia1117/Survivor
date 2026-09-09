// Resolution of what a player wrote to what the roster holds.
//
// Entry names are matched exactly, then with case, "#", spacing and
// punctuation set aside, then through the alias table and the owner's own
// name; never fuzzily (CLAUDE.md, Matching). A typo in a name is staged with
// its candidates, not guessed. Only team words carry a one-letter allowance,
// against a closed vocabulary of 32 names. No stored name is ever changed
// here, and every match is shown to Anthony before a row is written.

import { NFL_TEAMS, SKIP_WEEK, TEAM_NAME } from "@/lib/standing";
import { ENTRY_ALIASES } from "../aliases";

export interface RosterEntry {
  id: string;
  entryName: string;
  ownerId: string;
  /** "First Last" as stored, edge whitespace included. */
  ownerName: string;
  ownerEmail: string | null;
  playerEmail: string | null;
  /** Somebody else plays this entry (entries.is_gifted). */
  isGifted?: boolean;
}

/** Case, "#" and whitespace do not count. Nothing else is loosened. */
export function entryKey(s: string): string {
  return s.toLowerCase().replace(/#/g, "").replace(/\s+/g, " ").trim();
}

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// ---------------------------------------------------------------- teams

const FULL = new Map(NFL_TEAMS.map((t) => [t.name.toLowerCase(), t.abbr]));
const NICK = new Map<string, string>();
const CITY = new Map<string, string[]>();
for (const t of NFL_TEAMS) {
  const parts = t.name.toLowerCase().split(" ");
  NICK.set(parts[parts.length - 1], t.abbr);
  const city = parts.slice(0, -1).join(" ");
  CITY.set(city, [...(CITY.get(city) ?? []), t.abbr]);
}
const TEAM_ALIASES: Record<string, string> = {
  niners: "SF",
  jags: "JAX",
  pats: "NE",
  skins: "WAS",
  bucs: "TB",
  vikes: "MIN",
  bolts: "LAC",
  pack: "GB",
  fins: "MIA",
  cards: "ARI",
  hawks: "SEA",
  gmen: "NYG",
  "g-men": "NYG",
  philly: "PHI",
  bengal: "CIN",
  cowboy: "DAL",
};
const ABBR_ALIASES: Record<string, string> = {
  JAC: "JAX",
  WSH: "WAS",
  LVR: "LV",
  SFO: "SF",
  TAM: "TB",
  GNB: "GB",
  KAN: "KC",
  NOR: "NO",
  NWE: "NE",
};

/**
 * Team text to an abbreviation, or null. "New York", "Los Angeles" and "LA"
 * name two teams and resolve to nothing; a multi-word string falls back to
 * its last word as the nickname, which is what carries a typo like
 * "Los Angles Chargers" home.
 */
function cleanTeam(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
}

export function resolveTeam(raw: string): string | null {
  const cleaned = cleanTeam(raw);
  if (!cleaned) return null;
  if (["bye", "skip", "skip week", "skip_week"].includes(cleaned)) return SKIP_WEEK;
  const up = cleaned.toUpperCase();
  if (up in TEAM_NAME) return up;
  if (up in ABBR_ALIASES) return ABBR_ALIASES[up];
  const full = FULL.get(cleaned);
  if (full) return full;
  const nick = NICK.get(cleaned);
  if (nick) return nick;
  if (cleaned in TEAM_ALIASES) return TEAM_ALIASES[cleaned];
  const city = CITY.get(cleaned);
  if (city && city.length === 1) return city[0];
  const words = cleaned.split(" ");
  if (words.length > 1) {
    const last = words[words.length - 1];
    const byLast = NICK.get(last) ?? TEAM_ALIASES[last];
    if (byLast) return byLast;
  }
  return null;
}

/**
 * A team and nothing else: every word must belong to that team's name, its
 * nickname or an alias, one typo allowed per word. "Los Angles Chargers"
 * passes; "Pumpy321 Chargers" does not, because Pumpy321 is somebody's entry.
 */
export function strictTeam(raw: string): string | null {
  const cleaned = cleanTeam(raw);
  const team = resolveTeam(cleaned);
  if (!team) return null;
  // The bye is a sentinel, not a team, so the word check below has no name to
  // check against: TEAM_NAME[SKIP_WEEK] is undefined, and "skip week" failed
  // every word against the empty string while the one-word "bye" and "skip"
  // passed straight through (issue #23).
  if (team === SKIP_WEEK) return team;
  const words = cleaned.split(" ");
  if (words.length === 1) return team;
  const nameWords = (TEAM_NAME[team] ?? "").toLowerCase().split(" ");
  const fits = (w: string) =>
    nameWords.some((nw) => nw === w || (w.length >= 4 && nw.length >= 4 && levenshtein(w, nw) <= 1)) ||
    TEAM_ALIASES[w] === team ||
    NICK.get(w) === team;
  return words.every(fits) ? team : null;
}

// -------------------------------------------------------------- entries

export interface EntryScope {
  /** Entries the sender owns or plays; tried first and preferred on ties. */
  preferredIds?: Set<string>;
}

export type EntryResolution =
  | { ok: true; entry: RosterEntry; how: "exact" | "cosmetic" | "alias" | "tokens" | "owner_name" }
  | {
      ok: false;
      reason: "ambiguous" | "owner_has_multiple_entries" | "unmatched";
      candidates: RosterEntry[];
    };

/** "Waggs 3", "Waggs #3", "TJA # 2" split into a base and a number; "Pumpy321" does not. */
export function splitNumber(raw: string): { base: string; n: number | null } {
  const m = raw.trim().match(/^(.+?)(?:\s+#?|#)\s*(\d+)\s*$/);
  if (!m) return { base: raw.trim(), n: null };
  return { base: m[1].trim(), n: Number(m[2]) };
}

export function resolveEntry(raw: string, roster: RosterEntry[], scope: EntryScope = {}): EntryResolution {
  const trimmed = raw.trim();
  const exact = roster.filter((e) => e.entryName === trimmed);
  if (exact.length === 1) return { ok: true, entry: exact[0], how: "exact" };

  const key = entryKey(trimmed);
  const cosmetic = roster.filter((e) => entryKey(e.entryName) === key);
  if (cosmetic.length === 1) return { ok: true, entry: cosmetic[0], how: "cosmetic" };
  if (cosmetic.length > 1) return { ok: false, reason: "ambiguous", candidates: cosmetic };

  const { base, n } = splitNumber(trimmed);
  const alias = ENTRY_ALIASES[entryKey(base)];
  if (alias) {
    const target = entryKey(n === null ? alias : `${alias} #${n}`);
    const hit = roster.filter((e) => entryKey(e.entryName) === target);
    if (hit.length === 1) return { ok: true, entry: hit[0], how: "alias" };
  }

  const rawTokens = tokens(base);

  // A player naming himself rather than his entry: the whole owner name, or
  // every word of what he wrote inside it (two words at least). A trailing
  // number then picks that owner's numbered entry.
  const owners = new Map<string, RosterEntry[]>();
  for (const e of roster) {
    const ownerTokens = tokens(e.ownerName);
    const ok =
      entryKey(e.ownerName) === entryKey(base) ||
      (rawTokens.length >= 2 && rawTokens.every((t) => ownerTokens.includes(t)));
    if (ok) owners.set(e.ownerId, [...(owners.get(e.ownerId) ?? []), e]);
  }
  if (owners.size === 1) {
    const [entries] = owners.values();
    if (entries.length === 1) return { ok: true, entry: entries[0], how: "owner_name" };
    if (n !== null) {
      const numbered = entries.filter((e) => splitNumber(e.entryName).n === n);
      if (numbered.length === 1) return { ok: true, entry: numbered[0], how: "owner_name" };
    }
    return { ok: false, reason: "owner_has_multiple_entries", candidates: entries };
  }
  if (owners.size > 1) {
    return { ok: false, reason: "ambiguous", candidates: Array.from(owners.values()).flat() };
  }

  if (rawTokens.length > 0) {
    const candidates = roster.filter((e) => {
      const en = splitNumber(e.entryName);
      if (n !== null && en.n !== n) return false;
      // Exact on the words, never fuzzy (CLAUDE.md, Matching): case, "#",
      // spacing and punctuation are already loosened by tokens(); a typo'd
      // name matches nothing here and is staged with its candidates. Team
      // words keep their one-letter allowance in strictTeam, a closed
      // vocabulary of 32 names whose abbreviation is shown before any write.
      const et = tokens(en.base);
      return rawTokens.every((rt) => et.includes(rt));
    });
    const preferred = scope.preferredIds ? candidates.filter((e) => scope.preferredIds!.has(e.id)) : [];
    if (preferred.length === 1) return { ok: true, entry: preferred[0], how: "tokens" };
    if (preferred.length > 1) return { ok: false, reason: "ambiguous", candidates: preferred };
    if (candidates.length === 1) return { ok: true, entry: candidates[0], how: "tokens" };
    if (candidates.length > 1) return { ok: false, reason: "ambiguous", candidates };
  }
  return { ok: false, reason: "unmatched", candidates: [] };
}

// ------------------------------------------------------------ pick text

export interface RawPick {
  /** What the player wrote for the entry; null when only a team was given. */
  entryRaw: string | null;
  teamRaw: string;
  team: string;
  line: string;
  /** "Eagles for both": one team for every entry the sender has. */
  all: boolean;
}

const SEPARATORS = [" - ", " – ", " — ", ": ", " = ", " -> ", "\t", ", ", " , "];

/**
 * Lines of "entry, team" in any of the shapes players use. A line that does
 * not name a resolvable team is returned as unparsed, never dropped.
 */
export function parsePickLines(text: string): { picks: RawPick[]; unparsed: string[] } {
  const picks: RawPick[] = [];
  const unparsed: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line) continue;
    const both = line.match(/^(.+?)\s+for\s+(?:both|all|each)\b.*$/i);
    if (both) {
      const team = strictTeam(both[1]);
      if (team) {
        picks.push({ entryRaw: null, teamRaw: both[1].trim(), team, line, all: true });
        continue;
      }
    }
    let found: RawPick | null = null;
    for (const sep of SEPARATORS) {
      const idx = line.indexOf(sep);
      if (idx <= 0) continue;
      const left = line.slice(0, idx).trim();
      const right = line.slice(idx + sep.length).trim();
      const rightTeam = strictTeam(right);
      if (rightTeam && left) {
        found = { entryRaw: left, teamRaw: right, team: rightTeam, line, all: false };
        break;
      }
      const leftTeam = strictTeam(left);
      if (leftTeam && right) {
        found = { entryRaw: right, teamRaw: left, team: leftTeam, line, all: false };
        break;
      }
    }
    if (!found) {
      const whole = strictTeam(line);
      if (whole) found = { entryRaw: null, teamRaw: line, team: whole, line, all: false };
    }
    if (!found) {
      const words = line.split(/\s+/);
      for (let k = 1; k <= 3 && k < words.length && !found; k++) {
        const teamRaw = words.slice(-k).join(" ");
        const team = strictTeam(teamRaw);
        if (team) {
          found = { entryRaw: words.slice(0, -k).join(" "), teamRaw, team, line, all: false };
        }
      }
    }
    if (found) picks.push(found);
    else unparsed.push(line);
  }
  return { picks, unparsed };
}

/** The player's own words: quoted history and signatures removed. */
export function stripQuotedReply(body: string): string {
  const out: string[] = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^On .+wrote:\s*$/i.test(line)) break;
    // Gmail wraps a long attribution: "On Mon, Sep 7, 2026 at 8:16 AM Name <"
    // then "address> wrote:" on the next line or two.
    if (/^On .+/.test(line) && lines.slice(i + 1, i + 3).some((l) => /wrote:\s*$/i.test(l))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^From:\s.+/i.test(line) && out.length > 0) break;
    if (/^--\s*$/.test(line)) break;
    if (/^Sent from my /i.test(line)) continue;
    if (line.trimStart().startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * Where a pick came from, for picks.source. Mail read from Gmail is always
 * "email"; the flag only names what pasted or filed text was transcribed from
 * (a text message by default, an email body pasted by hand with --source
 * email). Letting the flag relabel a Gmail message would misattribute the
 * pick in the audit trail.
 */
export function pickSourceFor(
  mode: "gmail" | "paste",
  flag: "email" | "text" | null,
): "email" | "text" {
  if (mode === "gmail") return "email";
  return flag ?? "text";
}

/**
 * Which queue row an unresolved line becomes. "player_question" when a known
 * person is behind the line, which means the line resolved to a scope of
 * entries they own or play (a Gmail address on the roster, or a --from that
 * matched one owner, with or without an address on file). "identity" when
 * nobody known is: pasted text with no --from, or an address that matches
 * no owner or player.
 */
export function pendingKind(
  senderAddress: string | null,
  scopeEntryCount: number,
): "identity" | "player_question" {
  void senderAddress;
  return scopeEntryCount > 0 ? "player_question" : "identity";
}

/**
 * The week a message names ("Re: Week 1 picks - Kris - 2 entries",
 * "WEEK 12", "week #3"), or null when it names none or names one outside
 * 1 to 18. A reply says which week it answers; the command's week is only
 * the fallback for a message that says nothing. Without this, a Week N
 * reply read after Friday noon lands in Week N+1 as an on-time pick.
 */
export function weekNamedIn(text: string): number | null {
  const m = /\bweek\s*#?\s*(\d{1,2})\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 18 ? n : null;
}

/** The first few non-empty lines of a body, where a week is usually named. */
export function leadingLines(text: string, count = 5): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, count)
    .join("\n");
}

/**
 * A known sender may pick only for the entries they own or play. An entry
 * named in their message that resolves elsewhere on the roster is staged,
 * never written: a buyer naming a giftee's entry, or anyone naming a
 * stranger's, has no authority over that pick (CLAUDE.md, Gifted entries).
 * With no sender scope (pasted text, no --from) the roster is Anthony's.
 */
export function scopeCheck(entryId: string, scopeIds: Set<string>): "ok" | "outside" {
  if (scopeIds.size === 0) return "ok";
  return scopeIds.has(entryId) ? "ok" : "outside";
}

/**
 * When a pick counts as made: the moment the mail arrived when there is
 * one, otherwise now. A reply that beat its deadline stays on time however
 * long it waited to be read; the RPC is given the same instant.
 */
export function effectiveSubmitTime(receivedAt: string | null, now: Date): Date {
  if (!receivedAt) return now;
  const t = new Date(receivedAt);
  return Number.isNaN(t.getTime()) ? now : t;
}

export interface ExistingPick {
  team: string;
  submitted_at: string;
  result: string | null;
}

const FINAL_RESULTS = new Set(["win", "loss", "tie_loss", "missed"]);

/**
 * Whether a proposed pick may replace the current one without Anthony
 * deciding first. Three cases are staged, never written:
 *   - the current pick is already scored: a reply on an old thread must not
 *     roll a result back
 *   - the current pick is newer than this message: an older unread mail
 *     never overrides a later choice
 *   - the message arrived after the lock and a pick is already on file: a
 *     change after the lock is Anthony's call
 * A first pick after the lock is not blocked here; it is written with its
 * late flag, which is what the flag is for.
 */
export function overrideDecision(
  existing: ExistingPick | null,
  madeAt: Date,
  lateDeadlineIso: string,
): { ok: true } | { ok: false; reason: string } {
  if (!existing) return { ok: true };
  if (existing.result && FINAL_RESULTS.has(existing.result)) {
    return { ok: false, reason: `already scored (${existing.team} ${existing.result}); a change needs Anthony` };
  }
  if (new Date(existing.submitted_at).getTime() > madeAt.getTime()) {
    return { ok: false, reason: `older than the current pick (${existing.team}, made later); Anthony decides` };
  }
  // Judged at the moment the message arrived (madeAt), never at the moment
  // the command happened to run: a correction that beat the lock stays a
  // correction however long it waited to be read.
  if (madeAt.getTime() > new Date(lateDeadlineIso).getTime()) {
    return { ok: false, reason: `after the lock with ${existing.team} already on file; a change needs Anthony` };
  }
  return { ok: true };
}

/**
 * The week a message means: the player's own words first (the leading
 * lines of the unquoted body), then the subject, which a reply inherits
 * from whatever thread it answers. "Week 2: Chiefs" sent as a reply on the
 * Week 1 thread is a Week 2 pick.
 */
export function weekOfMessage(subject: string, body: string): number | null {
  return weekNamedIn(leadingLines(stripQuotedReply(body))) ?? weekNamedIn(subject);
}

/**
 * A week heading is not an entry: "Week 2: Chiefs" is a bare pick of the
 * Chiefs for Week 2 (the week is read separately by weekOfMessage), and a
 * line that is only "Week 2" or "Week 2 picks" carries nothing.
 */
export function stripWeekHeading(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*week\s*#?\s*\d{1,2}\b\s*(?:picks?)?\s*[:\-]?\s*/i, ""))
    .join("\n");
}

/**
 * Keys (one entry in one message and week) that were given more than one
 * team. One entry, one team, or it is reported: a message that names two
 * teams for the same entry is staged for Anthony, never written in the order
 * the lines happened to come.
 */
export function conflictingKeys(items: { key: string; team: string }[]): Set<string> {
  const teams = new Map<string, Set<string>>();
  for (const i of items) {
    if (!teams.has(i.key)) teams.set(i.key, new Set());
    teams.get(i.key)!.add(i.team);
  }
  return new Set([...teams].filter(([, t]) => t.size > 1).map(([k]) => k));
}

/**
 * The week a team was already used by this entry, or null. A repeated team
 * is an elimination in her pool (CLAUDE.md), not a warning: the intake
 * stages it for Anthony instead of writing it as an ordinary pick.
 */
export function repeatedWeek(team: string, prior: Map<string, number> | undefined): number | null {
  const w = prior?.get(team);
  return w === undefined ? null : w;
}

/**
 * The entries a message's sender may pick for. A known address gets the
 * entries it plays (entriesFor: own entries, plus gifts addressed to it); a
 * --from owner matched by name gets the entries that owner plays themselves,
 * never a gifted one, with or without an address. With an address the giftee
 * is the one asked; without one the pick belongs to nobody the roster can
 * reach yet, and the buyer's "for all" must not write it (CLAUDE.md, Gifted
 * entries).
 */
export function scopeEntriesFor(
  item: { senderAddress: string | null; fromOwnerId: string | null },
  roster: RosterEntry[],
  entriesFor: (address: string) => RosterEntry[],
): RosterEntry[] {
  if (item.senderAddress) return entriesFor(item.senderAddress);
  if (item.fromOwnerId) return roster.filter((e) => e.ownerId === item.fromOwnerId && !e.isGifted);
  return [];
}

/**
 * A sender who was identified, by address or by --from, but has no live
 * entry to pick for (a declined owner, a voided roster, an owner with no
 * entries). Nothing such a message names is written: a named entry would
 * otherwise resolve against the whole roster and record another owner's
 * pick. Pasted text with no sender at all is Anthony transcribing and is
 * not unplaced.
 */
export function senderUnplaced(item: { senderAddress: string | null; fromOwnerId: string | null }, scopeCount: number): boolean {
  return (item.senderAddress !== null || item.fromOwnerId !== null) && scopeCount === 0;
}

/**
 * The one-entry-one-team check counts every team a message gave an entry,
 * a repeated team staged as an elimination included: "Kris #1 - Eagles" and
 * "Kris #1 - Chiefs" in one message is a conflict whether or not the Eagles
 * were already used, and neither is written. Without the staged repeats the
 * check would see only the new team and write it.
 */
export function conflictedKeys(proposals: { key: string; team: string }[], stagedRepeats: { key: string; team: string }[]): Set<string> {
  return conflictingKeys([...proposals, ...stagedRepeats]);
}

/**
 * What identifies one message for the per-message checks (one entry, one
 * team; conflicts; duplicates): the Gmail message id, never the display
 * label. Two replies from one sender with the same subject and Date header
 * are two messages, and the later one is a correction, not a contradiction.
 * Pasted or filed text, which has no message id, gets its label and the
 * ordinal of the item in this run.
 */
export function itemIdentity(messageId: string | null, label: string, ordinal: number): string {
  return messageId ?? `${label}#${ordinal}`;
}

/**
 * What the push notification says about a staged row: the kind and the
 * week, never the reason or the line. Both can carry a team, and a pick is
 * not public before kickoff (the same rule the notification contract in
 * docs/PICKS_INTAKE.md states).
 */
export function stagedDetail(week: number): string {
  return `week ${week} - /admin/queue`;
}

/** Two-letter team text that names two teams: staged as a question, never dropped as noise. */
const AMBIGUOUS_TEAM_TEXT = new Set(["la", "ny"]);

/**
 * Why a line that parsed as no pick still needs Anthony, or null when it
 * is noise (a greeting, thanks, a word or two with no team in it). "LA" and
 * "NY" are the exception to the short-line rule: strictTeam cannot choose
 * between the two local teams, so the line is surfaced as a question rather
 * than left unread to come round again on every run.
 */
export function unparsedReason(line: string): string | null {
  const t = line.trim();
  const letters = t.replace(/[^A-Za-z]/g, "").toLowerCase();
  if (AMBIGUOUS_TEAM_TEXT.has(letters)) return `"${t}" names two teams; which one?`;
  if (!/[A-Za-z]{3,}/.test(t)) return null;
  if (/^(hi|hey|hello|thanks|thank you|thx)\b/i.test(t)) return null;
  return "no team recognised on this line";
}


/**
 * Why this entry may not take a bye in this week, or null when it may.
 *
 * The database is the authority - admin_submit_pick raises on each of these -
 * but a pick that only fails at the write kills the run: the proposals before
 * it are written, the rest are not, and the remaining mail stays unread until
 * the next sweep (issue #22). Checked here so an ineligible bye is staged as
 * a question like any other, and the run finishes.
 *
 * The three rules are the rules engine's, in its order: the bye opens after
 * the double-elimination weeks, it is not earned by an entry that took a loss
 * inside them, and it is once. `losses` is the entry's total, which for an
 * entry the intake still takes picks for is the same number: after the double
 * weeks a loss eliminates, and an eliminated entry is off the intake roster.
 */
export function byeRefusal(
  week: number,
  standing: { losses: number; bye_used: boolean } | null,
  doubleElimThroughWeek: number,
): string | null {
  if (week <= doubleElimThroughWeek) return `bye may only be used from week ${doubleElimThroughWeek + 1} on`;
  if (!standing) return "no standings row for this entry; the bye cannot be judged";
  if (standing.bye_used) return "bye already used";
  if (standing.losses > 0) return `bye not earned: entry took a loss in weeks 1-${doubleElimThroughWeek}`;
  return null;
}


/**
 * Which of a message's accepted picks may stand as what the NEXT message in
 * the same run is judged against.
 *
 * Every message used to be compared with the snapshot taken before the run,
 * so an on-time "PHI" and a later after-lock "KC" for one entry both saw no
 * current pick: both were proposed, and the write loop put PHI down and then
 * let KC override it, bypassing the rule that a change after the lock is
 * staged (issue #21).
 *
 * An entry this message gave more than one team is left out. That is the
 * one-entry-one-team conflict, both rows are withdrawn, and neither may stand
 * as the current pick - carrying one forward would turn the next message's
 * conflict into a stale-pick complaint about a pick that was never recorded.
 */
export function picksToCarryForward<T>(
  itemPicks: Map<string, T>,
  itemTeams: Map<string, Set<string>>,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [entryId, row] of itemPicks) {
    if (itemTeams.get(entryId)?.size === 1) out.set(entryId, row);
  }
  return out;
}
