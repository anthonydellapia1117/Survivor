// npm run results -- --week N [--message-id <gmail id> | --file <xlsx>] [--backfill] [--dry-run] [--yes]
//
// Imports Lynne's weekly sheet the way /admin/import does, taken from her
// newest email carrying a "Football" .xlsx (or a file on disk). It parses,
// matches (exact, then case-insensitive, never fuzzy), prints every conflict
// and every variance with both sides, and writes nothing until Anthony types
// y. A variance is recorded with the import and never resolved: her sheet
// and our scores are two independent calculations and neither is assumed
// wrong. The same file is never imported twice: the sha256 is checked here
// and enforced again by lynne_imports in the database.
//
// Since 2026-09-15 the week's results are DERIVED from her fill marks (white
// clean, yellow her 1 loss/bye bucket, red or OUT out) and the stored prior
// record, and applied through the same audited RPC - Anthony: "She is the
// elimination authority and that field is where her authority lives." A
// stored result is never overwritten; a row the marks cannot settle is a
// conflict with both values, not a write.
//
//   --week N            required
//   --message-id <id>   use this Gmail message instead of searching
//   --file <path>       read the sheet from disk instead of Gmail; its sha256 is still what is checked and recorded
//   --backfill          the sheet is ALREADY imported for this week with no results: derive them now and apply each
//                       through admin_set_result (result_source lynne), one summary audit row on the import
//   --dry-run           print the plan and stop
//   --yes               skip the confirmation prompt

import fs from "node:fs";
import path from "node:path";
import {
  adminClient,
  applyLynneImport,
  importExists,
  loadCurrentPicks,
  loadDoubleElimThroughWeek,
  loadLiveEntries,
  loadPriorPicks,
  loadScoredGames,
  loadStandings,
  recordAudit,
  setResult,
} from "../lib/db";
import { compareStoredToScores, scoreComparisonLines } from "@/lib/score-variance";
import { compareMarksToScores, markComparisonLines, markVarianceLine, type MarkComparison } from "@/lib/lynne/mark-variance";
import { LYNNE_EMAIL } from "../lib/constants";
import { getAttachment, getMessageMeta, gmailClient, searchMessages, type MessageMeta } from "../lib/gmail";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { confirm } from "../lib/prompt";
import { backfillResults } from "./lib/backfill";
import {
  conflictLine,
  derivedConflictLines,
  derivedSummaryLine,
  herCountsLine,
  numberSuggestionLine,
  planSummaryLines,
  varianceTable,
} from "./lib/format";
import { buildResultsPlan, sha256Of } from "./lib/plan";
import {
  backfillImport,
  duplicateImport,
  footballAttachment,
  refuseUnverifiedLegacy,
  refuseWeekMismatch,
  selectFootballMessage,
  type FootballSelection,
} from "./lib/select";

interface Args {
  week: number;
  messageId: string | null;
  file: string | null;
  backfill: boolean;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  let week: number | null = null;
  let messageId: string | null = null;
  let file: string | null = null;
  let backfill = false;
  let dryRun = false;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") week = Number(argv[++i]);
    else if (x === "--message-id") messageId = argv[++i] ?? null;
    else if (x === "--file") file = argv[++i] ?? null;
    else if (x === "--backfill") backfill = true;
    else if (x === "--dry-run") dryRun = true;
    else if (x === "--yes") yes = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  if (week === null || !Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error("--week N is required (1 to 18)");
  }
  if (messageId !== null && !messageId) throw new Error("--message-id needs a Gmail message id");
  if (file !== null && !file) throw new Error("--file needs a path to her Football xlsx");
  if (file !== null && messageId !== null) throw new Error("--file and --message-id name two sources; pass one");
  return { week, messageId, file, backfill, dryRun, yes };
}

/** Where the sheet came from, for the log; the sha256 of the bytes is the identity either way. */
interface Sheet {
  buf: Buffer;
  filename: string;
  /** Named by hand (--message-id or --file) rather than picked by date. */
  explicit: boolean;
}

async function sheetFromGmail(args: Args): Promise<Sheet> {
  const gmail = gmailClient();
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
  const buf = await getAttachment(gmail, message.id, attachment.attachmentId);
  return { buf, filename: attachment.filename, explicit: args.messageId !== null };
}

