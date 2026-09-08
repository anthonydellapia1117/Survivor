// Supabase REST backend: anon key + RLS. Every query goes through the
// public-read views, so nothing here can see contact or payment data.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  GameRow,
  DataBackend,
  EntryDetail,
  EntrySummary,
  GridCell,
  MasterListData,
  MasterListRow,
  PotSummary,
  WeekRow,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function client(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function mapEntry(r: any): EntrySummary {
  return {
    id: r.id,
    entryName: r.entry_name,
    nameIsDefault: r.name_is_default,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    wins: Number(r.wins ?? 0),
    losses: Number(r.losses ?? 0),
    livesRemaining: Number(r.lives_remaining ?? 2),
    status: r.status,
    byeUsed: Boolean(r.bye_used),
    teamsUsed: r.teams_used ?? [],
    lastScoredWeek: r.last_scored_week ?? null,
    isAdminEntry: Boolean(r.is_admin_entry),
  };
}

function mapCell(r: any): GridCell {
  return {
    entryId: r.entry_id,
    week: r.week,
    team: r.team,
    result: r.result,
    late: Boolean(r.late),
    submittedAt: r.submitted_at,
    source: r.source,
    resultSource: r.result_source,
  };
}

export const supabaseBackend: DataBackend = {
  async getWeeks(): Promise<WeekRow[]> {
    const { data, error } = await client()
      .from("weeks")
      .select("*")
      .order("week");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      week: r.week,
      windowLabel: r.window_label,
      deadlineAt: r.deadline_at,
      earlyDeadlineAt: r.early_deadline_at,
      lateDeadlineAt: r.late_deadline_at,
      resultsFinal: r.results_final,
      confirmed: r.confirmed,
    }));
  },

  async getSchedule(): Promise<GameRow[]> {
    const { data, error } = await client()
      .from("nfl_games")
      .select("*")
      .order("week")
      .order("kickoff_at")
      .order("id");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      week: r.week,
      kickoffAt: r.kickoff_at,
      dayOfWeek: r.day_of_week,
      awayTeam: r.away_team,
      homeTeam: r.home_team,
      homeScore: r.home_score,
      awayScore: r.away_score,
      status: r.status,
      revealOverride: r.reveal_override ?? null,
      network: r.network ?? null,
    }));
  },

  async getArchive2025() {
    const c = client();
    const [{ data: entries, error: e1 }, { data: weekly, error: e2 }] =
      await Promise.all([
        c.from("archive_2025_entries").select("*").order("lynne_number"),
        c.from("archive_2025_weekly").select("*").order("week"),
      ]);
    if (e1 || e2) throw e1 ?? e2;
    return {
      entries: (entries ?? []).map((r: any) => ({
        lynneNumber: r.lynne_number,
        entryName: r.entry_name,
        outcome: r.outcome,
        picks: r.picks,
      })),
      weekly: (weekly ?? []).map((r: any) => ({
        week: r.week,
        noLosses: r.no_losses,
        lossBye: r.loss_bye,
        out: r.out,
      })),
    };
  },

  async getEntries(): Promise<EntrySummary[]> {
    const { data, error } = await client()
      .from("v_entry_public")
      .select("*")
      .order("entry_name");
    if (error) throw error;
    return (data ?? []).map(mapEntry);
  },

  async getEntry(id: string): Promise<EntryDetail | null> {
    const c = client();
    const { data, error } = await c
      .from("v_entry_public")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { data: picks, error: perr } = await c
      .from("v_grid_cells")
      .select("*")
      .eq("entry_id", id)
      .order("week");
    if (perr) throw perr;
    return { entry: mapEntry(data), picks: (picks ?? []).map(mapCell) };
  },

  async getGridCells(): Promise<GridCell[]> {
    // One current pick per entry per week: 121 entries pass PostgREST's
    // 1,000-row cap by mid-season, so the view is read a page at a time,
    // driven by the exact count and advancing by rows received.
    const c = client();
    const out: GridCell[] = [];
    const page = 1000;
    for (let from = 0; ; ) {
      const { data, error, count } = await c
        .from("v_grid_cells")
        .select("*", { count: "exact" })
        .order("week")
        .order("entry_id")
        .range(from, from + page - 1);
      if (error) throw error;
      for (const r of data ?? []) out.push(mapCell(r));
      if (!data || data.length === 0) break;
      from += data.length;
      if (count !== null && count !== undefined && out.length >= count) break;
      if (data.length < page && (count === null || count === undefined)) break;
    }
    return out;
  },

  async getPot(): Promise<PotSummary> {
    const { data, error } = await client().from("v_pot").select("*").single();
    if (error) throw error;
    return {
      entryCount: Number(data.entry_count),
      poolEntryCount:
        data.pool_entry_count === null ? null : Number(data.pool_entry_count),
      poolFreeCount:
        data.pool_free_count === null || data.pool_free_count === undefined
          ? null
          : Number(data.pool_free_count),
      poolPaidCount:
        data.pool_paid_count === null || data.pool_paid_count === undefined
          ? null
          : Number(data.pool_paid_count),
      poolPotCents:
        data.pool_pot_cents === null ? null : Number(data.pool_pot_cents),
    };
  },

  async getMasterList(): Promise<MasterListData> {
    // PostgREST returns at most 1,000 rows per response and her sheet is
    // longer than that, so the view is read a page at a time in NO. order.
    // The loop is driven by the exact count, not by a short page, so a
    // lower response cap than the page size still reads the whole sheet;
    // an empty page ends it either way. Every row carries the sheet's load
    // time, so a sheet loaded between two pages shows as a changed
    // sheet_loaded_at and the read starts over rather than mixing rosters.
    const c = client();
    const page = 1000;
    for (let attempt = 0; attempt < 3; attempt++) {
      const rows: MasterListRow[] = [];
      let loadedAt: string | null = null;
      let changed = false;
      for (let from = 0; ; ) {
        const { data, error, count } = await c
          .from("v_master_list")
          .select("*", { count: "exact" })
          .order("row_no")
          .range(from, from + page - 1);
        // Code can deploy ahead of its migration (a preview build, or a merge
        // before the attended apply): a view that is not there yet reads as
        // no sheet loaded, so every page falls back to our group instead of
        // failing. Any other error is still an error.
        if (error && (error.code === "42P01" || error.code === "PGRST205")) {
          return { loadedAt: null, rows: [] };
        }
        if (error) throw error;
        for (const r of data ?? []) {
          const at = (r.sheet_loaded_at as string | null) ?? null;
          if (loadedAt === null) loadedAt = at;
          else if (at !== loadedAt) {
            changed = true;
            break;
          }
          rows.push({
            no: Number(r.row_no),
            names: r.names,
            cells: (r.cells ?? {}) as Record<string, string>,
            entryId: r.entry_id ?? null,
          });
        }
        if (changed || !data || data.length === 0) break;
        from += data.length; // by rows received, so a cap below the page size skips nothing
        if (count !== null && count !== undefined && rows.length >= count) break;
        if (data.length < page && (count === null || count === undefined)) break;
      }
      if (!changed) return { loadedAt, rows };
    }
    throw new Error("The master list changed while it was being read; try again.");
  },

  async getLynneImports() {
    const { data, error } = await client()
      .from("lynne_imports")
      .select("*")
      .order("imported_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      week: r.week,
      filename: r.filename,
      fileSha256: r.file_sha256,
      importedAt: r.imported_at,
      rowCount: r.row_count,
      matchedCount: r.matched_count,
      unmatched: r.unmatched,
      variances: r.variances,
      rows: r.rows,
    }));
  },
};
