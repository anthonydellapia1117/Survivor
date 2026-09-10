import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ESPN_TO_OURS,
  espnTeam,
  espnWeekUrl,
  ourTeam,
  parseScoreboard,
  playedGames,
  statusOf,
} from "../../src/lib/nfl/espn";
import { NFL_TEAMS } from "../../src/lib/standing";

// The fixture is a REAL week-1 payload, trimmed to three events and otherwise
// untouched: the one final (NE at SEA), a scheduled game, and the WSH game -
// the single code that differs from ours. Hand-written JSON would prove the
// parser reads hand-written JSON.
const FIXTURE: unknown = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures/espn-week1.json"), "utf8"),
);

describe("the ESPN team codes", () => {
  it("differ from ours in exactly one place, WSH for WAS, and map both ways", () => {
    expect(ESPN_TO_OURS).toEqual({ WSH: "WAS" });
    expect(ourTeam("WSH")).toBe("WAS");
    expect(espnTeam("WAS")).toBe("WSH");
    // Round trip, both directions, so a one-way map cannot pass.
    expect(espnTeam(ourTeam("WSH"))).toBe("WSH");
    expect(ourTeam(espnTeam("WAS"))).toBe("WAS");
  });

  it("leaves the other 31 alone, checked against the roster of teams rather than a list here", () => {
    const ours = NFL_TEAMS.map((t) => t.abbr);
    expect(ours).toHaveLength(32);
    for (const abbr of ours) {
      if (abbr === "WAS") continue;
      expect({ abbr, viaEspn: ourTeam(espnTeam(abbr)) }).toEqual({ abbr, viaEspn: abbr });
      expect({ abbr, unchanged: espnTeam(abbr) }).toEqual({ abbr, unchanged: abbr });
    }
    // Every code the map renames must be one we actually have.
    for (const target of Object.values(ESPN_TO_OURS)) expect(ours).toContain(target);
  });

  it("is case and whitespace tolerant, because a feed string is not ours to trust", () => {
    expect(ourTeam(" wsh ")).toBe("WAS");
    expect(espnTeam("was")).toBe("WSH");
  });
});

describe("the scoreboard URL", () => {
  it("asks for one week of the regular season", () => {
    expect(espnWeekUrl(2026, 1)).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=1",
    );
    expect(espnWeekUrl(2026, 18)).toContain("week=18");
  });
  it("refuses a week that is not 1-18", () => {
    for (const w of [0, 19, 1.5, NaN]) expect(() => espnWeekUrl(2026, w)).toThrow(/week/);
  });
});

describe("reading a week", () => {
  const games = parseScoreboard(FIXTURE, 1);

  it("returns our vocabulary, not theirs", () => {
    const wsh = games.find((g) => g.awayTeam === "WAS" || g.homeTeam === "WAS");
    expect(wsh, "the WSH game did not come through as WAS").toBeDefined();
    expect(games.some((g) => g.homeTeam === "WSH" || g.awayTeam === "WSH")).toBe(false);
  });

  it("reads the final with both scores, as integers", () => {
    const g = games.find((x) => x.homeTeam === "SEA");
    expect(g).toMatchObject({ week: 1, homeTeam: "SEA", awayTeam: "NE", status: "final", homeScore: 13, awayScore: 10 });
    // The feed gives scores as STRINGS; a string here would compare wrong
    // against an integer column and sort wrong in any report.
    expect(typeof g!.homeScore).toBe("number");
    expect(typeof g!.awayScore).toBe("number");
  });

  it("leaves a scheduled game with NO score, because the feed's zero is a placeholder", () => {
    const g = games.find((x) => x.status === "scheduled");
    expect(g, "the fixture has no scheduled game").toBeDefined();
    expect(g!.homeScore).toBeNull();
    expect(g!.awayScore).toBeNull();
  });

  it("offers only the games worth writing", () => {
    expect(playedGames(games).map((g) => g.homeTeam)).toEqual(["SEA"]);
  });

  it("decides nothing about who won - that is derived, and a tie is a loss elsewhere", () => {
    // The feed carries a `winner` boolean on each side. Reading it here would
    // put a second, disagreeable opinion about the result next to the scores.
    // The parser records the two numbers; picks.result and the standings view
    // decide what they cost, and a tie is a tie_loss there.
    const src = readFileSync(path.join(__dirname, "../../src/lib/nfl/espn.ts"), "utf8");
    expect(src).not.toMatch(/\.winner\b/);
    expect(Object.keys(games[0])).not.toContain("winner");
  });
});