function sheetFromDisk(file: string): Sheet {
  const buf = fs.readFileSync(file);
  const filename = path.basename(file);
  console.log(`File ${file}`);
  console.log(`  attachment: ${filename} (${buf.length} bytes)`);
  return { buf, filename, explicit: true };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { week } = args;
  const { client, actor } = await adminClient();

  // ---- find her sheet, and the file once
  const sheet = args.file !== null ? sheetFromDisk(args.file) : await sheetFromGmail(args);
  const { buf, filename } = sheet;
  const sha256 = sha256Of(buf);
  console.log(`  sha256:     ${sha256}`);
  // Her newest sheet is usually the one already on file for this week: she
  // sends one file a week and the schedule looks twice. That is the
  // once-per-sha256 rule holding, not a failure, so the run ends at exit 0 and
  // the tick reads it as ok (issue #40). A duplicate recorded against ANOTHER
  // week is not that: her sheet for this week has not arrived, and exiting 0
  // would leave this week's standings stale with the tick saying finished.
  // Nothing is applied twice either way - lynne_imports enforces the sha256.
  //
  // --backfill is the one run that wants the duplicate: the sheet went in
  // before the derivation existed (her Week 1 Final Sheet, 2026-09-15, 0
  // applies) and the RPC cannot take it again, so the derived results are
  // applied one by one through admin_set_result onto that import instead.
  // A sha256 not yet imported is refused: that is the ordinary path's job.
  const duplicate = duplicateImport(await importExists(client, sha256), week);
  let backfillImportId: string | null = null;
  if (args.backfill) {
    backfillImportId = backfillImport(duplicate, week, filename);
    console.log(`Backfill: this sheet is import ${backfillImportId} for week ${week}; its derived results are applied onto it below.`);
  } else if (duplicate.kind === "same_week") {
    console.log(duplicate.line);
    await notify(finishedLine("results", `week ${week}: ${duplicate.line}`));
    return;
  }
  if (duplicate.kind === "other_week") throw new Error(duplicate.line);

  // ---- parse and plan, the way /admin/import does
  // The prior record and the boundary feed the derivation as well as the
  // mark comparison, so they are loaded once, here, with everything else.
  const [entries, standings, localPicks, scoredGames, priorPicks, doubleElimThrough] = await Promise.all([
    loadLiveEntries(client),
    loadStandings(client),
    loadCurrentPicks(client, week),
    loadScoredGames(client, week),
    loadPriorPicks(client, week),
    loadDoubleElimThroughWeek(client),
  ]);
  const plan = buildResultsPlan({ buf, filename, week, entries, standings, localPicks, priorPicks, doubleElimThrough });
  if (backfillImportId !== null && plan.format !== "grid") {
    throw new Error(`--backfill is for her grid sheet; ${filename} is a legacy per-week file, whose results were applied when it was imported.`);
  }

  // ---- her results against the scores, set by Anthony on 2026-09-13
  // The plan cannot see this: a result_conflict needs a local result to
  // already exist, and nothing writes one from a score, so on import day every
  // result of hers is a clean apply. This reads what her file is about to
  // write - the applies laid over the current picks - against what nfl_games
  // derives, and prints every row where they differ with both values. It is
  // printed on a dry run and a real one alike, and it resolves nothing: her
  // word is what gets written either way. Since 2026-09-15 the applies are
  // the results derived from her marks, so this is her mark's result against
  // the score's, row by row.
  const appliedResult = new Map(plan.applies.map((a) => [a.entry_id, a.result]));
  const scoreCheck = compareStoredToScores(
    entries.map((e) => ({ id: e.id, entryName: e.entry_name, lynneNumber: e.lynne_number })),
    localPicks.map((p) => ({ entryId: p.entry_id, week, team: p.team, result: appliedResult.get(p.entry_id) ?? p.result })),
    scoredGames.map((g) => ({
      week: g.week,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      homeScore: g.home_score,
      awayScore: g.away_score,
      status: g.status,
    })),
  );

  // ---- her MARKS against the scores, set by Anthony on 2026-09-15
  // Computed BEFORE the plan is printed, so the variance count and table the
  // operator approves already carry the mark conflicts (Copilot, #101).
  // Her grid carries no per-week results, only a standing per row in the
  // NAMES fill (clean, yellow = 1 loss/bye, red = OUT). This reads that
  // standing for every matched row against what our current picks through
  // this week and the finals say, prints every difference with both values,
  // records each one with the import as a mark_conflict variance (the
  // derivation's own conflict is a derived_conflict, so one row is never one
  // type counted twice), and
  // resolves nothing. She is the elimination authority; a silent flip is what
  // this exists to prevent.
  let markCheck: MarkComparison | null = null;
  // A stripped export carries no styles at all (plan.noFillInfo); every row
  // would read as a confirmed clean fill and every loss of ours as a false
  // conflict, so the comparison is not run on such a sheet and the run says
  // so instead (Codex, #101).
  if (plan.format === "grid" && !plan.noFillInfo) {
    const priorGames = (await Promise.all(
      Array.from({ length: week - 1 }, (_, i) => loadScoredGames(client, i + 1)),
    )).flat();
    const toGame = (g: { week: number; home_team: string; away_team: string; home_score: number | null; away_score: number | null; status: "scheduled" | "in_progress" | "final" }) => ({
      week: g.week, homeTeam: g.home_team, awayTeam: g.away_team, homeScore: g.home_score, awayScore: g.away_score, status: g.status,
    });
    markCheck = compareMarksToScores(
      plan.marks,
      [
        ...priorPicks.map((p) => ({ entryId: p.entry_id, week: p.week, team: p.team })),
        ...localPicks.map((p) => ({ entryId: p.entry_id, week, team: p.team })),
      ],
      [...priorGames, ...scoredGames].map(toGame),
      week,
      doubleElimThrough,
    );
    for (const v of markCheck.differ) {
      plan.variances.push({
        type: "mark_conflict",
        entryId: v.entryId,
        entryName: v.entryName,
        lynne: { team: null, result: v.hers },
        local: { team: v.picks, result: v.ours },
      });
    }
  }

  // ---- show, before any write
  // An older sheet can carry a Week N column with nothing in it yet: her
  // headers run the whole season. Importing it as Week N would record every
  // entry as missing on her sheet. The app's preview shows latestFilledWeek
  // and leaves the click to Anthony; a command that can run with --yes
  // refuses instead and names the file to use.
  // A newer sheet is refused too: it is Week N+1's file, and importing it as
  // Week N would spend its sha256 on the wrong week.
  if (plan.format === "grid") {
    const mismatch = refuseWeekMismatch(plan.latestFilledWeek, week, filename);
    if (mismatch !== null) throw new Error(mismatch);
  }
  // A legacy file has no week to check, so it is never picked by date.
  const unverified = refuseUnverifiedLegacy(plan.format, sheet.explicit, week, filename);
  if (unverified !== null) throw new Error(unverified);
  console.log(`\nWeek ${week} import plan for ${filename}`);
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
  console.log("");
  for (const line of scoreComparisonLines(scoreCheck, week)) console.log(line);

  if (markCheck !== null) {
    console.log("");
    for (const line of markComparisonLines(markCheck, week)) console.log(line);
  } else if (plan.format === "grid") {
    console.log("");
    console.log(`Her marks were not compared: this sheet carries no fill information, so a clean fill cannot be told from a stripped one.`);
  }

  // ---- what her marks give as the week's results, before the confirm
  // This is what the y writes. Every count is on the line, every conflict is
  // its own line with both values, and a sheet with no fill information says
  // that nothing is derived from it.
  if (plan.format === "grid") {
    console.log("");
    console.log(derivedSummaryLine(week, plan.derived));
    // The header says where the conflicts are kept, and that depends on the
    // path: the import row on the ordinary run, the summary audit row (when
    // one is written) on a backfill.
    for (const line of derivedConflictLines(plan.derived, backfillImportId !== null ? "backfill" : "import")) console.log(line);
  }
  const derived = plan.format === "grid" ? plan.derived : null;

  if (args.dryRun) {
    console.log("\nDry run. Nothing written.");
    return;
  }
  if (!args.yes) {
    const question =
      backfillImportId !== null
        ? `\nBackfill week ${week} results onto import ${backfillImportId}: ${plan.applies.length} applies through admin_set_result, ${derived?.conflicts.length ?? 0} conflicts left alone? (y/N) `
        : `\nCommit week ${week} import: ${plan.matchedCount} matched, ${plan.variances.length} variances, ${plan.applies.length} applies? (y/N) `;
    const ok = await confirm(question);
    if (!ok) {
      console.log("Not approved. Nothing written.");
      return;
    }
  }

  // ---- write
  if (backfillImportId !== null) {
    // Onto the existing import: one admin_set_result per derived result, each
    // its own audited transaction, then one summary row on the import when
    // anything was written. A failure mid-run leaves every pick already
    // written with its audit row; a re-run finds those already on file and
    // applies the rest (scripts/results/lib/backfill.ts).
    if (derived === null) {
      console.log(`\nNothing to backfill: no result is derived from a sheet with no fill information.`);
      await notify(needsAnthonyLine("results", "backfill", `week ${week}: ${filename} carries no fill information, so no result was derived or written`), { tags: "warning" });
      return;
    }
    const outcome = await backfillResults(
      { setResult: (p) => setResult(client, p), recordAudit: (a) => recordAudit(client, a) },
      { week, filename, sha256, importId: backfillImportId, derived, actor },
    );
    console.log(
      `\nBackfill for week ${week} onto import ${backfillImportId}: ${outcome.written} results written` +
        (outcome.summaryAuditId !== null ? `, summary audit ${outcome.summaryAuditId}` : ", nothing written and no summary row") +
        `; ${derived.alreadyApplied} already on file, ${derived.conflicts.length} conflicts not applied.`,
    );
    await notify(
      finishedLine(
        "results",
        `week ${week} backfill: ${outcome.written} results written onto import ${backfillImportId}, ${derived.alreadyApplied} already on file, ${derived.conflicts.length} conflicts not applied`,
      ),
    );
  } else {
    // One RPC: the import row, its applies and its audit rows together.
    const id = await applyLynneImport(client, {
      week,
      filename,
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
  }
  // A row the derivation set aside is actionable the same way: a conflict is
  // a row where her mark and our record cannot both be right, and an unknown
  // or undecidable row is a result of hers that was NOT written.
  if (derived !== null && (derived.conflicts.length > 0 || derived.unknown > 0 || derived.undecidable > 0 || derived.priorUnscored > 0)) {
    const parts = [
      derived.conflicts.length > 0
        ? `${derived.conflicts.length} of ours where her week ${week} mark and our record disagree, not applied: ${derived.conflicts
            .map((v) => `${v.entryName} ${v.local.team ?? "-"} her ${v.lynne.result} / ours ${v.local.result}`)
            .join("; ")}`
        : null,
      derived.unknown > 0 ? `${derived.unknown} of ours not derived - a fill colour this reader does not know` : null,
      derived.undecidable > 0 ? `${derived.undecidable} of ours not derived - her mark cannot say win from loss on a row already out` : null,
      derived.priorUnscored > 0 ? `${derived.priorUnscored} of ours not derived - a prior week's result is still pending` : null,
    ].filter((x): x is string => x !== null);
    await notify(needsAnthonyLine("results", "derived results", parts.join(" | ")), { tags: "warning" });
  }
  // A row set aside is actionable too, not a footnote: on the unattended
  // Tuesday run every game is final, so "unscored" means the ingest missed a
  // final and "unknown" means a fill this reader cannot name. Either can hide
  // a real conflict behind a run that reports success (Codex, #101).
  if (markCheck === null && plan.format === "grid") {
    await notify(
      needsAnthonyLine("results", "mark variance", `week ${week}: her sheet carries no fill information, so her marks were not compared against the scores`),
      { tags: "warning" },
    );
  }
  if (markCheck !== null && (markCheck.differ.length > 0 || markCheck.unknown > 0 || markCheck.unscored > 0)) {
    const parts = [
      markCheck.differ.length > 0
        ? `${markCheck.differ.length} of ours where her week ${week} sheet's mark differs from the scores: ${markCheck.differ.map(markVarianceLine).join("; ")}`
        : null,
      markCheck.unscored > 0 ? `${markCheck.unscored} of ours not compared - a pick on a game with no final on file` : null,
      markCheck.unknown > 0 ? `${markCheck.unknown} of ours not compared - a fill colour this reader does not know` : null,
    ].filter((x): x is string => x !== null);
    await notify(needsAnthonyLine("results", "mark variance", parts.join(" | ")), { tags: "warning" });
  }
  if (scoreCheck.differ.length > 0) {
    await notify(
      needsAnthonyLine(
        "results",
        "score variance",
        `${scoreCheck.differ.length} of ours where her week ${week} result differs from the scores: ${scoreCheck.differ
          .map((v) => `NO. ${v.lynneNumber ?? "none"} ${v.entryName} ${v.team} her ${v.stored} / scores ${v.derived}`)
          .join("; ")}`,
      ),
      { tags: "warning" },
    );
  }
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
