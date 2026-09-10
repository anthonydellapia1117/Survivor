// The free ESPN scoreboard feed, read-only and with no key. This module is
// PURE: it builds a URL and turns a payload into rows. Fetching is the
// command's job (scripts/scores/cli.ts) and writing is the database's
// (admin_apply_game_results).
//
// VERIFIED against the live feed on 2026-09-10, all 18 weeks of the 2026
// regular season, before any of this was built:
//
//   - 272 events, matching nfl_games' 272 rows exactly
//   - 32 distinct team abbreviations, and the set difference against ours is
//     WSH <-> WAS in BOTH directions and nothing else
//   - every event's week.number equalled the week requested; no duplicate
//     (week, home, away) pair anywhere in the season
//   - joining the feed to nfl_games on (week, home_team, away_team) after the
//     one rename matched 272 of 272, with nothing unmatched on either side
//
// That last line is why matching on the pair is safe and why an unmatched
// game is treated as a stop rather than something to reconcile: it does not
// happen, so if it ever does, the schedule moved and a person should look.

/** The scoreboard endpoint. No key, no auth, GET only. */
export const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** Regular season. ESPN's seasontype 1 is preseason, 3 the postseason. */
export const ESPN_REGULAR_SEASON = 2;

/** One week of a season: ?dates=<year>&seasontype=2&week=<n>. */
export function espnWeekUrl(season: number, week: number): string {
  if (!Number.isInteger(season) || season < 2000 || season > 2100) throw new Error(`espn: season ${season} is not a year`);
  if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error(`espn: week ${week} is not 1-18`);
  return `${ESPN_SCOREBOARD_URL}?dates=${season}&seasontype=${ESPN_REGULAR_SEASON}&week=${week}`;
}

/**
 * The only code that differs between the feed and this database, keyed the
 * way the feed spells it. Everything else is identical, which is checked
 * rather than assumed: tests/unit/espn-scoreboard.test.ts holds this map
 * against NFL_TEAMS, so a second divergence cannot be absorbed silently by
 * an importer that just passes the string through.
 */
export const ESPN_TO_OURS: Readonly<Record<string, string>> = { WSH: "WAS" };
const OURS_TO_ESPN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ESPN_TO_OURS).map(([espn, ours]) => [ours, espn]),
);

/** A feed code as this database spells it. Unknown codes pass through; the caller checks them. */
export function ourTeam(espnCode: string): string {
  const k = espnCode.trim().toUpperCase();
  return ESPN_TO_OURS[k] ?? k;
}

/** Our code as the feed spells it - the same map, read the other way. */
export function espnTeam(ourCode: string): string {
  const k = ourCode.trim().toUpperCase();
  return OURS_TO_ESPN[k] ?? k;
}

export type GameStatus = "scheduled" | "in_progress" | "final";

export interface EspnGame {
  /** ESPN's event id, carried for the report only; the match key is the pair. */
  espnId: string;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
  /** status.type.name verbatim, so an unfamiliar one can be printed. */
  espnStatus: string;
}

// NO KICKOFF TIME, deliberately. The feed's event.date is a PLACEHOLDER on a
// flex game - 24 of the 272, all in weeks 16-18, sit at 05:00Z with
// competitions[0].timeValid false - and our nfl_games rows carry the real
// times. Carrying a field that must never be written is how it eventually
// gets written; the schedule is seeded and this importer only ever adds a
// score to a row that already exists.

function asObject(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`espn: ${what} is not an object`);
  return v as Record<string, unknown>;
}

function asArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`espn: ${what} is not an array`);
  return v;
}

/**
 * A score as an integer, or null when the feed has none.
 *
 * The feed gives scores as STRINGS ("13"), and "0" on a game that has not
 * kicked off - which is a real zero, not a missing value, so it is only ever
 * read on a game the feed says is finished or under way.
 */
function score(v: unknown, what: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < 0 || n > 200) throw new Error(`espn: ${what} is not a score (${JSON.stringify(v)})`);
  return n;
}

