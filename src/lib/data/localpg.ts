// Local-Postgres backend for development and visual testing against the
// seeded test database (scripts/db/test-db.sh). Selected only when
// LOCAL_PG_URL is set; production always uses the Supabase backend.

import { Pool } from "pg";
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

let pool: Pool | null = null;

function db(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.LOCAL_PG_URL });
  }
  return pool;
}

function mapEntry(r: any): EntrySummary {
  return {
    id: r.id,
    entryName: r.entry_name,
    nameIsDefault: r.name_is_default,
    isFreeEntry: r.is_free_entry,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    wins: Number(r.wins ?? 0),
    losses: Number(r.losses ?? 0),
    livesRemaining: Number(r.lives_remaining ?? 2),
    status: r.status,
    byeUsed: Boolean(r.bye_used),
    teamsUsed: r.teams_used ?? [],
    lastScoredWeek: r.last_scored_week ?? null,
  };
}

function mapCell(r: any): GridCell {
  return {
    entryId: r.entry_id,
    week: r.week,
    team: r.team,
    result: r.result,
    late: Boolean(r.late),
    submittedAt:
      r.submitted_at instanceof Date
        ? r.submitted_at.toISOString()
        : r.submitted_at,
    source: r.source,
    resultSource: r.result_source,
  };
}

function iso(v: any): string {
  return v instanceof Date ? v.toISOString() : v;
}

export const localPgBackend: DataBackend = {
  async getWeeks(): Promise<WeekRow[]> {
    const { rows } = await db().query("select * from weeks order by week");
    return rows.map((r: any) => ({
      week: r.week,
      windowLabel: r.window_label,
      deadlineAt: iso(r.deadline_at),
      earlyDeadlineAt: iso(r.early_deadline_at),
      lateDeadlineAt: iso(r.late_deadline_at),
      resultsFinal: r.results_final,
      confirmed: r.confirmed,
    }));
  },

  async getSchedule(): Promise<GameRow[]> {
    const { rows } = await db().query(
      "select * from nfl_games order by week, kickoff_at, id",
    );
    return rows.map((r: any) => ({
      id: r.id,
      week: r.week,
      kickoffAt: iso(r.kickoff_at),
      dayOfWeek: r.day_of_week,
      awayTeam: r.away_team,
      homeTeam: r.home_team,
      homeScore: r.home_score,
      awayScore: r.away_score,
      status: r.status,
    }));
  },

  async getArchive2025() {
    const [a, b] = await Promise.all([
      db().query("select * from archive_2025_entries order by lynne_number"),
      db().query("select * from archive_2025_weekly order by week"),
    ]);
    return {
      entries: a.rows.map((r: any) => ({
        lynneNumber: r.lynne_number,
        entryName: r.entry_name,
        outcome: r.outcome,
        picks: r.picks,
      })),
      weekly: b.rows.map((r: any) => ({
        week: r.week,
        noLosses: r.no_losses,
        lossBye: r.loss_bye,
        out: r.out,
      })),
    };
  },

  async getEntries(): Promise<EntrySummary[]> {
    const { rows } = await db().query(
      "select * from v_entry_public order by entry_name",
    );
    return rows.map(mapEntry);
  },

  async getEntry(id: string): Promise<EntryDetail | null> {
    const { rows } = await db().query(
      "select * from v_entry_public where id = $1",
      [id],
    );
    if (rows.length === 0) return null;
    const { rows: picks } = await db().query(
      "select * from v_grid_cells where entry_id = $1 order by week",
      [id],
    );
    return { entry: mapEntry(rows[0]), picks: picks.map(mapCell) };
  },

  async getGridCells(): Promise<GridCell[]> {
    const { rows } = await db().query(
      "select * from v_grid_cells order by week",
    );
    return rows.map(mapCell);
  },

  async getPot(): Promise<PotSummary> {
    const { rows } = await db().query("select * from v_pot");
    return {
      dueCents: Number(rows[0].due_cents),
      paidCents: Number(rows[0].paid_cents),
      entryCount: Number(rows[0].entry_count),
    };
  },

  async getLynneImports() {
    const { rows } = await db().query(
      "select * from lynne_imports order by imported_at desc",
    );
    return rows.map((r: any) => ({
      id: r.id,
      week: r.week,
      filename: r.filename,
      fileSha256: r.file_sha256,
      importedAt:
        r.imported_at instanceof Date
          ? r.imported_at.toISOString()
          : r.imported_at,
      rowCount: r.row_count,
      matchedCount: r.matched_count,
      unmatched: r.unmatched,
      variances: r.variances,
      rows: r.rows,
    }));
  },
};
