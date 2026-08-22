"use server";

// Every admin mutation flows through here: verify the admin session, then
// call the transactional RPC (data + audit in one transaction). No mutation
// happens outside these actions.

import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/lib/auth";
import { getAdminData } from "@/lib/data/admin";

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

async function guarded<T extends ActionResult>(
  fn: (actor: string) => Promise<T>,
): Promise<T | ActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "Not authorized" };
  try {
    return await fn(session.actor);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function revalidateAll() {
  for (const p of ["/", "/grid", "/teams", "/entries", "/admin"]) {
    revalidatePath(p, "layout");
  }
}

export async function createOwnerAction(input: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  notes: string;
  entryNames: string[];
  nameIsDefault: boolean;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    const id = await getAdminData().createOwner({ ...input, actor });
    revalidateAll();
    return { ok: true, id };
  });
}

export async function updateOwnerAction(input: {
  ownerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  participationStatus: string;
  notes: string;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().updateOwner({ ...input, actor });
    revalidateAll();
    return { ok: true };
  });
}

export async function addEntriesAction(input: {
  ownerId: string;
  entryNames: string[];
  nameIsDefault: boolean;
  isFree: boolean;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().addEntries({ ...input, actor });
    revalidateAll();
    return { ok: true };
  });
}

export async function updateEntryAction(input: {
  entryId: string;
  entryName: string;
  lynneLabel: string;
  isFree: boolean | null;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().updateEntry({ ...input, actor });
    revalidateAll();
    return { ok: true };
  });
}

export async function removeEntryAction(input: {
  entryId: string;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().removeEntry({ ...input, actor });
    revalidateAll();
    return { ok: true };
  });
}

export async function voidEntryAction(input: {
  entryId: string;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().voidEntry({ ...input, actor });
    revalidateAll();
    return { ok: true };
  });
}

export async function recordPaymentAction(input: {
  ownerId: string | null;
  amountCents: number;
  method: string;
  paidOn: string;
  venmoTxnId: string;
  note: string;
  corrects: string | null;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    const id = await getAdminData().recordPayment({ ...input, actor });
    revalidateAll();
    return { ok: true, id };
  });
}

export async function submitPickAction(input: {
  entryId: string;
  week: number;
  team: string;
  source?: string;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    const id = await getAdminData().submitPick({
      entryId: input.entryId,
      week: input.week,
      team: input.team,
      source: input.source ?? "admin",
      actor,
    });
    revalidateAll();
    return { ok: true, id };
  });
}

export async function submitPicksBatchAction(input: {
  week: number;
  picks: { entryId: string; team: string }[];
  source?: string;
}): Promise<ActionResult & { applied?: number; failures?: string[] }> {
  return guarded(async (actor) => {
    const data = getAdminData();
    const failures: string[] = [];
    let applied = 0;
    for (const p of input.picks) {
      try {
        await data.submitPick({
          entryId: p.entryId,
          week: input.week,
          team: p.team,
          source: input.source ?? "admin",
          actor,
        });
        applied += 1;
      } catch (e) {
        failures.push(
          `${p.entryId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    revalidateAll();
    return { ok: failures.length === 0, applied, failures };
  });
}

export async function updateWeekAction(input: {
  week: number;
  windowLabel: string;
  deadlineAt: string;
  confirmed: boolean;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().updateWeek({ ...input, actor });
    revalidateAll();
    return { ok: true };
  });
}

export async function deadlineSweepAction(input: {
  week: number;
  commit: boolean;
}): Promise<
  ActionResult & { rows?: { entryId: string; entryName: string; ownerName: string }[] }
> {
  return guarded(async (actor) => {
    const rows = await getAdminData().deadlineSweep({ ...input, actor });
    if (input.commit) revalidateAll();
    return { ok: true, rows };
  });
}

export interface LynnePreview {
  week: number;
  filename: string;
  sha256: string;
  alreadyImported: boolean;
  rows: import("@/lib/lynne/parse").LynneRow[];
  matched: {
    entry: string;
    entryId: string;
    entryName: string;
    team: string | null;
    result: string | null;
    matchedBy: string;
  }[];
  unmatched: import("@/lib/lynne/parse").LynneRow[];
  variances: import("@/lib/lynne/compare").Variance[];
  applies: import("@/lib/lynne/compare").Apply[];
  alreadyApplied: number;
  noResultYet: number;
}

export async function lynneImportPreviewAction(
  formData: FormData,
): Promise<ActionResult & { preview?: LynnePreview }> {
  return guarded(async () => {
    const { parseLynneFile } = await import("@/lib/lynne/parse");
    const { matchRows } = await import("@/lib/lynne/match");
    const { computeImportPlan } = await import("@/lib/lynne/compare");
    const { getData } = await import("@/lib/data");

    const file = formData.get("file");
    const week = Number(formData.get("week"));
    if (!(file instanceof File)) return { ok: false, error: "No file" };
    if (!Number.isInteger(week) || week < 1 || week > 18) {
      return { ok: false, error: "Pick a week" };
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseLynneFile(buf, file.name);
    const admin = getAdminData();
    const alreadyImported = await admin.importExists(parsed.sha256);

    const entries = (await admin.listEntries()).filter((e) => !e.voidedAt);
    const { matched, unmatched } = matchRows(
      parsed.rows,
      entries.map((e) => ({
        id: e.id,
        entryName: e.entryName,
        lynneLabel: e.lynneLabel,
      })),
    );

    const cells = (await getData().getGridCells()).filter(
      (c) => c.week === week,
    );
    const names = new Map(entries.map((e) => [e.id, e.entryName]));
    const plan = computeImportPlan(
      matched,
      cells.map((c) => ({
        entryId: c.entryId,
        team: c.team,
        result: c.result,
      })),
      names,
    );

    return {
      ok: true,
      preview: {
        week,
        filename: file.name,
        sha256: parsed.sha256,
        alreadyImported,
        rows: parsed.rows,
        matched: matched.map((m) => ({
          entry: m.row.entry,
          entryId: m.entryId,
          entryName: names.get(m.entryId) ?? m.row.entry,
          team: m.row.team,
          result: m.row.result,
          matchedBy: m.matchedBy,
        })),
        unmatched,
        variances: plan.variances,
        applies: plan.applies,
        alreadyApplied: plan.alreadyApplied,
        noResultYet: plan.noResultYet,
      },
    };
  });
}

export async function lynneImportCommitAction(
  preview: LynnePreview,
): Promise<ActionResult> {
  return guarded(async (actor) => {
    const id = await getAdminData().applyLynneImport({
      week: preview.week,
      filename: preview.filename,
      sha256: preview.sha256,
      rows: preview.rows,
      rowCount: preview.rows.length,
      matchedCount: preview.matched.length,
      unmatched: preview.unmatched,
      variances: preview.variances,
      applies: preview.applies,
      actor,
    });
    revalidateAll();
    revalidatePath("/lynne");
    return { ok: true, id };
  });
}

export async function setResultAction(input: {
  entryId: string;
  week: number;
  result: string;
  resultSource?: string;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().setResult({
      entryId: input.entryId,
      week: input.week,
      result: input.result,
      resultSource: input.resultSource ?? "manual",
      actor,
    });
    revalidateAll();
    return { ok: true };
  });
}
