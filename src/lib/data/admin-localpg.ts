// Local-Postgres admin backend (dev/visual testing). Mirrors admin-supabase.

import { Pool, types as pgTypes } from "pg";
import { FREE_ENTRY_OWNER_EMAIL } from "@/lib/free-entries";
import type {
  AdminBackend,
  AdminEntry,
  AdminOwner,
  AdminPayment,
  AuditRow,
} from "./admin-types";

/* eslint-disable @typescript-eslint/no-explicit-any */

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.LOCAL_PG_URL });
  return pool;
}

// Backup dumps go through a pool that leaves date/timestamp columns as raw
// text: JS Date only holds milliseconds, which would silently truncate the
// database's microsecond precision on restore. (The Supabase backend gets
// strings from PostgREST, so this matches production behavior.)
const TIME_OIDS = new Set([1082, 1114, 1184]); // date, timestamp, timestamptz
let rawPool: Pool | null = null;
function rawDb(): Pool {
  if (!rawPool)
    rawPool = new Pool({
      connectionString: process.env.LOCAL_PG_URL,
      types: {
        getTypeParser: (oid: number, format: any) =>
          TIME_OIDS.has(oid)
            ? (v: string) => v
            : (pgTypes.getTypeParser as any)(oid, format),
      } as any,
    });
  return rawPool;
}

const iso = (v: any) => (v instanceof Date ? v.toISOString() : v);

