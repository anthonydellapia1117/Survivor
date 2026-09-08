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
}

export interface EntryRow {
  id: string;
  owner_id: string;
  entry_name: string;
  player_email: string | null;
  is_free_entry: boolean;
  lynne_number: number | null;
  lynne_label: string | null;
  voided_at: string | null;
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
      .select("id, first_name, last_name, email")
      .is("deleted_at", null)
      .returns<OwnerRow[]>(),
    "owners",
  );
}

export async function loadLiveEntries(client: SupabaseClient): Promise<EntryRow[]> {
  return unwrap(
    await client
      .from("entries")
      .select(
        "id, owner_id, entry_name, player_email, is_free_entry, lynne_number, lynne_label, voided_at",
      )
      .is("voided_at", null)
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
      .select("entry_id, team, late, submitted_at")
      .eq("week", week)
      .eq("is_current", true)
      .returns<CurrentPickRow[]>(),
    "picks",
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
  p: { entryId: string; week: number; team: string; source: "email" | "text"; actor: string },
): Promise<string> {
  const { data, error } = await client.rpc("admin_submit_pick", {
    p_entry_id: p.entryId,
    p_week: p.week,
    p_team: p.team,
    p_source: p.source,
    p_actor: p.actor,
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
