// npm run results -- --week N [--message-id <gmail id>] [--dry-run] [--yes]
//
// Imports Lynne's weekly sheet the way /admin/import does, taken from her
// newest email carrying a "Football" .xlsx. It parses, matches (exact, then
// case-insensitive, never fuzzy), prints every conflict and every variance
// with both sides, and writes nothing until Anthony types y. A variance is
// recorded with the import and never resolved: her sheet and our scores are
// two independent calculations and neither is assumed wrong. The same file
// is never imported twice: the sha256 is checked here and enforced again by
// lynne_imports in the database.
//
//   --week N            required
//   --message-id <id>   use this Gmail message instead of searching
//   --dry-run           print the plan and stop
//   --yes               skip the confirmation prompt

import {
  adminClient,
  applyLynneImport,
  importExists,
  loadCurrentPicks,
  loadLiveEntries,
  loadStandings,
} from "../lib/db";
import { LYNNE_EMAIL } from "../lib/constants";
import { getAttachment, getMessageMeta, gmailClient, searchMessages, type MessageMeta } from "../lib/gmail";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { confirm } from "../lib/prompt";
import {
  conflictLine,
  herCountsLine,
  numberSuggestionLine,
  planSummaryLines,
  varianceTable,
} from "./lib/format";
import { buildResultsPlan, sha256Of } from "./lib/plan";
import { duplicateImportLine, footballAttachment, refuseUnverifiedLegacy, refuseWeekMismatch, selectFootballMessage, type FootballSelection } from "./lib/select";

interface Args {
  week: number;
  messageId: string | null;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  let week: number | null = null;
  let messageId: string | null = null;
  let dryRun = false;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") week = Number(argv[++i]);
    else if (x === "--message-id") messageId = argv[++i] ?? null;
    else if (x === "--dry-run") dryRun = true;
    else if (x === "--yes") yes = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  if (week === null || !Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error("--week N is required (1 to 18)");
  }
  if (messageId !== null && !messageId) throw new Error("--message-id needs a Gmail message id");
  return { week, messageId, dryRun, yes };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { week } = args;
  const { client, actor } = await adminClient();
  const gmail = gmailClient();

  // ---- find her sheet
  let selection: FootballSelection | null;
  if (args.messageId) {
    const meta = await getMessageMeta(gmail, args.messageId);
    const attachment = footballAttachment(meta);
    if (!attachment) {
      const names = meta.attachments.map((a) => a.filename).join(", ") || "none";
      throw new Error(`Message ${args.messageId} carries no Football .xlsx attachment (attachments: ${names}).`);
    }
    selection = { message: meta, attachment };
  } else {
    const q = `from:${LYNNE_EMAIL} has:attachment filename:xlsx`;
    const refs = await searchMessages(gmail, q, 50);
    const metas: MessageMeta[] = [];
    for (const r of refs) metas.push(await getMessageMeta(gmail, r.id));
    selection = selectFootballMessage(metas);
    if (!selection) {
      throw new Error(
        `No message from ${LYNNE_EMAIL} carries a Football .xlsx attachment (${refs.length} message(s) with an .xlsx checked).`,
      );
    }
  }
  const { message, attachment } = selection;
  console.log(`Message ${message.id} from ${message.from}`);
  console.log(`  date:       ${message.date}`);
  console.log(`  subject:    ${message.subject || "(no subject)"}`);
  console.log(`  attachment: ${attachment.filename} (${attachment.size} bytes)`);

  // ---- the file, once
  const buf = await getAttachment(gmail, message.id, attachment.attachmentId);
  const sha256 = sha256Of(buf);
  console.log(`  sha256:     ${sha256}`);
  // Her newest sheet is usually one already on file: she sends one file a
  // week and the schedule looks twice. That is the once-per-sha256 rule
  // holding, not a failure, so the run ends here at exit 0 and the tick reads
  // it as ok (issue #40). Nothing is applied twice either way - lynne_imports
  // enforces the sha256 in the database.
  const duplicate = duplicateImportLine(await importExists(client, sha256));
  if (duplicate !== null) {
    console.log(duplicate);
    await notify(finishedLine("results", `week ${week}: ${duplicate}`));
    return;
  }