export const adminLocalPgBackend: AdminBackend = {
  async listOwners(): Promise<AdminOwner[]> {
    const { rows } = await db().query(`
      select o.*,
             coalesce(f.entry_count, (select count(*) from entries e where e.owner_id = o.id and e.voided_at is null)) as entry_count,
             coalesce(f.paid_entry_count, 0) as paid_entry_count,
             coalesce(f.amount_due_cents, 0) as due_cents,
             coalesce(f.amount_paid_cents, (select coalesce(sum(p.amount_cents),0) from payments p where p.owner_id = o.id)) as paid_cents
      from owners o
      left join v_owner_finance f on f.owner_id = o.id
      where o.deleted_at is null
      order by o.last_name, o.first_name`);
    return rows.map((r: any) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      phone: r.phone,
      source: r.source,
      participationStatus: r.participation_status,
      notes: r.notes,
      entryCount: Number(r.entry_count),
      paidEntryCount: Number(r.paid_entry_count),
      dueCents: Number(r.due_cents),
      paidCents: Number(r.paid_cents),
    }));
  },

  async listEntries(): Promise<AdminEntry[]> {
    const { rows } = await db().query(
      `select e.*, o.first_name || ' ' || o.last_name as owner_name,
             (o.email is not null and lower(o.email) = $1) as is_admin_entry,
             (select count(*) from picks p where p.entry_id = e.id) as pick_count
      from entries e join owners o on o.id = e.owner_id and o.deleted_at is null
      order by is_admin_entry desc, o.last_name, o.first_name, e.entry_index`,
      [FREE_ENTRY_OWNER_EMAIL],
    );
    return rows.map((r: any) => ({
      id: r.id,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      entryIndex: r.entry_index,
      entryName: r.entry_name,
      nameIsDefault: r.name_is_default,
      lynneLabel: r.lynne_label,
      lynneNumber: r.lynne_number,
      isFreeEntry: r.is_free_entry,
      isAdminEntry: Boolean(r.is_admin_entry),
      voidedAt: iso(r.voided_at),
      pickCount: Number(r.pick_count),
      submittedToLynneAt: iso(r.submitted_to_lynne_at),
      submittedAsName: r.submitted_as_name ?? null,
    }));
  },

  async listPayments(): Promise<AdminPayment[]> {
    const { rows } = await db().query(`
      select p.*, o.first_name || ' ' || o.last_name as owner_name
      from payments p left join owners o on o.id = p.owner_id
      order by p.created_at desc`);
    return rows.map((r: any) => ({
      id: r.id,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      amountCents: Number(r.amount_cents),
      method: r.method,
      paidOn: iso(r.paid_on),
      venmoTxnId: r.venmo_txn_id,
      note: r.note,
      correctsPaymentId: r.corrects_payment_id,
      createdAt: iso(r.created_at),
    }));
  },

  async auditTail(limit: number): Promise<AuditRow[]> {
    const { rows } = await db().query(
      "select id, at, actor, action, target_table, target_id, note, before, after from audit_log order by id desc limit $1",
      [limit],
    );
    return rows.map((r: any) => ({
      id: Number(r.id),
      at: iso(r.at),
      actor: r.actor,
      action: r.action,
      targetTable: r.target_table,
      targetId: r.target_id,
      note: r.note,
      before: r.before ?? null,
      after: r.after ?? null,
    }));
  },

  async createOwner(a) {
    const { rows } = await db().query(
      "select admin_create_owner($1,$2,$3,$4,$5,$6,$7,$8,$9) as id",
      [
        a.firstName,
        a.lastName,
        a.email,
        a.phone,
        a.source,
        a.notes,
        a.entryNames,
        a.nameIsDefault,
        a.actor,
      ],
    );
    return rows[0].id;
  },

  async updateOwner(a) {
    await db().query("select admin_update_owner($1,$2,$3,$4,$5,$6,$7,$8)", [
      a.ownerId,
      a.firstName,
      a.lastName,
      a.email,
      a.phone,
      a.participationStatus,
      a.notes,
      a.actor,
    ]);
  },

  async addEntries(a) {
    await db().query("select admin_add_entries($1,$2,$3,$4,$5)", [
      a.ownerId,
      a.entryNames,
      a.nameIsDefault,
      a.isFree,
      a.actor,
    ]);
  },

  async setGameScore(a) {
    const { rows } = await db().query(
      "select admin_set_game_score($1,$2,$3,$4,$5) as n",
      [a.gameId, a.homeScore, a.awayScore, a.status, a.actor],
    );
    return Number(rows[0].n);
  },

  async markNewEntriesSent(actor) {
    const { rows } = await db().query(
      "select admin_mark_new_entries_sent($1) as n",
      [actor],
    );
    return Number(rows[0].n);
  },

  async markRenamesCommunicated(actor) {
    const { rows } = await db().query(
      "select admin_mark_renames_communicated($1) as n",
      [actor],
    );
    return Number(rows[0].n);
  },

  async setPoolPot(a) {
    await db().query("select admin_set_pool_pot($1,$2,$3)", [
      a.entryCount,
      a.potCents,
      a.actor,
    ]);
  },

  async setGameReveal(a) {
    await db().query("select admin_set_game_reveal($1,$2,$3)", [
      a.gameId,
      a.override,
      a.actor,
    ]);
  },

  async listGridCells() {
    // Local dev runs as superuser: read picks raw, mirroring what the
    // authenticated admin gets through RLS in production.
    const { rows } = await db().query(
      `select entry_id, week, team, result, late, submitted_at, source, result_source
         from picks where is_current order by week`,
    );
    return rows.map((r: any) => ({
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
    }));
  },

  async listEntrySummaries() {
    // v_entry_admin gates on is_admin(), which is JWT-based — the local
    // superuser connection has no JWT, so query the raw base directly.
    const { rows } = await db().query(
      `select e.id, e.entry_name, e.name_is_default, e.is_free_entry,
              e.owner_id, o.first_name || ' ' || o.last_name as owner_name,
              (o.email is not null and lower(o.email) = '${FREE_ENTRY_OWNER_EMAIL}') as is_admin_entry,
              s.wins, s.losses, s.lives_remaining, s.status, s.bye_used,
              s.teams_used, s.last_scored_week
         from entries e
         join owners o on o.id = e.owner_id
         join v_entry_standing s on s.entry_id = e.id
        where o.participation_status = 'confirmed'
          and o.deleted_at is null
          and e.voided_at is null
        order by e.entry_name`,
    );
    return rows.map((r: any) => ({
      id: r.id,
      entryName: r.entry_name,
      nameIsDefault: Boolean(r.name_is_default),
      isFreeEntry: Boolean(r.is_free_entry),
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      wins: Number(r.wins ?? 0),
      losses: Number(r.losses ?? 0),
      livesRemaining: Number(r.lives_remaining ?? 0),
      status: r.status,
      byeUsed: Boolean(r.bye_used),
      teamsUsed: r.teams_used ?? [],
      lastScoredWeek: r.last_scored_week,
      isAdminEntry: Boolean(r.is_admin_entry),
    }));
  },

  async updateEntry(a) {
    await db().query("select admin_update_entry($1,$2,$3,$4,$5,$6)", [
      a.entryId,
      a.entryName,
      a.lynneLabel,
      a.isFree,
      a.lynneNumber,
      a.actor,
    ]);
  },

  async mergeOwner(a) {
    const { rows } = await db().query(
      "select admin_merge_owner($1,$2,$3) as r",
      [a.sourceId, a.targetId, a.actor],
    );
    return rows[0].r;
  },

  async deleteOwner(a) {
    await db().query("select admin_delete_owner($1,$2)", [a.ownerId, a.actor]);
  },

  async removeEntry(a) {
    await db().query("select admin_remove_entry($1,$2)", [a.entryId, a.actor]);
  },

  async voidEntry(a) {
    await db().query("select admin_void_entry($1,$2)", [a.entryId, a.actor]);
  },

  async recordPayment(a) {
    const { rows } = await db().query(
      "select admin_record_payment($1,$2,$3,$4,$5,$6,$7,$8) as id",
      [
        a.ownerId,
        a.amountCents,
        a.method,
        a.paidOn,
        a.venmoTxnId,
        a.note,
        a.corrects,
        a.actor,
      ],
    );
    return rows[0].id;
  },

  async submitPick(a) {
    const { rows } = await db().query(
      "select admin_submit_pick($1,$2,$3,$4,$5) as id",
      [a.entryId, a.week, a.team, a.source, a.actor],
    );
    return rows[0].id;
  },

  async setResult(a) {
    await db().query("select admin_set_result($1,$2,$3,$4,$5)", [
      a.entryId,
      a.week,
      a.result,
      a.resultSource,
      a.actor,
    ]);
  },

  async deadlineSweep(a) {
    const { rows } = await db().query(
      "select * from admin_deadline_sweep($1,$2,$3)",
      [a.week, a.commit, a.actor],
    );
    return rows.map((r: any) => ({
      entryId: r.entry_id,
      entryName: r.entry_name,
      ownerName: r.owner_name,
    }));
  },

  async getConfig() {
    const { rows } = await db().query("select * from config");
    const r = rows[0];
    return {
      tier13Cents: r.tier_1_3_cents,
      tier4PlusCents: r.tier_4plus_cents,
      lynneRateCents: r.lynne_rate_cents,
      freeEntryRatio: r.free_entry_ratio,
      doubleElimThroughWeek: r.double_elim_through_week,
      seasonStatus: r.season_status,
      timezone: r.timezone,
    };
  },

  async listAllPicks() {
    const { rows } = await db().query(
      "select entry_id, week, team, submitted_at, source, late, result, is_current from picks order by week, submitted_at",
    );
    return rows.map((r: any) => ({
      entryId: r.entry_id,
      week: r.week,
      team: r.team,
      submittedAt: iso(r.submitted_at),
      source: r.source,
      late: r.late,
      result: r.result,
      isCurrent: r.is_current,
    }));
  },

  async dumpTable(table, orderBy) {
    if (
      !/^[a-z_][a-z0-9_]*$/.test(table) ||
      (orderBy && !/^[a-z_][a-z0-9_]*$/.test(orderBy))
    ) {
      throw new Error("bad identifier");
    }
    const { rows } = await rawDb().query(
      `select * from ${table}` + (orderBy ? ` order by ${orderBy}` : ""),
    );
    return rows;
  },

  async logAudit(a) {
    await db().query(
      "insert into audit_log (actor, action, target_table, note) values ($1,$2,'export',$3)",
      [a.actor, a.action, a.note],
    );
  },

  async updateWeek(a) {
    await db().query("select admin_update_week($1,$2,$3,$4,$5)", [
      a.week,
      a.earlyDeadlineAt,
      a.lateDeadlineAt,
      a.confirmed,
      a.actor,
    ]);
  },

  async importExists(sha256) {
    const { rows } = await db().query(
      "select 1 from lynne_imports where file_sha256 = $1",
      [sha256],
    );
    return rows.length > 0;
  },

  async applyLynneImport(a) {
    const { rows } = await db().query(
      "select admin_apply_lynne_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id",
      [
        a.week,
        a.filename,
        a.sha256,
        JSON.stringify(a.rows),
        a.rowCount,
        a.matchedCount,
        JSON.stringify(a.unmatched),
        JSON.stringify(a.variances),
        JSON.stringify(a.applies),
        a.actor,
      ],
    );
    return rows[0].id;
  },
};
