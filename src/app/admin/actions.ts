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