  // ---- parse and plan, the way /admin/import does
  const [entries, standings, localPicks] = await Promise.all([
    loadLiveEntries(client),
    loadStandings(client),
    loadCurrentPicks(client, week),
  ]);
  const plan = buildResultsPlan({ buf, filename: attachment.filename, week, entries, standings, localPicks });

  // ---- show, before any write
  // An older sheet can carry a Week N column with nothing in it yet: her
  // headers run the whole season. Importing it as Week N would record every
  // entry as missing on her sheet. The app's preview shows latestFilledWeek
  // and leaves the click to Anthony; a command that can run with --yes
  // refuses instead and names the file to use.
  // A newer sheet is refused too: it is Week N+1's file, and importing it as
  // Week N would spend its sha256 on the wrong week.
  if (plan.format === "grid") {
    const mismatch = refuseWeekMismatch(plan.latestFilledWeek, week, attachment.filename);
    if (mismatch !== null) throw new Error(mismatch);
  }
  // A legacy file has no week to check, so it is never picked by date.
  const unverified = refuseUnverifiedLegacy(plan.format, args.messageId !== null, week, attachment.filename);
  if (unverified !== null) throw new Error(unverified);
  console.log(`\nWeek ${week} import plan for ${attachment.filename}`);
  for (const line of planSummaryLines(plan)) console.log(line);
  const conflictCount = plan.format === "grid" ? plan.conflicts.length : 0;
  if (plan.format === "grid") {
    console.log(herCountsLine(week, plan.herCounts));
    if (plan.conflicts.length) {
      console.log(`\nConflicts (${plan.conflicts.length}), stored as unmatched for review, never guessed:`);
      for (const c of plan.conflicts) console.log(conflictLine(c));
    }
    if (plan.numberSuggestions.length) {
      console.log(`\nNumbers on her sheet that are not on file (${plan.numberSuggestions.length}):`);
      for (const s of plan.numberSuggestions) console.log(numberSuggestionLine(s));
    }
  } else if (plan.unmatched.length) {
    console.log(`\nUnmatched rows (${plan.unmatched.length}), stored for review, never guessed:`);
    for (const u of plan.unmatched) console.log(`- row ${u.rowIndex} "${u.entry}": ${u.team ?? "-"} / ${u.result ?? "-"}`);
  }
  console.log("");
  for (const line of varianceTable(plan.variances)) console.log(line);

  if (args.dryRun) {
    console.log("\nDry run. Nothing written.");
    return;
  }
  if (!args.yes) {
    const ok = await confirm(
      `\nCommit week ${week} import: ${plan.matchedCount} matched, ${plan.variances.length} variances, ${plan.applies.length} applies? (y/N) `,
    );
    if (!ok) {
      console.log("Not approved. Nothing written.");
      return;
    }
  }

  // ---- write: one RPC, the import row, its applies and its audit rows together
  const id = await applyLynneImport(client, {
    week,
    filename: attachment.filename,
    sha256,
    rows: plan.rows,
    rowCount: plan.rowCount,
    matchedCount: plan.matchedCount,
    unmatched: plan.unmatched,
    variances: plan.variances,
    applies: plan.applies,
    actor,
  });
  console.log(
    `\nImport ${id} written for week ${week}: ${plan.matchedCount} matched, ${plan.variances.length} variances, ${plan.applies.length} applied.`,
  );
  await notify(
    finishedLine(
      "results",
      `week ${week}: ${plan.matchedCount} matched, ${plan.variances.length} variances, ${plan.applies.length} applied, import ${id}`,
    ),
  );
  if (plan.variances.length || conflictCount) {
    await notify(
      needsAnthonyLine(
        "results",
        "variances",
        `${plan.variances.length} variances and ${conflictCount} conflicts on the week ${week} import: review on /admin/import`,
      ),
      { tags: "warning" },
    );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
