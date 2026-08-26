// Supabase REST backend: anon key + RLS. Every query goes through the
// public-read views, so nothing here can see contact or payment data.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  GameRow,
  DataBackend,
  EntryDetail,
  EntrySummary,
  GridCell,
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
    const { data, error } = await client()
      .from("v_grid_cells")
      .select("*")
      .order("week");
    if (error) throw error;
    return (data ?? []).map(mapCell);
  },

  async getPot(): Promise<PotSummary> {
    const { data, error } = await client().from("v_pot").select("*").single();
    if (error) throw error;
    return {
      entryCount: Number(data.entry_count),
      poolEntryCount:
        data.pool_entry_count === null ? null : Number(data.pool_entry_count),
      poolPotCents:
        data.pool_pot_cents === null ? null : Number(data.pool_pot_cents),
    };
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
