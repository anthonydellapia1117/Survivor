// The Week 1 backfill: derived results applied onto a sheet that was
// imported BEFORE the derivation existed.
//
// Her Week 1 Final Sheet (Football 2026-9.xlsx) went in on 2026-09-15 with 0
// applies, under the reading that her grid carried no per-week result. That
// reading is superseded the same day, and admin_apply_lynne_import cannot
// run again on the same sha256 - the once-per-file rule is the dedupe. So a
// --backfill run derives the same plan the ordinary path now would and
// applies each result through admin_set_result with result_source 'lynne',
// which updates the pick and writes its set_result audit row in one
// transaction per pick, then records ONE summary row on the existing import.
//
// Each pick is its own transaction, so a failure mid-run leaves every pick
// already written with its audit row and the rest untouched; a re-run
// derives the same results, finds the written ones already on file (the
// derivation never overwrites a stored result) and applies the remainder.
// The summary row is written only when this run wrote at least one result,
// so a re-run that finds everything on file writes nothing at all. It carries
// every derivation conflict with both values (conflict_rows), because there
// is no import row for them to ride on: the ordinary path keeps them in
// lynne_imports.variances and this path has nowhere else (verifier,
// 2026-09-15). A run that writes nothing writes no row, so its conflicts are
// printed and nowhere else; the command's header says so.
//
// The writes are injected so the loop can be exercised with a fake database:
// what is asserted is the message that came out, not the shape of the source.

import type { Apply } from "@/lib/lynne/compare";
import type { MarkResultsPlan } from "@/lib/lynne/mark-results";
import { lossesByTeamText } from "./format";

export interface BackfillDeps {
  setResult: (p: { entryId: string; week: number; result: string; resultSource: string; actor: string }) => Promise<void>;
  recordAudit: (a: {
    actor: string;
    action: string;
    targetTable: string;
    targetId: string;
    after: Record<string, unknown>;
    note: string;
  }) => Promise<number>;
}

export interface BackfillInput {
  week: number;
  filename: string;
  sha256: string;
  importId: string;
  derived: MarkResultsPlan;
  actor: string;
}

export interface BackfillOutcome {
  /** Results written this run: one admin_set_result each. */
  written: number;
  /** The summary audit row's id, or null when nothing was written. */
  summaryAuditId: number | null;
}

/** The result source every derived result is written under, the same word admin_apply_lynne_import writes. */
export const LYNNE_RESULT_SOURCE = "lynne";

export const BACKFILL_AUDIT_ACTION = "lynne_results_backfill";

/** The summary row's note: the week, the file, the counts, and that the import row predates the derivation. */
export function backfillNote(input: BackfillInput, written: number): string {
  const d = input.derived;
  return (
    `week ${input.week}: ${written} results derived from her fill marks on ${input.filename} (sha256 ${input.sha256.slice(0, 8)}) ` +
    `applied through admin_set_result with result_source ${LYNNE_RESULT_SOURCE}: ` +
    `${d.byResult.win} win, ${d.byResult.loss} loss (${lossesByTeamText(d.lossesByTeam)}), ${d.byResult.bye} bye, ${d.byResult.missed} missed; ` +
    `${d.alreadyApplied} already on file, ${d.conflicts.length} conflicts not applied, ${d.unknown} unknown fill, ${d.undecidable} undecidable. ` +
    `The import row predates the derivation (imported with 0 applies before the 2026-09-15 rule) and is backfilled, not re-imported.`
  );
}

export async function backfillResults(deps: BackfillDeps, input: BackfillInput): Promise<BackfillOutcome> {
  const applies: Apply[] = input.derived.applies;
  let written = 0;
  for (const a of applies) {
    await deps.setResult({
      entryId: a.entry_id,
      week: input.week,
      result: a.result,
      resultSource: LYNNE_RESULT_SOURCE,
      actor: input.actor,
    });
    written += 1;
  }
  let summaryAuditId: number | null = null;
  if (written > 0) {
    summaryAuditId = await deps.recordAudit({
      actor: input.actor,
      action: BACKFILL_AUDIT_ACTION,
      targetTable: "lynne_imports",
      targetId: input.importId,
      after: {
        week: input.week,
        filename: input.filename,
        file_sha256: input.sha256,
        written,
        by_result: input.derived.byResult,
        losses_by_team: input.derived.lossesByTeam,
        already_applied: input.derived.alreadyApplied,
        conflicts: input.derived.conflicts.length,
        conflict_rows: input.derived.conflicts.map((v) => ({
          type: v.type,
          entry_id: v.entryId,
          entry_name: v.entryName,
          lynne: v.lynne,
          local: v.local,
        })),
        unknown: input.derived.unknown,
        undecidable: input.derived.undecidable,
        result_source: LYNNE_RESULT_SOURCE,
      },
      note: backfillNote(input, written),
    });
  }
  return { written, summaryAuditId };
}
