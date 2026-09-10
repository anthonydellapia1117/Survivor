// One read of everything the daily reporters work from.
//
// The reporters are pure: scripts/ops/reporters/* take an OpsSnapshot and
// return a Report, and none of them opens a connection or reads mail. This is
// the one place that gathers it, so a run reads the roster once rather than
// six times, every reporter sees the SAME instant, and a reporter can be
// tested against a fixture instead of against a live season.
//
// It reads as the signed-in admin through RLS, like every other command here.
// There is no service-role key, by design.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { gmail_v1 } from "googleapis";
import { loadOwners, loadWeeks } from "../lib/db";
import { fetchAllPages } from "../lib/paged";
import { LYNNE_EMAIL } from "../lib/constants";
import { getMessageMeta, searchMessages } from "../lib/gmail";
import { loadOpsConfig } from "./lib/config";
import type {
  EntrySnapshot, GameSnapshot, HerMailSnapshot, HerRowSnapshot, OpsSnapshot,
  OwnerSnapshot, PaymentSnapshot, PickSnapshot, SheetSnapshot,
} from "./reporters/types";

interface RosterRow {
  row_no: number;
  names: string;
  cells: Record<string, string> | null;
  cell_sources: Record<string, { source?: string }> | null;
  sheet_sha256: string;
  source_file: string;
  gmail_message_id: string | null;
  loaded_at: string;
}

/** Her header text to a week number. The same rule as lynne_cell_week() in SQL. */
function weekOf(header: string): number | null {
  const m = /^\s*(?:week|wk)\s*(\d{1,2})\s*$/i.exec(header);
  return m ? Number(m[1]) : null;
}

