// Local-Postgres admin backend (dev/visual testing). Mirrors admin-supabase.

import { Pool } from "pg";
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
    const { rows } = await db().query(`
      select e.*, o.first_name || ' ' || o.last_name as owner_name,
             (select count(*) from picks p where p.entry_id = e.id) as pick_count
      from entries e join owners o on o.id = e.owner_id
      order by o.last_name, o.first_name, e.entry_index`);
    return rows.map((r: any) => ({
      id: r.id,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      entryIndex: r.entry_index,
      entryName: r.entry_name,
      nameIsDefault: r.name_is_default,
      lynneLabel: r.lynne_label,
      isFreeEntry: r.is_free_entry,
      voidedAt: iso(r.voided_at),
      pickCount: Number(r.pick_count),
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
      "select id, at, actor, action, target_table, target_id, note from audit_log order by id desc limit $1",
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

  async updateEntry(a) {
    await db().query("select admin_update_entry($1,$2,$3,$4,$5)", [
      a.entryId,
      a.entryName,
      a.lynneLabel,
      a.isFree,
      a.actor,
    ]);
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
};
