// npm run lynne:roster -- --file "Football 2026-3.xlsx" [--message-id <gmail id>] [--dry-run] [--yes]
//
// Loads Lynne's master sheet into lynne_roster as a read-only reference: one
// row per NO., the NAMES cell verbatim, the filled week cells as she wrote
// them, keyed by the sheet's sha256. It prints the sha256 and the row counts
// first, names the duplicate names her sheet carries (kept as-is, never
// merged), and, when a prior sheet is loaded, prints the diff against it
// (added, removed and renamed NO.s) before anything is written. A sheet
// already loaded is reported and left alone. It never creates an owner or
// an entry and never changes a lynne_number: the only write is the RPC
// admin_load_lynne_roster, audited in the same transaction.

import fs from "node:fs";
import path from "node:path";
import { adminClient } from "../lib/db";
import { finishedLine, notify } from "../lib/notify";
import { fetchAllPages } from "../lib/paged";
import { confirm } from "../lib/prompt";
import { diffRoster, duplicateNames, parseRosterSheet, rowsPayload } from "./lib/roster-sheet";

interface Args {
  file: string;
  messageId: string | null;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  let file: string | null = null;
  let messageId: string | null = null;
  let dryRun = false;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--file") file = argv[++i] ?? null;
    else if (x === "--message-id") messageId = argv[++i] ?? null;
    else if (x === "--dry-run") dryRun = true;
    else if (x === "--yes") yes = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  if (!file) throw new Error("--file <her Football xlsx> is required");
  if (messageId !== null && !messageId) throw new Error("--message-id needs a Gmail message id");
  return { file, messageId, dryRun, yes };
}

interface LoadedSheet {
  sheet_sha256: string;
  source_file: string;
  loaded_at: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const buf = fs.readFileSync(args.file);
  const sheet = parseRosterSheet(buf);
  const filename = path.basename(args.file);

  console.log(`File:       ${filename}`);
  console.log(`sha256:     ${sheet.sha256}`);
  console.log(`Rows:       ${sheet.rowCount} below the header; ${sheet.rows.length} with an integer NO. and a NAMES text; ${sheet.skipped.length} skipped`);
  for (const s of sheet.skipped) console.log(`  skipped sheet row ${s.row}: ${s.reason}`);
  const nos = sheet.rows.map((r) => r.no);
  console.log(`NO. range:  ${Math.min(...nos)} to ${Math.max(...nos)}; week columns: ${sheet.weekHeaders.join(", ") || "none"}`);
  const dupes = duplicateNames(sheet.rows);
  if (dupes.length) {
    console.log(`Duplicate names on her sheet (${dupes.length}), stored as-is, never merged:`);
    for (const d of dupes) console.log(`  ${JSON.stringify(d.key)} at NO. ${d.nos.join(", ")}`);
  } else {
    console.log("Duplicate names on her sheet: none.");
  }

  const { client, actor } = await adminClient();

  // ---- already loaded? One targeted row: the sha256 is the identity.
  const { data: alreadyRows, error: alreadyErr } = await client
    .from("lynne_roster")
    .select("sheet_sha256, source_file, loaded_at")
    .eq("sheet_sha256", sheet.sha256)
    .limit(1)
    .returns<LoadedSheet[]>();
  if (alreadyErr) throw new Error(`lynne_roster: ${alreadyErr.message}`);
  const already = alreadyRows?.[0] ?? null;
  if (already) {
    console.log(`\nAlready loaded ${already.loaded_at} as ${already.source_file}; a sheet is loaded once. Nothing written.`);
    await notify(finishedLine("lynne:roster", `${filename} already loaded, nothing written`));
    return;
  }

  // ---- the diff against the prior sheet, before anything is written. The
  // newest row belongs to the newest sheet, so one row names it. Its rows are
  // then read a page at a time: PostgREST caps a response at 1,000 rows and
  // her sheet is longer than that, so a single capped read would print the
  // tail as "added". The count check refuses a diff built from a short read.
  const { data: newestRows, error: newestErr } = await client
    .from("lynne_roster")
    .select("sheet_sha256, source_file, loaded_at")
    .order("loaded_at", { ascending: false })
    .limit(1)
    .returns<LoadedSheet[]>();
  if (newestErr) throw new Error(`lynne_roster (prior): ${newestErr.message}`);
  const prior = newestRows?.[0] ?? null;
  if (prior) {
    const priorRows = await fetchAllPages<{ row_no: number; names: string }>(async (from, to) => {
      const { data, error } = await client
        .from("lynne_roster")
        .select("row_no, names")
        .eq("sheet_sha256", prior.sheet_sha256)
        .order("row_no", { ascending: true })
        .range(from, to)
        .returns<{ row_no: number; names: string }[]>();
      if (error) throw new Error(`lynne_roster (prior rows): ${error.message}`);
      return data ?? [];
    });
    const { count, error: countErr } = await client
      .from("lynne_roster")
      .select("row_no", { count: "exact", head: true })
      .eq("sheet_sha256", prior.sheet_sha256);
    if (countErr) throw new Error(`lynne_roster (prior count): ${countErr.message}`);
    if (count !== null && count !== priorRows.length) {
      throw new Error(`lynne_roster (prior): read ${priorRows.length} of ${count} rows of ${prior.source_file}; the diff would be wrong. Nothing written.`);
    }
    const d = diffRoster(
      priorRows.map((r) => ({ no: r.row_no, names: r.names })),
      sheet.rows.map((r) => ({ no: r.no, names: r.names })),
    );
    console.log(`\nAgainst the prior sheet ${prior.source_file} (${prior.sheet_sha256.slice(0, 12)}, loaded ${prior.loaded_at}):`);
    console.log(`  ${d.added.length} added, ${d.removed.length} removed, ${d.renamed.length} renamed, ${d.unchanged} unchanged`);
    for (const a of d.added) console.log(`  + ${a.no}  ${JSON.stringify(a.names)}`);
    for (const r of d.removed) console.log(`  - ${r.no}  ${JSON.stringify(r.names)}`);
    for (const r of d.renamed) console.log(`  ~ ${r.no}  ${JSON.stringify(r.before)} -> ${JSON.stringify(r.after)}`);
  } else {
    console.log("\nNo prior sheet is loaded; this is the first.");
  }

  if (args.dryRun) {
    console.log("\nDry run. Nothing written.");
    await notify(finishedLine("lynne:roster", `${filename} dry run, nothing written`));
    return;
  }
  if (!args.yes && !(await confirm(`\nLoad ${sheet.rows.length} rows of ${filename} into lynne_roster? (y/N) `))) {
    console.log("Not approved. Nothing written.");
    await notify(finishedLine("lynne:roster", `${filename} not approved, nothing written`));
    return;
  }

  // ---- the one write: every row and its audit row in one transaction
  const { data, error } = await client.rpc("admin_load_lynne_roster", {
    p_sheet_sha256: sheet.sha256,
    p_source_file: filename,
    p_gmail_message_id: args.messageId,
    p_rows: rowsPayload(sheet.rows),
    p_actor: actor,
  });
  if (error) throw new Error(`admin_load_lynne_roster: ${error.message}`);
  const result = data as { rows: number; duplicate_names: number };
  console.log(`\nLoaded ${result.rows} rows (${result.duplicate_names} duplicate names kept as-is). Owners and entries untouched.`);
  await notify(finishedLine("lynne:roster", `${filename}: ${result.rows} rows loaded, ${result.duplicate_names} duplicate names kept`));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