describe("what stops a run", () => {
  const bad = (mutate: (d: Record<string, unknown>) => void): unknown => {
    const d = JSON.parse(JSON.stringify(FIXTURE)) as Record<string, unknown>;
    mutate(d);
    return d;
  };
  type Ev = { week: { number: number }; competitions: { status: { type: Record<string, unknown> }; competitors: { score: string; team: { abbreviation: string } }[] }[] };
  const events = (d: Record<string, unknown>): Ev[] => d.events as unknown as Ev[];

  it("a payload answering with another week", () => {
    expect(() => parseScoreboard(bad((d) => { events(d)[0].week.number = 2; }), 1))
      .toThrow(/asked for week 1 and .* says week 2\. Nothing written\./);
  });

  it("a final with no score", () => {
    expect(() => parseScoreboard(bad((d) => {
      for (const e of events(d)) if (e.competitions[0].status.type.completed === true) e.competitions[0].competitors[0].score = "";
    }), 1)).toThrow(/is final with no score\. Nothing written\./);
  });

  it("the same pairing twice in one week", () => {
    expect(() => parseScoreboard(bad((d) => {
      const e = events(d)[0];
      events(d).push(JSON.parse(JSON.stringify(e)) as Ev);
    }), 1)).toThrow(/twice\. Nothing written\./);
  });

  it("a score that is not a score", () => {
    expect(() => parseScoreboard(bad((d) => {
      for (const e of events(d)) if (e.competitions[0].status.type.completed === true) e.competitions[0].competitors[0].score = "seven";
    }), 1)).toThrow(/is not a score/);
  });

  it("reads a CANCELLED game as unplayed and takes no score from it", () => {
    // The observed shape: state post, completed false, both scores "0", and no
    // `winner` key on either side. Comparing the score strings would call this
    // a 0-0 tie; only `completed` tells the truth.
    const d = JSON.parse(JSON.stringify(FIXTURE)) as { events: Ev[] };
    const e = d.events[0];
    e.competitions[0].status.type = { name: "STATUS_CANCELED", state: "post", completed: false };
    e.competitions[0].competitors[0].score = "0";
    e.competitions[0].competitors[1].score = "0";
    const g = parseScoreboard(d, 1)[0];
    expect(g.status).toBe("scheduled");
    expect(g.homeScore).toBeNull();
    expect(g.awayScore).toBeNull();
    expect(playedGames(parseScoreboard(d, 1)).map((x) => x.espnStatus)).not.toContain("STATUS_CANCELED");
  });

  it("carries no kickoff time, because the feed's is a placeholder on a flex game", () => {
    // 24 of the 272 games - all weeks 16-18 - sit at 05:00Z with timeValid
    // false. Our rows carry the real times; a field that must never be written
    // is one that eventually is.
    const g = parseScoreboard(FIXTURE, 1)[0] as unknown as Record<string, unknown>;
    expect(Object.keys(g)).not.toContain("kickoffAt");
    expect(readFileSync(path.join(__dirname, "../../src/lib/nfl/espn.ts"), "utf8")).not.toMatch(/kickoffAt/);
  });

  it("a shape that is not the scoreboard at all", () => {
    expect(() => parseScoreboard({ nope: true })).toThrow(/events is not an array/);
    expect(() => parseScoreboard(null)).toThrow(/payload is not an object/);
  });
});

describe("which status a feed status is", () => {
  it("is final only when the feed says the game COMPLETED", () => {
    expect(statusOf({ name: "STATUS_FINAL", state: "post", completed: true })).toBe("final");
    // An overtime game is STATUS_FINAL too, with detail "Final/OT" - there is
    // no STATUS_FINAL_OVERTIME in this feed, which is why the name is not what
    // decides. Keying on the name would need a list nobody can complete.
    expect(statusOf({ name: "STATUS_FINAL", state: "post", completed: true, detail: "Final/OT", period: 5 })).toBe("final");
  });

  it("never calls a postponed or cancelled game final, whatever its state says", () => {
    // A CANCELLED game is the trap, and it is real in this feed: state "post",
    // completed FALSE, and both scores the string "0". Read as final it writes
    // a 0-0 that never happened - and a final is never rewritten, so it would
    // stand for the rest of the season.
    // These sit outside "pre" too. Calling one final would write a result that
    // did not happen AND make it unoverwritable, because a final is never
    // rewritten. `completed` is the only field that says it was played out.
    for (const name of ["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED"]) {
      expect({ name, is: statusOf({ name, state: "post", completed: false }) }).toEqual({ name, is: "scheduled" });
    }
  });

  it("reads a game under way as in_progress", () => {
    for (const name of ["STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_PERIOD"]) {
      expect({ name, is: statusOf({ name, state: "in", completed: false }) }).toEqual({ name, is: "in_progress" });
    }
  });

  it("falls back to scheduled on a status nobody has seen", () => {
    expect(statusOf({ name: "STATUS_SOMETHING_NEW", state: "pre", completed: false })).toBe("scheduled");
    expect(statusOf({})).toBe("scheduled");
  });
});

describe("the command runs behind a proxy", () => {
  it("sets NODE_USE_ENV_PROXY on the npm script, because Node's fetch ignores HTTPS_PROXY", () => {
    // Without it a proxied container gets 403 from a direct connection while
    // curl to the same URL returns 200 - a failure that reads as ESPN
    // blocking us. The switch is Node's own and is a no-op with no proxy set.
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "../../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.scores).toContain("NODE_USE_ENV_PROXY=1");
    expect(pkg.scripts.scores).toContain("scripts/scores/cli.ts");
  });

  it("names the switch in the error, so the 403 is not misread", () => {
    const src = readFileSync(path.join(__dirname, "../../scripts/scores/cli.ts"), "utf8");
    expect(src).toContain("NODE_USE_ENV_PROXY");
    expect(src).toMatch(/HTTPS_PROXY/);
  });
});
