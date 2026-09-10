// Her picks as a plain-text email: the second shape she publishes them in.
//
// Set by Anthony on 2026-09-10. She does not always send a sheet. Before the
// Wednesday and Thursday games of Week 1 she sent a message with no
// attachment at all - Gmail 1a08631cab24c4ce, "Wednesday and Thursday Games",
// 2026-09-09 8:43 AM ET - shaped as a heading naming a team, then one line per
// entry:
//
//   The following people are picking Seattle:
//   #144-Chris Mierzwa 11
//   #573- Judy Manzi
//
//   The following is taking the LA Rams:
//   #1200-Brett
//
// Pure: text in, rows out. Nothing here reads Gmail, touches the database, or
// decides anything about our own picks.
//
// THREE RULES THIS FILE EXISTS TO KEEP.
//
// 1. MATCH BY NO., NEVER BY NAME. The name after the dash is read and carried
//    for the report only. Her NAMES text is free-form, it repeats, and it
//    carries her own typos; her NO. is the key. Nothing downstream is allowed
//    to reach for the name.
//
// 2. A WORD THAT DOES NOT MAP EXACTLY STOPS THE RUN. Her heading is matched
//    against the vocabulary in ./names.ts, whole words, case-insensitively. A
//    heading that maps to nothing, or to more than one team, is not guessed
//    at: it is returned as an `unmapped` heading and the caller prints it and
//    writes nothing. "New York" maps to neither NY Giants nor NY Jets, and
//    that is exactly the case where guessing would put a pick on the wrong
//    team.
//
// 3. HER LIST IS PARTIAL. What comes back is only what she stated. There is no
//    row here for an entry she did not name, and its absence means nothing at
//    all - not a missing pick, and certainly not an elimination.

import { LYNNE_TEAM_NAME } from "./names";

export interface LynnePickLine {
  /** Her NO. The only thing matched on. */
  no: number;
  /** The text after the dash, verbatim. Carried for the report; never matched on. */
  name: string;
  /** Her team word, verbatim, exactly as the heading spelled it. */
  teamText: string;
  /** That word mapped to this app's code. */
  teamAbbr: string;
  /** 1-based line number in the body, so a report can point at it. */
  line: number;
}

export interface UnmappedHeading {
  line: number;
  text: string;
  reason: string;
}

export interface ParsedPickEmail {
  picks: LynnePickLine[];
  /** Headings that governed entry lines and mapped to no single team. Non-empty means STOP. */
  unmapped: UnmappedHeading[];
  /** Entry lines that appeared before any heading at all. Non-empty means STOP. */
  orphans: { line: number; text: string }[];
}

/**
 * `#144-Chris Mierzwa 11`, `#573- Judy Manzi`, `# 1005 - E.A.T.`
 *
 * The separator is a hyphen, an en dash or an em dash: she types on a phone
 * and a keyboard, and one of them substitutes. The name may be empty.
 */
const ENTRY_LINE = /^\s*#\s*(\d{1,6})\s*[-–—]\s*(.*?)\s*$/;

/** Her vocabulary, longest first, so "LA Rams" is tried before nothing shorter shadows it. */
const VOCABULARY: { abbr: string; name: string; re: RegExp }[] = Object.entries(LYNNE_TEAM_NAME)
  .map(([abbr, name]) => ({
    abbr,
    name,
    // Whole words only: "Miami" must not match inside a longer word, and a
    // team name is never found as a fragment of another.
    re: new RegExp(`(?<![A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "i"),
  }))
  .sort((a, b) => b.name.length - a.name.length);

interface HeadingMatch {
  teamText: string;
  teamAbbr: string;
  reason?: string;
}

/**
 * The team a heading names, or why it names none.
 *
 * Two teams in one line is a stop, not a longest-wins: "Seattle over Miami"
 * would silently become Seattle, and a heading that reads that way is not a
 * heading this parser understands. The exception is a pair where one name
 * contains the other, which cannot happen in her vocabulary today but would be
 * a containment rather than an ambiguity if it ever did.
 */
export function headingTeam(text: string): HeadingMatch | null {
  const hits = VOCABULARY.filter((v) => v.re.test(text));
  if (hits.length === 0) return null;
  const distinct = hits.filter((h) => !hits.some((o) => o !== h && o.name.toLowerCase().includes(h.name.toLowerCase())));
  if (distinct.length > 1) {
    return {
      teamText: "",
      teamAbbr: "",
      reason: `names more than one team (${distinct.map((d) => d.name).join(", ")})`,
    };
  }
  const hit = distinct[0];
  // Her spelling as the heading wrote it, not the vocabulary's casing: the
  // cell stores what she typed.
  const m = hit.re.exec(text);
  return { teamText: m ? m[0] : hit.name, teamAbbr: hit.abbr };
}

/** Her message body into the rows she stated. Nothing is inferred from silence. */
export function parsePickEmail(body: string): ParsedPickEmail {
  const picks: LynnePickLine[] = [];
  const unmapped: UnmappedHeading[] = [];
  const orphans: { line: number; text: string }[] = [];
  const seenUnmapped = new Set<number>();

  let heading: { line: number; text: string; team: HeadingMatch | null } | null = null;

  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const m = ENTRY_LINE.exec(raw);
    if (m) {
      if (!heading) {
        orphans.push({ line: lineNo, text: raw.trim() });
        continue;
      }
      if (!heading.team || !heading.team.teamAbbr) {
        // Rule 2. Reported once per heading, however many lines sit under it.
        if (!seenUnmapped.has(heading.line)) {
          seenUnmapped.add(heading.line);
          unmapped.push({
            line: heading.line,
            text: heading.text,
            reason: heading.team?.reason ?? "maps to no team in her vocabulary",
          });
        }
        continue;
      }
      picks.push({
        no: Number(m[1]),
        name: m[2],
        teamText: heading.team.teamText,
        teamAbbr: heading.team.teamAbbr,
        line: lineNo,
      });
      continue;
    }
    if (raw.trim() === "") continue;
    // Any other non-blank line becomes the heading the next entry lines answer
    // to. A line that never gets an entry line under it is never looked at, so
    // her greeting and her pot figure cost nothing.
    heading = { line: lineNo, text: raw.trim(), team: headingTeam(raw) };
  }

  return { picks, unmapped, orphans };
}

/** The same NO. stated twice under different teams - hers to settle, never ours. */
export function conflictingNos(picks: LynnePickLine[]): { no: number; teams: string[] }[] {
  const byNo = new Map<number, Set<string>>();
  for (const p of picks) byNo.set(p.no, (byNo.get(p.no) ?? new Set()).add(p.teamAbbr));
  return [...byNo]
    .filter(([, teams]) => teams.size > 1)
    .map(([no, teams]) => ({ no, teams: [...teams].sort() }))
    .sort((a, b) => a.no - b.no);
}
