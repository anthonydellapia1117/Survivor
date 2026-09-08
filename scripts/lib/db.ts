// Database access for the local commands: the same path the admin screens
// take. Sign in as the admin with the public anon key, then every read goes
// through RLS as is_admin() and every write goes through an audited RPC.
// There is no service-role key anywhere, by design.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameDay } from "@/lib/data/types";
import { loadEnv, requireEnv } from "./env";
import { promptHidden } from "./prompt";

export interface Admin {
  client: SupabaseClient;
  /** The actor string every write carries. */
  actor: string;
}

export async function adminClient(): Promise<Admin> {
  loadEnv();
  const url = requireEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "It is in .env.production.",
  );
  const key = requireEnv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "It is in .env.production.",
  );
  const email = process.env.SURVIVOR_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL;
  if (!email) {
    throw new Error("ADMIN_EMAIL (or SURVIVOR_ADMIN_EMAIL) is not set.");
  }
  const password =
    process.env.SURVIVOR_ADMIN_PASSWORD ??
    (await promptHidden(`Admin password for ${email}: `));
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Admin sign-in failed: ${error.message}`);
  return { client, actor: email };
}

export interface OwnerRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  /** confirmed | declined | ...: only confirmed owners are on any list. */
  participation_status: string;
}

export interface EntryRow {
  id: string;
  owner_id: string;
  entry_name: string;
  player_email: string | null;
  is_gifted: boolean;
  is_free_entry: boolean;
  lynne_number: number | null;
  lynne_label: string | null;
  voided_at: string | null;
}

/** One row of v_entry_standing: the app's own local calculation. */
export interface StandingRow {
  entry_id: string;
  status: string;
  losses: number;
  bye_used: boolean;
}

export interface LynneImportRow {
  id: string;
  week: number | null;
  filename: string;
  file_sha256: string;
  imported_at: string;
  row_count: number | null;
  matched_count: number | null;
}

export interface WeekBoundsRow {
  week: number;
  early_deadline_at: string;
  late_deadline_at: string;
}

export interface GameLiteRow {
  week: number;
  day_of_week: GameDay;
  home_team: string;
  away_team: string;
}

export interface CurrentPickRow {
  entry_id: string;
  team: string;
  late: boolean;
  submitted_at: string;
  /** win | loss | tie_loss | bye | pending | missed, or null before scoring. */
  result: string | null;
}

function unwrap<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  if (r.data === null) throw new Error(`${what}: no data`);
  return r.data;
}

export async function loadOwners(client: SupabaseClient): Promise<OwnerRow[]> {
  return unwrap(
    await client
      .from("owners")
      .select("id, first_name, last_name, email, participation_status")
      .is("deleted_at", null)
      .order("created_at")
      .returns<OwnerRow[]>(),
    "owners",
  );
}

export async function loadLiveEntries(client: SupabaseClient): Promise<EntryRow[]> {
  return unwrap(
    await client
      .from("entries")
      .select(
        "id, owner_id, entry_name, player_email, is_gifted, is_free_entry, lynne_number, lynne_label, voided_at",
      )
      .is("voided_at", null)
      .order("created_at")
      .order("entry_index")
      .returns<EntryRow[]>(),
    "entries",
  );
}

export async function loadWeeks(client: SupabaseClient): Promise<WeekBoundsRow[]> {
  return unwrap(
    await client
      .from("weeks")
      .select("week, early_deadline_at, late_deadline_at")
      .order("week")
      .returns<WeekBoundsRow[]>(),
    "weeks",
  );
}

export async function loadGames(client: SupabaseClient, week: number): Promise<GameLiteRow[]> {
  return unwrap(
    await client
      .from("nfl_games")
      .select("week, day_of_week, home_team, away_team")
      .eq("week", week)
      .returns<GameLiteRow[]>(),
    "nfl_games",
  );
}

export async function loadCurrentPicks(client: SupabaseClient, week: number): Promise<CurrentPickRow[]> {
  return unwrap(
    await client
      .from("picks")
      .select("entry_id, team, late, submitted_at, result")
      .eq("week", week)
      .eq("is_current", true)
      .returns<CurrentPickRow[]>(),
    "picks",
  );
}

/**
 * Standings come from v_entry_public, the view the dashboard reads, so the
 * standings sentence a command writes is the one the site shows: status and
 * losses are the app's local calculation, and bye_used counts a bye only
 * once its game has kicked off, exactly as the public grid does.
 *
 * Not v_entry_standing: the admin session signs in as the authenticated
 * role, and that view is revoked from it (verified against production
 * 2026-09-08), so a read of it dies before any command gets to plan.
 * v_entry_public is granted, and already restricted to the live entries of
 * confirmed owners, which is the set the commands act on.
 */
export async function loadStandings(client: SupabaseClient): Promise<StandingRow[]> {
  const rows = unwrap(
    await client
      .from("v_entry_public")
      .select("id, status, losses, bye_used")
      .returns<{ id: string; status: string; losses: number; bye_used: boolean }[]>(),
    "v_entry_public",
  );
  return rows.map((r) => ({ entry_id: r.id, status: r.status, losses: r.losses, bye_used: r.bye_used }));
}

/** Teams each entry has already used in weeks before `week` (current picks only). */
export async function loadUsedTeams(client: SupabaseClient, week: number): Promise<Map<string, Set<string>>> {
  const rows = unwrap(
    await client
      .from("picks")
      .select("entry_id, team")
      .lt("week", week)
      .eq("is_current", true)
      .returns<{ entry_id: string; team: string }[]>(),
    "picks (used teams)",
  );
  const used = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!used.has(r.entry_id)) used.set(r.entry_id, new Set());
    used.get(r.entry_id)!.add(r.team);
  }
  return used;
}

export async function loadLynneImports(client: SupabaseClient): Promise<LynneImportRow[]> {
  return unwrap(
    await client
      .from("lynne_imports")
      .select("id, week, filename, file_sha256, imported_at, row_count, matched_count")
      .order("imported_at", { ascending: false })
      .returns<LynneImportRow[]>(),
    "lynne_imports",
  );
}

/** True when this exact file was committed before: the dedupe the RPC also enforces. */
export async function importExists(client: SupabaseClient, sha256: string): Promise<LynneImportRow | null> {
  const rows = unwrap(
    await client
      .from("lynne_imports")
      .select("id, week, filename, file_sha256, imported_at, row_count, matched_count")
      .eq("file_sha256", sha256)
      .returns<LynneImportRow[]>(),
    "lynne_imports (sha256)",
  );
  return rows[0] ?? null;
}

/**
 * The weekly result importer, the same RPC /admin/import commits through.
 * Results only: it never sets a Lynne number and never touches money.
 */
export async function applyLynneImport(
  client: SupabaseClient,
  p: {
    week: number;
    filename: string;
    sha256: string;
    rows: unknown[];
    rowCount: number;
    matchedCount: number;
    unmatched: unknown[];
    variances: unknown[];
    applies: { entry_id: string; result: string }[];
    actor: string;
  },
): Promise<string> {
  const { data, error } = await client.rpc("admin_apply_lynne_import", {
    p_week: p.week,
    p_filename: p.filename,
    p_sha256: p.sha256,
    p_rows: p.rows,
    p_row_count: p.rowCount,
    p_matched_count: p.matchedCount,
    p_unmatched: p.unmatched,
    p_variances: p.variances,
    p_applies: p.applies,
    p_actor: p.actor,
  });
  if (error) throw new Error(`admin_apply_lynne_import: ${error.message}`);
  return String(data);
}

export interface AuditWrite {
  actor: string;
  action: string;
  targetTable: string;
  targetId: string;
  after: Record<string, unknown>;
  note?: string | null;
}

/**
 * One audit row for an action that has no data row of its own (a sent
 * email). Written by the admin under RLS, the same table every RPC writes.
 */
export async function recordAudit(client: SupabaseClient, a: AuditWrite): Promise<number> {
  const { data, error } = await client
    .from("audit_log")
    .insert({
      actor: a.actor,
      action: a.action,
      target_table: a.targetTable,
      target_id: a.targetId,
      after: a.after,
      note: a.note ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`audit_log insert: ${error.message}`);
  return Number((data as { id: number }).id);
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  target_id: string | null;
  after: Record<string, unknown> | null;
}

export async function loadAuditByAction(client: SupabaseClient, action: string): Promise<AuditRow[]> {
  return unwrap(
    await client
      .from("audit_log")
      .select("id, at, actor, action, target_id, after")
      .eq("action", action)
      .order("id")
      .returns<AuditRow[]>(),
    `audit_log (${action})`,
  );
}

/** The lowest week whose late deadline is still ahead. */
export function currentWeek(weeks: WeekBoundsRow[], now: Date): number | null {
  const open = weeks
    .filter((w) => new Date(w.late_deadline_at).getTime() > now.getTime())
    .sort((a, b) => a.week - b.week);
  return open[0]?.week ?? null;
}

export async function submitPick(
  client: SupabaseClient,
  p: {
    entryId: string;
    week: number;
    team: string;
    source: "email" | "text";
    actor: string;
    /** When the pick was made (the mail's receipt time); the RPC judges
     *  lateness at this instant. Omitted, the RPC uses now(). */
    submittedAt?: string | null;
  },
): Promise<string> {
  const { data, error } = await client.rpc("admin_submit_pick", {
    p_entry_id: p.entryId,
    p_week: p.week,
    p_team: p.team,
    p_source: p.source,
    p_actor: p.actor,
    ...(p.submittedAt ? { p_submitted_at: p.submittedAt } : {}),
  });
  if (error) throw new Error(`admin_submit_pick: ${error.message}`);
  return String(data);
}

export async function stagePending(
  client: SupabaseClient,
  p: {
    kind: "identity" | "player_question";
    payload: Record<string, unknown>;
    sourceMessageId: string | null;
    actor: string;
  },
): Promise<void> {
  const { error } = await client.rpc("admin_stage_pending", {
    p_kind: p.kind,
    p_payload: p.payload,
    p_source_message_id: p.sourceMessageId,
    p_actor: p.actor,
  });
  if (error) throw new Error(`admin_stage_pending: ${error.message}`);
}
