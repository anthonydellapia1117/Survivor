// npm run scores -- [--week N | --all] [--season 2026] [--dry-run] [--yes]
//
// Finals from the free ESPN scoreboard onto nfl_games. No key, no auth, and
// the only thing this command can write is nfl_games, through one audited RPC.
//
//   READ-ONLY against ESPN. WRITE-ONLY to nfl_games. It names picks, entries
//   and lynne_roster nowhere, and admin_apply_game_results names them nowhere
//   either - a result never touches a pick, and what a result MEANS for an
//   entry is the standings' job, not this one.
//
// Default weeks: the current play week and the one before it. The one before
// matters on the Tuesday slot - a Monday night game finishes after the week
// has rolled, and asking only for the new week would leave it scheduled
// forever.
//
//   npm run scores                    the current week and the one before
//   npm run scores -- --week 1        one week
//   npm run scores -- --all           all 18, for a backfill
//   --dry-run prints the table and writes nothing. --yes skips the y/N prompt.

import { adminClient, currentWeek, loadWeeks } from "../lib/db";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { confirm } from "../lib/prompt";
import { espnWeekUrl, parseScoreboard, playedGames, type EspnGame } from "@/lib/nfl/espn";

const SEASON = 2026;

interface Args {
  week: number | null;
  all: boolean;
  season: number;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { week: null, all: false, season: SEASON, dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") {
      a.week = Number(argv[++i]);
      if (!Number.isInteger(a.week) || a.week < 1 || a.week > 18) throw new Error("--week must be 1-18");
    } else if (x === "--season") {
      a.season = Number(argv[++i]);
      if (!Number.isInteger(a.season)) throw new Error("--season must be a year");
    } else if (x === "--all") a.all = true;
    else if (x === "--dry-run") a.dryRun = true;
    else if (x === "--yes") a.yes = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  if (a.all && a.week !== null) throw new Error("--all and --week are alternatives");
  return a;
}

/** One week of the feed. Throws with the URL on anything but a clean 200. */
async function fetchWeek(season: number, week: number): Promise<EspnGame[]> {
  const url = espnWeekUrl(season, week);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN ${res.status} ${res.statusText} for ${url}`);
  const payload: unknown = await res.json();
  // The week is checked against every event rather than trusted: a payload
  // answering with another week would write the right scores onto the wrong
  // games, and that is unrecoverable once a game is final.
  return parseScoreboard(payload, week);
}

function line(g: EspnGame): string {
  const score = g.status === "scheduled" ? "" : ` ${g.awayScore ?? "-"}-${g.homeScore ?? "-"}`;
  return `  wk${String(g.week).padStart(2)} ${g.awayTeam.padStart(3)} at ${g.homeTeam.padEnd(3)}  ${g.status}${score}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { client, actor } = await adminClient();
  const weeks = await loadWeeks(client);

  let targets: number[];
  if (args.all) targets = Array.from({ length: 18 }, (_, i) => i + 1);
  else if (args.week !== null) targets = [args.week];
  else {
    const now = new Date();
    const cur = currentWeek(weeks, now) ?? 18;
    targets = [...new Set([Math.max(1, cur - 1), cur])].sort((a, b) => a - b);
  }
  console.log(`ESPN ${args.season}, week${targets.length > 1 ? "s" : ""} ${targets.join(", ")}`);

  const games: EspnGame[] = [];
  for (const w of targets) games.push(...(await fetchWeek(args.season, w)));
  const played = playedGames(games);
  console.log(`${games.length} games read, ${played.length} played or under way.`);
  for (const g of played) console.log(line(g));

  if (played.length === 0) {
    console.log("Nothing to write.");
    await notify(finishedLine("scores", `week${targets.length > 1 ? "s" : ""} ${targets.join(",")}: nothing played yet`));
    return;
  }
  if (args.dryRun) {
    console.log("Dry run. Nothing written.");
    return;
  }
  if (!args.yes && !(await confirm(`\nApply ${played.length} result(s) to nfl_games? (y/N) `))) {
    console.log("Not approved. Nothing written.");
    await notify(finishedLine("scores", "not approved, nothing written"));
    return;
  }

  const rows = played.map((g) => ({
    week: g.week,
    home_team: g.homeTeam,
    away_team: g.awayTeam,
    home_score: g.homeScore,
    away_score: g.awayScore,
    status: g.status,
  }));
  const { data, error } = await client.rpc("admin_apply_game_results", { p_rows: rows, p_actor: actor });
  if (error) {
    // An unmatched game is the one failure worth a push: the schedule moved,
    // and nothing was written, so the next slot will fail the same way until
    // a person looks.
    await notify(needsAnthonyLine("scores", "ESPN did not match the schedule", error.message), { tags: "warning" });
    throw new Error(`admin_apply_game_results: ${error.message}`);
  }
  const out = (data ?? {}) as { written?: number; unchanged?: number; kept_final?: number };
  const summary = `${out.written ?? 0} written, ${out.unchanged ?? 0} unchanged, ${out.kept_final ?? 0} already final`;
  console.log(summary);
  await notify(finishedLine("scores", summary));
}

main().catch(async (e: unknown) => {
  const why = e instanceof Error ? e.message : String(e);
  console.error(why);
  process.exitCode = 1;
});
