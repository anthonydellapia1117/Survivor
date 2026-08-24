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

/**
 * The free-entry rule, applied automatically: FLOOR(recruited / ratio)
 * free entries under the runner's participant row, named "AAA n". Runs
 * after every action that changes the entry population. Only ever
 * CREATES — a downward threshold crossing is surfaced on /admin, never
 * auto-deleted. Failures never break the triggering action; the /admin
 * entitlement check is the backstop.
 */
async function syncFreeEntries(actor: string): Promise<void> {
  try {
    const { freeEntitlement, nextFreeNames, FREE_ENTRY_OWNER_EMAIL } =
      await import("@/lib/free-entries");
    const admin = getAdminData();
    const [owners, entries, config] = await Promise.all([
      admin.listOwners(),
      admin.listEntries(),
      admin.getConfig(),
    ]);
    const me = owners.find(
      (o) =>
        o.email?.toLowerCase() === FREE_ENTRY_OWNER_EMAIL &&
        o.participationStatus === "confirmed",
    );
    if (!me) return;
    const live = entries.filter((e) => !e.voidedAt);
    const recruited = live.filter((e) => !e.isFreeEntry).length;
    const target = freeEntitlement(recruited, config.freeEntryRatio);
    const mine = live
      .filter((e) => e.ownerId === me.id && e.isFreeEntry)
      .map((e) => e.entryName);
    const names = nextFreeNames(mine, target);
    if (names.length === 0) return;
    await admin.addEntries({
      ownerId: me.id,
      entryNames: names,
      nameIsDefault: false,
      isFree: true,
      actor: `${actor} (free-entry rule)`,
    });
  } catch (err) {
    console.error("free-entry sync failed:", err);
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
    await syncFreeEntries(actor);
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
    await syncFreeEntries(actor);
    revalidateAll();
    return { ok: true };
  });
}

export async function updateEntryAction(input: {
  entryId: string;
  entryName: string;
  lynneLabel: string;
  isFree: boolean | null;
  lynneNumber: number | null;
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
    await syncFreeEntries(actor);
    revalidateAll();
    return { ok: true };
  });
}

export async function voidEntryAction(input: {
  entryId: string;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().voidEntry({ ...input, actor });
    await syncFreeEntries(actor);
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
  earlyDeadlineAt: string;
  lateDeadlineAt: string;
  confirmed: boolean;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().updateWeek({ ...input, actor });
    revalidateAll();
    return { ok: true };
  });
}

export async function mergeOwnerAction(input: {
  sourceId: string;
  targetId: string;
}): Promise<ActionResult & { summary?: { deleted: boolean; entries_moved: number; payments_moved: number } }> {
  return guarded(async (actor) => {
    const summary = await getAdminData().mergeOwner({ ...input, actor });
    await syncFreeEntries(actor);
    revalidateAll();
    return { ok: true, summary };
  });
}

export async function deleteOwnerAction(input: {
  ownerId: string;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().deleteOwner({ ...input, actor });
    await syncFreeEntries(actor);
    revalidateAll();
    return { ok: true };
  });
}

export interface GameScoreInput {
  gameId: string;
  homeScore: number | null;
  awayScore: number | null;
  status: "scheduled" | "in_progress" | "final";
}