export async function loadSnapshot(
  client: SupabaseClient,
  now: Date,
  gmail: gmail_v1.Gmail | null,
): Promise<OpsSnapshot> {
  const config = loadOpsConfig();
  const weekRows = await loadWeeks(client);

  const { data: gameRows, error: gameErr } = await client
    .from("nfl_games")
    .select("week, day_of_week, home_team, away_team, kickoff_at")
    .order("kickoff_at", { ascending: true })
    .returns<{ week: number; day_of_week: string; home_team: string; away_team: string; kickoff_at: string }[]>();
  if (gameErr) throw new Error(`nfl_games: ${gameErr.message}`);

  // Two plain reads joined here rather than one embedded select. Every other
  // command in scripts/ reads these tables flat, and a PostgREST embed
  // (`owners!inner(...)`) would be the first in the repo - an untested query
  // shape in a job nobody watches run. The join is three lines of TypeScript.
  const ownerRows = await loadOwners(client);
  const ownersById = new Map(ownerRows.map((o) => [o.id, o]));

  const { data: entryRows, error: entryErr } = await client
    .from("entries")
    .select("id, owner_id, entry_name, lynne_number, is_free_entry, is_gifted, player_email, submitted_to_lynne_at, submitted_as_name")
    .is("voided_at", null)
    .order("created_at")
    .returns<Record<string, unknown>[]>();
  if (entryErr) throw new Error(`entries: ${entryErr.message}`);

  const entries: EntrySnapshot[] = (entryRows ?? [])
    .map((r) => {
      // loadOwners already drops deleted rows, so an entry whose owner is not
      // in the map belongs to a deleted or unconfirmed owner and is not on any
      // list this reports on.
      const o = ownersById.get(String(r.owner_id));
      if (!o || o.participation_status !== "confirmed") return null;
      return {
        id: String(r.id),
        entryName: String(r.entry_name),
        lynneNumber: (r.lynne_number as number | null) ?? null,
        ownerName: `${o.first_name} ${o.last_name}`.trim(),
        ownerEmail: o.email,
        playerEmail: (r.player_email as string | null) ?? null,
        isFreeEntry: Boolean(r.is_free_entry),
        isGifted: Boolean(r.is_gifted),
        submittedToLynneAt: (r.submitted_to_lynne_at as string | null) ?? null,
        submittedAsName: (r.submitted_as_name as string | null) ?? null,
      };
    })
    .filter((e): e is EntrySnapshot => e !== null);

  const { data: pickRows, error: pickErr } = await client
    .from("picks")
    .select("entry_id, week, team, submitted_at, late, source")
    .eq("is_current", true)
    .returns<PickSnapshot[] | Record<string, unknown>[]>();
  if (pickErr) throw new Error(`picks: ${pickErr.message}`);
  const picks: PickSnapshot[] = (pickRows ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      entryId: String(x.entry_id),
      week: Number(x.week),
      team: String(x.team),
      submittedAt: String(x.submitted_at),
      late: Boolean(x.late),
      source: String(x.source),
    };
  });

  // Her newest sheet, and only that one: v_master_list serves the newest and
  // so does every comparison a reporter makes.
  const { data: newest, error: newestErr } = await client
    .from("lynne_roster")
    .select("sheet_sha256, source_file, gmail_message_id, loaded_at")
    .order("loaded_at", { ascending: false })
    .limit(1)
    .returns<Pick<RosterRow, "sheet_sha256" | "source_file" | "gmail_message_id" | "loaded_at">[]>();
  if (newestErr) throw new Error(`lynne_roster: ${newestErr.message}`);
  const sheetRow = newest?.[0] ?? null;

  let herRows: HerRowSnapshot[] = [];
  let herSheet: SheetSnapshot | null = null;
  if (sheetRow) {
    // Paged: PostgREST caps a response at 1,000 rows and her sheet is longer,
    // so a single read would silently hand back a short roster (issue in
    // scripts/lynne/roster.ts, same cause).
    const rows = await fetchAllPages<RosterRow>(async (from, to) => {
      const { data, error } = await client
        .from("lynne_roster")
        .select("row_no, names, cells, cell_sources, sheet_sha256, source_file, gmail_message_id, loaded_at")
        .eq("sheet_sha256", sheetRow.sheet_sha256)
        .order("row_no", { ascending: true })
        .range(from, to)
        .returns<RosterRow[]>();
      if (error) throw new Error(`lynne_roster rows: ${error.message}`);
      return data ?? [];
    });
    herRows = rows.map((r) => {
      const cells: Record<number, string> = {};
      const cellSources: Record<number, string> = {};
      for (const [k, v] of Object.entries(r.cells ?? {})) {
        const w = weekOf(k);
        if (w !== null && String(v).trim() !== "") {
          cells[w] = v;
          cellSources[w] = r.cell_sources?.[k]?.source ?? "sheet";
        }
      }
      return { rowNo: r.row_no, names: r.names, cells, cellSources };
    });
    herSheet = {
      sha256: sheetRow.sheet_sha256,
      sourceFile: sheetRow.source_file,
      gmailMessageId: sheetRow.gmail_message_id,
      loadedAt: sheetRow.loaded_at,
      rowCount: rows.length,
    };
  }

  // v_owner_finance is owner_id and money; it carries no name and no address
  // (20260821000002). The name comes from the owners read above.
  const { data: finance, error: finErr } = await client
    .from("v_owner_finance")
    .select("owner_id, entry_count, amount_due_cents, amount_paid_cents")
    .returns<Record<string, unknown>[]>();
  if (finErr) throw new Error(`v_owner_finance: ${finErr.message}`);
  const owners: OwnerSnapshot[] = (finance ?? []).map((r) => {
    const o = ownersById.get(String(r.owner_id));
    return {
      id: String(r.owner_id),
      // Never a first name alone: there are three Tropeas and they are three
      // people (CLAUDE.md). An owner the map does not carry is named as
      // unknown rather than given a name this made up.
      name: o ? `${o.first_name} ${o.last_name}`.trim() : `owner ${String(r.owner_id).slice(0, 8)} (name not read)`,
      email: o?.email ?? null,
      entryCount: Number(r.entry_count ?? 0),
      dueCents: Number(r.amount_due_cents ?? 0),
      paidCents: Number(r.amount_paid_cents ?? 0),
    };
  });

  const { data: payRows, error: payErr } = await client
    .from("payments")
    .select("owner_id, amount_cents, venmo_txn_id, paid_on, note")
    .returns<Record<string, unknown>[]>();
  if (payErr) throw new Error(`payments: ${payErr.message}`);
  const payments: PaymentSnapshot[] = (payRows ?? []).map((r) => ({
    ownerId: (r.owner_id as string | null) ?? null,
    amountCents: Number(r.amount_cents ?? 0),
    venmoTxnId: (r.venmo_txn_id as string | null) ?? null,
    paidOn: (r.paid_on as string | null) ?? null,
    note: (r.note as string | null) ?? null,
  }));

  const { data: cfg, error: cfgErr } = await client
    .from("config").select("lynne_rate_cents").eq("id", 1).single()
    .returns<{ lynne_rate_cents: number }>();
  if (cfgErr) throw new Error(`config: ${cfgErr.message}`);

  // DERIVED LIVE, EVERY RUN. Never a saved list: a stale one sent a message
  // to 27 addresses instead of 39 (CLAUDE.md).
  const recipientAddresses = Array.from(
    new Set(
      entries
        .flatMap((e) => [e.ownerEmail, e.playerEmail])
        .filter((a): a is string => Boolean(a && a.trim()))
        .map((a) => a.trim().toLowerCase()),
    ),
  ).sort();

  // Gmail is optional: a run without it says the sheet watch is blind rather
  // than reporting that nothing is waiting.
  let herMail: HerMailSnapshot[] | null = null;
  if (gmail) {
    const refs = await searchMessages(gmail, `from:${LYNNE_EMAIL}`, 40);
    const out: HerMailSnapshot[] = [];
    for (const r of refs) {
      const meta = await getMessageMeta(gmail, r.id);
      out.push({
        messageId: meta.id,
        subject: meta.subject,
        receivedAt: new Date(meta.internalMs).toISOString(),
        filenames: meta.attachments.map((a) => a.filename),
        hasAttachment: meta.attachments.length > 0,
      });
    }
    herMail = out;
  }

  return {
    now,
    weeks: weekRows.map((w) => ({
      week: w.week,
      earlyDeadlineAt: w.early_deadline_at,
      lateDeadlineAt: w.late_deadline_at,
    })),
    games: (gameRows ?? []).map<GameSnapshot>((g) => ({
      week: g.week,
      dayOfWeek: g.day_of_week,
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      kickoffAt: g.kickoff_at,
    })),
    entries,
    picks,
    herRows,
    herSheet,
    herMail,
    owners,
    payments,
    recipientAddresses,
    expectedRosterAddresses: config.expectedRosterAddresses,
    freeEntryCount: entries.filter((e) => e.isFreeEntry).length,
    recruitedCount: entries.filter((e) => !e.isFreeEntry).length,
    lynneRateCents: cfg.lynne_rate_cents,
  };
}