/**
 * Which of our three statuses a feed status is.
 *
 * FINAL is decided by `completed`, and by nothing else. Not by the name: an
 * overtime game is STATUS_FINAL with detail "Final/OT", so a name allowlist
 * would need a list nobody can complete. And not by the state either - a
 * CANCELLED game is state "post" with completed FALSE and both scores the
 * string "0", which is the trap: read as final it writes a 0-0 result that
 * never happened, and a final is never rewritten, so it would stand for good.
 * `completed` is the only field that says the game was played to the end.
 */
export function statusOf(type: Record<string, unknown>): GameStatus {
  if (type.completed === true) return "final";
  if (String(type.state ?? "") === "in") return "in_progress";
  return "scheduled";
}

/**
 * One week of the feed as rows, in our vocabulary.
 *
 * `expectWeek` is checked against every event rather than trusted: the
 * week-based query is what asks for a week, and a payload answering with a
 * different one would write the right scores onto the wrong games.
 */
export function parseScoreboard(payload: unknown, expectWeek?: number): EspnGame[] {
  const root = asObject(payload, "payload");
  const events = asArray(root.events, "events");
  const out: EspnGame[] = [];
  const seen = new Set<string>();
  for (const raw of events) {
    const e = asObject(raw, "event");
    const espnId = String(e.id ?? "");
    const label = espnId ? `event ${espnId}` : "an event";
    const week = Number(asObject(e.week, `${label}.week`).number);
    if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error(`espn: ${label} has no usable week (${JSON.stringify(e.week)})`);
    if (expectWeek !== undefined && week !== expectWeek) {
      throw new Error(`espn: asked for week ${expectWeek} and ${label} says week ${week}. Nothing written.`);
    }
    const comps = asArray(e.competitions, `${label}.competitions`);
    if (comps.length !== 1) throw new Error(`espn: ${label} has ${comps.length} competitions, expected 1`);
    const c = asObject(comps[0], `${label}.competitions[0]`);
    const type = asObject(asObject(c.status, `${label}.status`).type, `${label}.status.type`);
    const status = statusOf(type);
    const espnStatus = String(type.name ?? "");

    const sides = asArray(c.competitors, `${label}.competitors`).map((x) => asObject(x, `${label}.competitor`));
    const home = sides.find((s) => s.homeAway === "home");
    const away = sides.find((s) => s.homeAway === "away");
    if (!home || !away) throw new Error(`espn: ${label} does not name both a home and an away side`);
    const teamOf = (s: Record<string, unknown>): string => {
      const abbr = String(asObject(s.team, `${label}.team`).abbreviation ?? "").trim();
      if (!abbr) throw new Error(`espn: ${label} has a side with no abbreviation`);
      return ourTeam(abbr);
    };
    const homeTeam = teamOf(home);
    const awayTeam = teamOf(away);
    if (homeTeam === awayTeam) throw new Error(`espn: ${label} has ${homeTeam} on both sides`);

    // Only read on a game that has been played or is being played; "0" on a
    // scheduled game is the feed's placeholder and is not a score.
    const played = status !== "scheduled";
    const homeScore = played ? score(home.score, `${label} home score`) : null;
    const awayScore = played ? score(away.score, `${label} away score`) : null;
    if (status === "final" && (homeScore === null || awayScore === null)) {
      throw new Error(`espn: ${label} (${awayTeam} at ${homeTeam}) is final with no score. Nothing written.`);
    }

    const key = `${week}:${homeTeam}:${awayTeam}`;
    if (seen.has(key)) throw new Error(`espn: week ${week} has ${awayTeam} at ${homeTeam} twice. Nothing written.`);
    seen.add(key);

    out.push({
      espnId,
      week,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      status,
      espnStatus,
    });
  }
  return out;
}

/** Only the rows worth writing: a scheduled game with no score says nothing. */
export function playedGames(games: EspnGame[]): EspnGame[] {
  return games.filter((g) => g.status !== "scheduled");
}
