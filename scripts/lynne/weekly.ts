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

import { adminClient, loadAuditByAction, loadCurrentPicks, loadLiveEntries, loadOwners, loadStandings, loadWeeks, recordAudit } from "../lib/db";
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
import { entriesOfConfirmedOwners } from "../lib/roster";
import { WEEKLY_CLAIM_ACTION, WEEKLY_DRAFTED_ACTION, priorWeeklyDraft } from "./lib/weekly-claim";

function parseArgs(argv: string[]): { week: number | null; force: boolean } {
  let week: number | null = null;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") {
      // Validated here, not at the loaders: `Number("foo")` is NaN and
      // `--week 19` is a week that does not exist, and either would have
      // produced a DellaPia_Week19_Picks draft with nothing in it.
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 18) throw new Error("--week must be an integer 1-18");
      week = n;
    } else if (x === "--force") force = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  return { week, force };
}

async function main() {
  const { week: asked, force } = parseArgs(process.argv.slice(2));
  const { client, actor } = await adminClient();
  const weeks = await loadWeeks(client);

  // The week whose late deadline has most recently passed - the one being
  // sent. Explicit --week wins, for a re-run.
  const now = Date.now();
  const locked = weeks
    .filter((w) => new Date(w.late_deadline_at).getTime() <= now)
    .sort((a, b) => b.week - a.week)[0];
  const week = asked ?? locked?.week ?? null;
  if (week === null) throw new Error("No week has locked yet; pass --week N to force one.");

  if (!weeks.some((w) => w.week === week)) throw new Error(`Week ${week} is not in the weeks table.`);

  // Claimed already? The tick's 60-minute lookback makes one 17:30 slot due
  // at four separate firings, so without this one Friday leaves four
  // identical drafts and a stale one is easy to send.
  const claims = [
    ...(await loadAuditByAction(client, WEEKLY_CLAIM_ACTION)),
    ...(await loadAuditByAction(client, WEEKLY_DRAFTED_ACTION)),
  ];
  const prior = priorWeeklyDraft(claims, week);
  if (prior && !force) {
    console.log(`Week ${week} was already drafted (audit ${prior.id}). Nothing created. Pass --force to draft it again.`);
    return;
  }

  const [entries, picks, standings, owners] = await Promise.all([
    loadLiveEntries(client),
    loadCurrentPicks(client, week),
    loadStandings(client),
    loadOwners(client),
  ]);

  const statusById = new Map(standings.map((s) => [s.entry_id, s.status as EntryStatus]));
  // CONFIRMED OWNERS ONLY. loadLiveEntries filters `voided_at` alone, while
  // the standings view already excludes pending and declined owners - so a
  // non-confirmed owner's un-voided entry would fall through with no
  // standings row, default to active, and land on Lynne's list as NO PICK
  // when every other roster in the app leaves it off (Codex on #91).
  const onRoster = entriesOfConfirmedOwners(owners, entries);
  // The runner's own entries sort to the top. That is OWNERSHIP, not whether
  // an entry is free: he could own a paid one, and is_free_entry would put it
  // among the recruits.
  const runnerIds = new Set(
    owners.filter((o) => (o.email ?? "").toLowerCase() === ADMIN_MAILBOX).map((o) => o.id),
  );
  const live = onRoster.map((e) => ({
    id: e.id,
    entryName: e.entry_name,
    status: statusById.get(e.id) ?? ("active" as EntryStatus),
    isAdminEntry: runnerIds.has(e.owner_id),
  }));
  const pickByEntry = new Map(picks.map((p) => [p.entry_id, p.team]));
  const numberById = new Map(onRoster.map((e) => [e.id, e.lynne_number]));

  const { ready, missingNumber } = buildSubmitRows(live, pickByEntry, numberById);

  // The one thing that can make the list shorter than the roster - so it
  // STOPS. Warning and drafting anyway produced exactly the shortened list
  // this whole command exists to prevent, and a draft sitting in Gmail is one
  // click from being sent (both reviewers on #91). /admin/lynne-submit blocks
  // the copy under the same condition; this now matches it.
  if (missingNumber.length > 0) {
    const line = needsAnthonyLine(
      "lynne:weekly",
      "missing Lynne number",
      `${missingNumber.length} entries have no number, so the list would be short: ${missingNumber.join(", ")}. NOTHING drafted.`,
    );
    console.log(line);
    await notify(line, { tags: "warning" });
    throw new Error(`${missingNumber.length} entries have no Lynne number; no draft created.`);
  }
  console.log(`Week ${week}: ${ready.length} rows for ${live.length} live entries.`);

  const table = buildSubmissionBlock(week, ready);
  const csv = buildSubmissionCsv(week, ready);
  const subject = weeklyPicksSubject(week);
  const filename = weeklyPicksFilename(week);
  const body = weeklyPicksBody({ week, table, rowCount: ready.length });

  console.log(`\nSubject: ${subject}\nTo: ${LYNNE_EMAIL}\nBcc: ${ADMIN_MAILBOX}\nAttached: ${filename}\n`);
  console.log(body);

  // Claim BEFORE the Gmail call: a run that dies between the two still stops
  // every later run from drafting this week again.
  await recordAudit(client, {
    actor,
    action: WEEKLY_CLAIM_ACTION,
    targetTable: "gmail",
    targetId: `lynne-weekly:${week}`,
    after: { week, row_count: ready.length, subject },
    note: `lynne:weekly claim for week ${week}; a drafted row follows on success`,
  });
  const { draftId } = await createDraft(gmailClient(), {
    to: [LYNNE_EMAIL],
    bcc: [ADMIN_MAILBOX],
    subject,
    body,
    html: htmlBodyOf(body),
    attachments: [{ filename, mimeType: "text/csv", content: csv }],
  });
  await recordAudit(client, {
    actor,
    action: WEEKLY_DRAFTED_ACTION,
    targetTable: "gmail",
    targetId: draftId,
    after: { week, draft_id: draftId, row_count: ready.length, subject },
    note: `lynne:weekly draft for week ${week}, ${ready.length} rows`,
  });
  console.log(`\ndraft ${draftId} created. Not sent: open Gmail, check it, and send it yourself.`);
  await notify(finishedLine("lynne:weekly", `week ${week}: draft ${draftId}, ${ready.length} rows, ${filename} attached`));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
