// Supabase admin backend: acts as the signed-in admin via the cookie-bound
// authenticated client. No service-role key exists anywhere — RLS's
// is_admin() policies are the enforcement, and callers (server actions)
// additionally verify the admin session before every call.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AdminBackend,
  AdminEntry,
  AdminOwner,
  AdminPayment,
  AuditRow,
} from "./admin-types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminSupabaseBackend: AdminBackend = {
  async listOwners(): Promise<AdminOwner[]> {
    const c = await createSupabaseServerClient();
    const [{ data: owners, error: e1 }, { data: finance, error: e2 }, { data: entries, error: e3 }, { data: payments, error: e4 }] =
      await Promise.all([
        c.from("owners").select("*").order("last_name").order("first_name"),
        c.from("v_owner_finance").select("*"),
        c.from("entries").select("owner_id, voided_at"),
        c.from("payments").select("owner_id, amount_cents"),
      ]);
    if (e1 || e2 || e3 || e4) throw e1 ?? e2 ?? e3 ?? e4;
    const fin = new Map((finance ?? []).map((f: any) => [f.owner_id, f]));
    return (owners ?? []).map((r: any) => {
      const f = fin.get(r.id);
      const liveEntries = (entries ?? []).filter(
        (e: any) => e.owner_id === r.id && !e.voided_at,
      ).length;
      const paidSum = (payments ?? [])
        .filter((p: any) => p.owner_id === r.id)
        .reduce((s: number, p: any) => s + p.amount_cents, 0);
      return {
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        phone: r.phone,
        source: r.source,
        participationStatus: r.participation_status,
        notes: r.notes,
        entryCount: Number(f?.entry_count ?? liveEntries),
        paidEntryCount: Number(f?.paid_entry_count ?? 0),
        dueCents: Number(f?.amount_due_cents ?? 0),
        paidCents: Number(f?.amount_paid_cents ?? paidSum),
      };
    });
  },

  async listEntries(): Promise<AdminEntry[]> {
    const c = await createSupabaseServerClient();
    const [{ data: entries, error: e1 }, { data: owners, error: e2 }, { data: picks, error: e3 }] =
      await Promise.all([
        c.from("entries").select("*").order("entry_index"),
        c.from("owners").select("id, first_name, last_name"),
        c.from("picks").select("entry_id"),
      ]);
    if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;
    const names = new Map(
      (owners ?? []).map((o: any) => [o.id, `${o.first_name} ${o.last_name}`]),
    );
    const counts = new Map<string, number>();
    for (const p of picks ?? []) {
      counts.set(p.entry_id, (counts.get(p.entry_id) ?? 0) + 1);
    }
    return (entries ?? [])
      .map((r: any) => ({
        id: r.id,
        ownerId: r.owner_id,
        ownerName: names.get(r.owner_id) ?? "?",
        entryIndex: r.entry_index,
        entryName: r.entry_name,
        nameIsDefault: r.name_is_default,
        lynneLabel: r.lynne_label,
        isFreeEntry: r.is_free_entry,
        voidedAt: r.voided_at,
        pickCount: counts.get(r.id) ?? 0,
      }))
      .sort(
        (a: AdminEntry, b: AdminEntry) =>
          a.ownerName.localeCompare(b.ownerName) || a.entryIndex - b.entryIndex,
      );
  },

  async listPayments(): Promise<AdminPayment[]> {
    const c = await createSupabaseServerClient();
    const [{ data: payments, error: e1 }, { data: owners, error: e2 }] =
      await Promise.all([
        c.from("payments").select("*").order("created_at", { ascending: false }),
        c.from("owners").select("id, first_name, last_name"),
      ]);
    if (e1 || e2) throw e1 ?? e2;
    const names = new Map(
      (owners ?? []).map((o: any) => [o.id, `${o.first_name} ${o.last_name}`]),
    );
    return (payments ?? []).map((r: any) => ({
      id: r.id,
      ownerId: r.owner_id,
      ownerName: r.owner_id ? (names.get(r.owner_id) ?? null) : null,
      amountCents: Number(r.amount_cents),
      method: r.method,
      paidOn: r.paid_on,
      venmoTxnId: r.venmo_txn_id,
      note: r.note,
      correctsPaymentId: r.corrects_payment_id,
      createdAt: r.created_at,
    }));
  },

  async auditTail(limit: number): Promise<AuditRow[]> {
    const c = await createSupabaseServerClient();
    const { data, error } = await c
      .from("audit_log")
      .select("id, at, actor, action, target_table, target_id, note")
      .order("id", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: Number(r.id),
      at: r.at,
      actor: r.actor,
      action: r.action,
      targetTable: r.target_table,
      targetId: r.target_id,
      note: r.note,
    }));
  },

  async createOwner(a) {
    const { data, error } = await (await createSupabaseServerClient()).rpc(
      "admin_create_owner",
      {
        p_first_name: a.firstName,
        p_last_name: a.lastName,
        p_email: a.email,
        p_phone: a.phone,
        p_source: a.source,
        p_notes: a.notes,
        p_entry_names: a.entryNames,
        p_name_is_default: a.nameIsDefault,
        p_actor: a.actor,
      },
    );
    if (error) throw error;
    return data as string;
  },

  async updateOwner(a) {
    const { error } = await (await createSupabaseServerClient()).rpc(
      "admin_update_owner",
      {
        p_owner_id: a.ownerId,
        p_first_name: a.firstName,
        p_last_name: a.lastName,
        p_email: a.email,
        p_phone: a.phone,
        p_participation_status: a.participationStatus,
        p_notes: a.notes,
        p_actor: a.actor,
      },
    );
    if (error) throw error;
  },

  async addEntries(a) {
    const { error } = await (await createSupabaseServerClient()).rpc(
      "admin_add_entries",
      {
        p_owner_id: a.ownerId,
        p_entry_names: a.entryNames,
        p_name_is_default: a.nameIsDefault,
        p_is_free: a.isFree,
        p_actor: a.actor,
      },
    );
    if (error) throw error;
  },

  async updateEntry(a) {
    const { error } = await (await createSupabaseServerClient()).rpc(
      "admin_update_entry",
      {
        p_entry_id: a.entryId,
        p_entry_name: a.entryName,
        p_lynne_label: a.lynneLabel,
        p_is_free: a.isFree,
        p_actor: a.actor,
      },
    );
    if (error) throw error;
  },

  async removeEntry(a) {
    const { error } = await (await createSupabaseServerClient()).rpc(
      "admin_remove_entry",
      { p_entry_id: a.entryId, p_actor: a.actor },
    );
    if (error) throw error;
  },

  async voidEntry(a) {
    const { error } = await (await createSupabaseServerClient()).rpc(
      "admin_void_entry",
      { p_entry_id: a.entryId, p_actor: a.actor },
    );
    if (error) throw error;
  },

  async recordPayment(a) {
    const { data, error } = await (await createSupabaseServerClient()).rpc(
      "admin_record_payment",
      {
        p_owner_id: a.ownerId,
        p_amount_cents: a.amountCents,
        p_method: a.method,
        p_paid_on: a.paidOn,
        p_venmo_txn_id: a.venmoTxnId,
        p_note: a.note,
        p_corrects: a.corrects,
        p_actor: a.actor,
      },
    );
    if (error) throw error;
    return data as string;
  },

  async submitPick(a) {
    const { data, error } = await (await createSupabaseServerClient()).rpc(
      "admin_submit_pick",
      {
        p_entry_id: a.entryId,
        p_week: a.week,
        p_team: a.team,
        p_source: a.source,
        p_actor: a.actor,
      },
    );
    if (error) throw error;
    return data as string;
  },

  async setResult(a) {
    const { error } = await (await createSupabaseServerClient()).rpc(
      "admin_set_result",
      {
        p_entry_id: a.entryId,
        p_week: a.week,
        p_result: a.result,
        p_result_source: a.resultSource,
        p_actor: a.actor,
      },
    );
    if (error) throw error;
  },

  async deadlineSweep(a) {
    const { data, error } = await (await createSupabaseServerClient()).rpc(
      "admin_deadline_sweep",
      { p_week: a.week, p_commit: a.commit, p_actor: a.actor },
    );
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      entryId: r.entry_id,
      entryName: r.entry_name,
      ownerName: r.owner_name,
    }));
  },

  async getConfig() {
    const c = await createSupabaseServerClient();
    const { data, error } = await c.from("config").select("*").single();
    if (error) throw error;
    return {
      tier13Cents: data.tier_1_3_cents,
      tier4PlusCents: data.tier_4plus_cents,
      lynneRateCents: data.lynne_rate_cents,
      freeEntryRatio: data.free_entry_ratio,
      doubleElimThroughWeek: data.double_elim_through_week,
      seasonStatus: data.season_status,
      timezone: data.timezone,
    };
  },

  async listAllPicks() {
    const c = await createSupabaseServerClient();
    const { data, error } = await c
      .from("picks")
      .select("entry_id, week, team, submitted_at, source, late, result, is_current")
      .order("week")
      .order("submitted_at");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      entryId: r.entry_id,
      week: r.week,
      team: r.team,
      submittedAt: r.submitted_at,
      source: r.source,
      late: r.late,
      result: r.result,
      isCurrent: r.is_current,
    }));
  },

  async logAudit(a) {
    const c = await createSupabaseServerClient();
    const { error } = await c.from("audit_log").insert({
      actor: a.actor,
      action: a.action,
      target_table: "export",
      note: a.note,
    });
    if (error) throw error;
  },

  async importExists(sha256) {
    const { data, error } = await (await createSupabaseServerClient())
      .from("lynne_imports")
      .select("id")
      .eq("file_sha256", sha256)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },

  async applyLynneImport(a) {
    const { data, error } = await (await createSupabaseServerClient()).rpc(
      "admin_apply_lynne_import",
      {
        p_week: a.week,
        p_filename: a.filename,
        p_sha256: a.sha256,
        p_rows: a.rows,
        p_row_count: a.rowCount,
        p_matched_count: a.matchedCount,
        p_unmatched: a.unmatched,
        p_variances: a.variances,
        p_applies: a.applies,
        p_actor: a.actor,
      },
    );
    if (error) throw error;
    return data as string;
  },
};
