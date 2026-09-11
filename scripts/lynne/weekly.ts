// npm run lynne:weekly -- --week N
//
// The Friday picks email to Lynne, as a Gmail DRAFT. Never a send: Anthony
// opens it, reads it and sends it himself. That is permanent and no flag
// reaches it (CLAUDE.md).
//
//   Subject  DellaPia_Week<N>_Picks       To   Lynne
//   File     DellaPia_Week<N>_Picks.csv   Bcc  Anthony, so it lands in his
//                                              inbox and gets his label
//
// The table goes in the BODY and the same rows go in the ATTACHED CSV. Both,
// every week - Week 1 went that way and she replied "Got it."
//
// EVERY LIVE ENTRY IS A ROW: the team, BYE, NO PICK, or OUT. The row count is
// printed against the live entry count precisely because the old builder used
// to drop rows silently (src/lib/lynne/submit.ts).

import { adminClient, loadCurrentPicks, loadLiveEntries, loadStandings, loadWeeks } from "../lib/db";
import { createDraft, gmailClient } from "../lib/gmail";
import { LYNNE_EMAIL, ADMIN_MAILBOX } from "../lib/constants";
import { buildSubmissionBlock, buildSubmissionCsv, buildSubmitRows } from "@/lib/lynne/submit";
import {
  weeklyPicksBody,
  weeklyPicksFilename,
  weeklyPicksSubject,
} from "@/lib/lynne/weekly-email";
import { htmlBodyOf } from "../lib/site-link";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import type { EntryStatus } from "@/lib/data/types";

function parseArgs(argv: string[]): { week: number | null } {
  let week: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") week = Number(argv[++i]);
    else throw new Error(`Unknown argument ${x}`);
  }
  return { week };
}

async function main() {
  const { week: asked } = parseArgs(process.argv.slice(2));
  const { client } = await adminClient();
  const weeks = await loadWeeks(client);

  // The week whose late deadline has most recently passed - the one being
  // sent. Explicit --week wins, for a re-run.
  const now = Date.now();
  const locked = weeks
    .filter((w) => new Date(w.late_deadline_at).getTime() <= now)
    .sort((a, b) => b.week - a.week)[0];
  const week = asked ?? locked?.week ?? null;
  if (week === null) throw new Error("No week has locked yet; pass --week N to force one.");

  const [entries, picks, standings] = await Promise.all([
    loadLiveEntries(client),
    loadCurrentPicks(client, week),
    loadStandings(client),
  ]);

  const statusById = new Map(standings.map((s) => [s.entry_id, s.status as EntryStatus]));
  const live = entries.map((e) => ({
    id: e.id,
    entryName: e.entry_name,
    // An entry with no standings row has not been scored out of anything.
    status: statusById.get(e.id) ?? ("active" as EntryStatus),
    isAdminEntry: e.is_free_entry,
  }));
  const pickByEntry = new Map(picks.map((p) => [p.entry_id, p.team]));
  const numberById = new Map(entries.map((e) => [e.id, e.lynne_number]));

  const { ready, missingNumber } = buildSubmitRows(live, pickByEntry, numberById);

  // The one thing that can make the list shorter than the roster. Say it
  // loudly rather than sending her a short list.
  if (missingNumber.length > 0) {
    const line = needsAnthonyLine(
      "lynne:weekly",
      "missing Lynne number",
      `${missingNumber.length} entries have no number and are NOT on the list: ${missingNumber.join(", ")}`,
    );
    console.log(line);
    await notify(line, { tags: "warning" });
  }
  console.log(`Week ${week}: ${ready.length} rows for ${live.length} live entries.`);

  const table = buildSubmissionBlock(week, ready);
  const csv = buildSubmissionCsv(week, ready);
  const subject = weeklyPicksSubject(week);
  const filename = weeklyPicksFilename(week);
  const body = weeklyPicksBody({ week, table, rowCount: ready.length });

  console.log(`\nSubject: ${subject}\nTo: ${LYNNE_EMAIL}\nBcc: ${ADMIN_MAILBOX}\nAttached: ${filename}\n`);
  console.log(body);

  const { draftId } = await createDraft(gmailClient(), {
    to: [LYNNE_EMAIL],
    bcc: [ADMIN_MAILBOX],
    subject,
    body,
    html: htmlBodyOf(body),
    attachments: [{ filename, mimeType: "text/csv", content: csv }],
  });
  console.log(`\ndraft ${draftId} created. Not sent: open Gmail, check it, and send it yourself.`);
  await notify(finishedLine("lynne:weekly", `week ${week}: draft ${draftId}, ${ready.length} rows, ${filename} attached`));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
