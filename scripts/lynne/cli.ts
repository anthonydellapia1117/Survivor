// npm run lynne -- --week 1 --deadline fri
//
// Prints the entries whose teams locked at that deadline in Lynne's
// numbering, one line each, and creates the same text as a Gmail draft in the
// "Survivor - DellaPia | 2026 Entry List" thread. It never sends: Anthony
// opens the draft and sends it himself. An entry with no Lynne number is
// refused and named, never padded into the list.
//
//   --deadline tue|wed|thu|fri   the noon ET lock day (tue = Wednesday game,
//                                wed = Thursday games, thu = Friday games,
//                                fri = Saturday, Sunday and Monday games)
//   --no-draft                   print only

import { adminClient, loadCurrentPicks, loadGames, loadLiveEntries } from "../lib/db";
import { createDraftReply, findThreadBySubject, gmailClient } from "../lib/gmail";
import { gameDayFor, type GameLite } from "../picks/lib/deadline";
import { draftBody, isLockDay, LOCK_LABEL, selectForLock, type OutboundPick } from "./lib/outbound";
import { ENTRY_LIST_SUBJECT as THREAD_SUBJECT, LYNNE_EMAIL as LYNNE } from "../lib/constants";

function parseArgs(argv: string[]): { week: number; lock: "tue" | "wed" | "thu" | "fri"; draft: boolean } {
  let week: number | null = null;
  let lock: string | null = null;
  let draft = true;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") week = Number(argv[++i]);
    else if (x === "--deadline") lock = argv[++i];
    else if (x === "--no-draft") draft = false;
    else throw new Error(`Unknown argument ${x}`);
  }
  if (week === null || !Number.isInteger(week)) throw new Error("--week N is required");
  if (!lock || !isLockDay(lock)) throw new Error("--deadline must be tue, wed, thu or fri");
  return { week, lock, draft };
}

async function main(): Promise<void> {
  const { week, lock, draft } = parseArgs(process.argv.slice(2));
  const { client } = await adminClient();
  const [entries, gameRows, current] = await Promise.all([
    loadLiveEntries(client),
    loadGames(client, week),
    loadCurrentPicks(client, week),
  ]);
  const games: GameLite[] = gameRows.map((g) => ({ week: g.week, dayOfWeek: g.day_of_week, homeTeam: g.home_team, awayTeam: g.away_team }));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const picks: OutboundPick[] = [];
  for (const p of current) {
    const e = byId.get(p.entry_id);
    if (!e) continue;
    picks.push({
      entryName: e.entry_name,
      lynneNumber: e.lynne_number,
      lynneLabel: e.lynne_label,
      team: p.team,
      gameDay: gameDayFor(p.team, games, week),
    });
  }
  const result = selectForLock(picks, lock);
  console.log(`Week ${week} - ${LOCK_LABEL[lock]}: ${result.included.length} entries\n`);
  for (const line of result.lines) console.log(line);
  if (result.excluded.length) {
    console.log(`\nExcluded (${result.excluded.length}), not sent to Lynne:`);
    for (const x of result.excluded) console.log(`- ${x.pick.entryName} -> ${x.pick.team}: ${x.why}`);
  } else {
    console.log("\nExcluded: none.");
  }
  if (!draft) return;
  if (!result.lines.length) {
    console.log("\nNo lines for this lock; no draft created.");
    return;
  }
  const gmail = gmailClient();
  const tail = await findThreadBySubject(gmail, THREAD_SUBJECT);
  if (!tail) throw new Error(`Thread "${THREAD_SUBJECT}" not found in Gmail.`);
  const id = await createDraftReply(gmail, {
    tail,
    to: LYNNE,
    subject: `Re: ${THREAD_SUBJECT}`,
    body: draftBody(week, lock, result.lines),
  });
  console.log(`\nDraft ${id} created in thread ${tail.threadId}. Not sent: open Gmail, check it, and send it yourself.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