export async function setGameScoresAction(input: {
  scores: GameScoreInput[];
}): Promise<ActionResult & { picksRecomputed?: number; failures?: string[] }> {
  return guarded(async (actor) => {
    const data = getAdminData();
    const failures: string[] = [];
    let picksRecomputed = 0;
    for (const g of input.scores) {
      try {
        picksRecomputed += await data.setGameScore({ ...g, actor });
      } catch (e) {
        failures.push(`${g.gameId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    revalidateAll();
    return { ok: failures.length === 0, picksRecomputed, failures };
  });
}

/**
 * Bulk Lynne-number assignment from the paste-import. Rows arrive
 * pre-confirmed by the admin; each write goes through the audited
 * admin_update_entry RPC, preserving the entry's other fields. Per-row
 * failures are reported, never silently skipped.
 */
export async function bulkSetLynneNumbersAction(input: {
  rows: { entryId: string; lynneNumber: number }[];
}): Promise<ActionResult & { applied?: number; failures?: string[] }> {
  return guarded(async (actor) => {
    const admin = getAdminData();
    const entries = new Map(
      (await admin.listEntries()).map((e) => [e.id, e]),
    );
    const failures: string[] = [];
    let applied = 0;
    for (const row of input.rows) {
      const e = entries.get(row.entryId);
      if (!e || e.voidedAt) {
        failures.push(`${row.entryId}: entry not found`);
        continue;
      }
      try {
        await admin.updateEntry({
          entryId: e.id,
          entryName: e.entryName,
          lynneLabel: e.lynneLabel ?? "",
          isFree: e.isFreeEntry,
          lynneNumber: row.lynneNumber,
          actor,
        });
        applied++;
      } catch (err) {
        failures.push(
          `${e.entryName}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    revalidateAll();
    return { ok: failures.length === 0, applied, failures };
  });
}

export async function setGameRevealAction(input: {
  gameId: string;
  override: boolean | null;
}): Promise<ActionResult> {
  return guarded(async (actor) => {
    await getAdminData().setGameReveal({
      gameId: input.gameId,
      override: input.override,
      actor,
    });
    revalidateAll();
    return { ok: true };
  });
}

/**
 * D5: fetch finals from ESPN's public scoreboard to PRE-FILL the form for
 * review. Never auto-commits — the admin echo-confirms before anything is
 * written.
 */
export async function fetchEspnScoresAction(input: {
  week: number;
}): Promise<
  ActionResult & {
    games?: {
      home: string;
      away: string;
      homeScore: number | null;
      awayScore: number | null;
      final: boolean;
    }[];
  }
> {
  return guarded(async () => {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=${input.week}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `ESPN returned HTTP ${res.status}` };
    }
    const j = (await res.json()) as {
      events?: {
        competitions: {
          status?: { type?: { completed?: boolean } };
          competitors: {
            homeAway: string;
            score?: string;
            team: { abbreviation: string };
          }[];
        }[];
      }[];
    };
    const MAP: Record<string, string> = { WSH: "WAS", JAC: "JAX", LA: "LAR" };
    const norm = (t: string) => MAP[t] ?? t;
    const games = (j.events ?? []).map((e) => {
      const comp = e.competitions[0];
      const home = comp.competitors.find((c) => c.homeAway === "home")!;
      const away = comp.competitors.find((c) => c.homeAway === "away")!;
      const final = comp.status?.type?.completed === true;
      const num = (v?: string) =>
        v !== undefined && v !== "" && final ? Number(v) : null;
      return {
        home: norm(home.team.abbreviation),
        away: norm(away.team.abbreviation),
        homeScore: num(home.score),
        awayScore: num(away.score),
        final,
      };
    });
    return { ok: true, games };
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
  /** "grid" = her NO./NAMES sheet; "legacy" = old tolerant column format. */
  format: "grid" | "legacy";
  rows: import("@/lib/lynne/parse").LynneRow[];
  matched: {
    entry: string;
    entryId: string;
    entryName: string;
    team: string | null;
    result: string | null;
    matchedBy: string;
    no?: number | null;
  }[];
  unmatched: import("@/lib/lynne/parse").LynneRow[];
  variances: import("@/lib/lynne/compare").Variance[];
  applies: import("@/lib/lynne/compare").Apply[];
  alreadyApplied: number;
  noResultYet: number;
  /** Grid-format extras; absent on legacy files. */
  grid?: {
    otherPoolCount: number;
    teamAgreements: number;
    statusAgreements: number;
    confirmedRemovals: number;
    quietRows: number;
    latestFilledWeek: number | null;
    weeksInFile: number[];
    conflicts: {
      no: number;
      name: string;
      reason: string;
      entryName: string | null;
    }[];
    numberSuggestions: { entryName: string; sheetNo: number }[];
    herCounts: import("@/lib/lynne/parse-grid").HerWeekCounts | null;
    noFillInfo: boolean;
  };
}

export async function lynneImportPreviewAction(
  formData: FormData,
): Promise<ActionResult & { preview?: LynnePreview }> {
  return guarded(async () => {
    const { parseLynneFile } = await import("@/lib/lynne/parse");
    const { parseLynneGrid } = await import("@/lib/lynne/parse-grid");
    const { getData } = await import("@/lib/data");

    const file = formData.get("file");
    const week = Number(formData.get("week"));
    if (!(file instanceof File)) return { ok: false, error: "No file" };
    if (!Number.isInteger(week) || week < 1 || week > 18) {
      return { ok: false, error: "Pick a week" };
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const admin = getAdminData();
    const entries = (await admin.listEntries()).filter((e) => !e.voidedAt);
    // Raw picks — the public view masks pre-kickoff picks, which would
    // turn every unstarted game into a false variance.
    const cells = (await admin.listGridCells()).filter(
      (c) => c.week === week,
    );
    const localPicks = cells.map((c) => ({
      entryId: c.entryId,
      team: c.team,
      result: c.result,
    }));

    // Her real format first: the NO./NAMES grid with fill-color status.
    const grid = parseLynneGrid(buf);
    if (grid) {
      const { matchGridRows, computeGridPlan, normalizeGridTeam } =
        await import("@/lib/lynne/plan-grid");
      if (!grid.weeks.includes(week)) {
        return {
          ok: false,
          error: `Her sheet has no Week ${week} column (it has ${grid.weeks
            .map((w) => `Week ${w}`)
            .join(", ")}).`,
        };
      }
      const alreadyImported = await admin.importExists(grid.sha256);

      const summaries = await admin.listEntrySummaries();
      const statusById = new Map(summaries.map((s) => [s.id, s.status]));
      const targets = entries.map((e) => ({
        id: e.id,
        entryName: e.entryName,
        lynneLabel: e.lynneLabel,
        lynneNumber: e.lynneNumber,
        status: statusById.get(e.id) ?? "active",
      }));

      const { matched, conflicts, missing, otherPoolCount } = matchGridRows(
        grid.rows,
        targets,
      );
      const plan = computeGridPlan(matched, missing, week, localPicks, targets);
      const names = new Map(entries.map((e) => [e.id, e.entryName]));

      const toRow = (r: import("@/lib/lynne/parse-grid").GridEntryRow) => {
        const raw = r.cells[week];
        return {
          entry: r.name,
          team: raw ? (normalizeGridTeam(raw) ?? raw) : null,
          result:
            r.fill === "red" || raw?.toUpperCase() === "OUT" ? "out" : null,
          rowIndex: r.rowIndex,
          no: r.no,
        };
      };

      return {
        ok: true,
        preview: {
          week,
          filename: file.name,
          sha256: grid.sha256,
          alreadyImported,
          format: "grid",
          // Store only OUR rows (matched + conflicts) — her sheet holds the
          // whole ~1,200-entry pool and the rest is not ours to keep.
          rows: [...matched.map((m) => toRow(m.row)), ...conflicts.map((c) => toRow(c.row))],
          matched: matched.map((m) => {
            const raw = m.row.cells[week];
            return {
              entry: m.row.name,
              entryId: m.entryId,
              entryName: names.get(m.entryId) ?? m.row.name,
              team: raw ? (normalizeGridTeam(raw) ?? raw) : null,
              result:
                m.row.fill === "red" || raw?.toUpperCase() === "OUT"
                  ? "out"
                  : null,
              matchedBy: m.matchedBy,
              no: m.row.no,
            };
          }),
          unmatched: conflicts.map((c) => toRow(c.row)),
          variances: plan.variances,
          applies: [], // Grid carries no per-week results; scores engine owns them.
          alreadyApplied: 0,
          noResultYet: 0,
          grid: {
            otherPoolCount,
            teamAgreements: plan.teamAgreements,
            statusAgreements: plan.statusAgreements,
            confirmedRemovals: plan.confirmedRemovals,
            quietRows: plan.quietRows,
            latestFilledWeek: grid.latestFilledWeek,
            weeksInFile: grid.weeks,
            conflicts: conflicts.map((c) => ({
              no: c.row.no,
              name: c.row.name,
              reason: c.reason,
              entryName: c.entryName,
            })),
            numberSuggestions: matched
              .filter((m) => m.numberOnSheetNotOnFile !== null)
              .map((m) => ({
                entryName: names.get(m.entryId) ?? m.row.name,
                sheetNo: m.numberOnSheetNotOnFile as number,
              })),
            herCounts: grid.herCounts[week] ?? null,
            noFillInfo: grid.rows.every((r) => r.fill === "none"),
          },
        },
      };
    }

    // Legacy tolerant path (older files, hand-made CSVs).
    const { matchRows } = await import("@/lib/lynne/match");
    const { computeImportPlan } = await import("@/lib/lynne/compare");
    const parsed = parseLynneFile(buf, file.name);
    const alreadyImported = await admin.importExists(parsed.sha256);

    const { matched, unmatched } = matchRows(
      parsed.rows,
      entries.map((e) => ({
        id: e.id,
        entryName: e.entryName,
        lynneLabel: e.lynneLabel,
      })),
    );

    const names = new Map(entries.map((e) => [e.id, e.entryName]));
    const plan = computeImportPlan(matched, localPicks, names);

    return {
      ok: true,
      preview: {
        week,
        filename: file.name,
        sha256: parsed.sha256,
        alreadyImported,
        format: "legacy",
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
      // Grid files hold her whole pool; we store only our rows but record
      // the true sheet size.
      rowCount: preview.grid
        ? preview.rows.length + preview.grid.otherPoolCount
        : preview.rows.length,
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
