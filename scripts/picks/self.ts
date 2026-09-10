// npm run picks:self [-- --message-id <id>] [--week N] [--dry-run] [--yes]
//
// Anthony's own dictated picks, from a self-email. He takes picks by text and
// by phone and enters them by mailing HIMSELF, subject carrying "Survivor",
// one pick per line:
//
//     1073 LAC
//     Nolan Lawrence #1 Los Angeles Chargers
//
// This is DELIBERATELY a separate command from `npm run picks`. The ordinary
// intake must never read his mailbox - his free entries sit under his own
// owner row, so a self-sent chase or distribute copy would be read as a
// player's picks - and keeping this out of that path means nothing here can
// change what the hourly sweep does.
//
// Every rule lives in ./lib/self-email.ts and every write goes through
// admin_apply_self_pick_email, which calls admin_submit_pick per line (so the
// deadline, repeated-team and bye guards all still apply), audits each line
// with the Gmail message id, and writes nothing at all on a replay.
//
// It never sends. The reply is a DRAFT on his own thread plus the same lines
// on stdout, because the send allowlist is two templates and adding a third
// is a reviewed change, not a convenience.

import {
  adminClient,
  loadCurrentPicks,
  loadGames,
  loadLiveEntries,
  loadPriorPicks,
  loadStandings,
  loadWeeks,
} from "../lib/db";
import { ADMIN_MAILBOX } from "../lib/constants";
import { createDraft, gmailClient, listUnreadMatching, markProcessed, type InboundMessage } from "../lib/gmail";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { confirm } from "../lib/prompt";
import { takeValue, weekArg } from "../lib/args";
import { aliveEntries } from "../lib/roster";
import { effectiveSubmitTime, stripQuotedReply, weekOfMessage } from "./lib/resolve";
import {
  conflictingSelfRows,
  guardSelfRows,
  isSelfPickSubject,
  parseSelfPickEmail,
  SELF_PICK_SUBJECT_TERM,
  selfPickReply,
  type SelfEntry,
  type SelfPickRow,
} from "./lib/self-email";

interface Args {
  messageId: string | null;
  week: number | null;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  let messageId: string | null = null;
  let week: number | null = null;
  let dryRun = false;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--message-id") messageId = takeValue(argv, ++i, "--message-id");
    else if (x === "--week") week = weekArg(takeValue(argv, ++i, "--week"));
    else if (x === "--dry-run") dryRun = true;
    else if (x === "--yes") yes = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  return { messageId, week, dryRun, yes };
}

/** The label the ordinary intake files swept mail under; the same one here. */
const DONE_LABEL = "Pool-Survivor-Done";

/** Unread self-mail whose subject carries the word, newest first. */
function selfQuery(): string {
  return `is:unread -in:draft from:${ADMIN_MAILBOX} to:${ADMIN_MAILBOX} subject:${SELF_PICK_SUBJECT_TERM}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gmail = gmailClient();
  const fileMessage = async (id: string): Promise<void> => {
    const labelled = await markProcessed(gmail, id, DONE_LABEL);
    if (!labelled) console.log(`label ${DONE_LABEL} not found; ${id} marked read only`);
  };
  const admin = await adminClient();
  const client = admin.client;

  const found: InboundMessage[] = await listUnreadMatching(gmail, selfQuery());
  const msgs = args.messageId ? found.filter((m) => m.id === args.messageId) : found;
  if (!msgs.length) {
    console.log("No unread self-email with a Survivor subject. Nothing to do.");
    return;
  }

  // AN ELIMINATED ENTRY IS OFF THIS ROSTER, as it is off the ordinary intake
  // and the pick-email screen: loadLiveEntries filters only voided_at, and
  // admin_submit_pick would happily write a pick for an entry that is out.
  // Named on the terminal so nothing drops out silently.
  const { alive, out } = aliveEntries(await loadLiveEntries(client), await loadStandings(client));
  if (out.length) {
    console.log(`Not taking picks (${out.length}): ${out.map((x) => `${x.entry.entry_name} (${x.why})`).join(", ")}`);
  }
  const entries: SelfEntry[] = alive.map((e) => ({
    id: e.id,
    entryName: e.entry_name,
    lynneNumber: e.lynne_number,
  }));
  const weeks = await loadWeeks(client);

  for (const m of msgs) {
    // THE SENDER GATE. The Gmail query already asks for his address, but a
    // query is a filter and this is a check: nothing writes a pick from a
    // message that is not from his own mailbox.
    if (m.fromAddress.trim().toLowerCase() !== ADMIN_MAILBOX) {
      console.log(`skipped ${m.id}: not from the admin mailbox`);
      continue;
    }
    if (!isSelfPickSubject(m.subject)) {
      console.log(`skipped ${m.id}: subject does not carry "${SELF_PICK_SUBJECT_TERM}"`);
      continue;
    }
    const body = stripQuotedReply(m.body);
    const week = args.week ?? weekOfMessage(m.subject, body);
    if (week === null) {
      console.log(`skipped ${m.id}: no week named in the subject or the body; pass --week`);
      continue;
    }
    const games = await loadGames(client, week);
    const plays = new Set<string>(games.flatMap((g) => [g.home_team, g.away_team]));

    const bounds = weeks.find((w) => w.week === week);
    if (!bounds) {
      console.log(`skipped ${m.id}: week ${week} has no stored deadlines`);
      continue;
    }
    const current = await loadCurrentPicks(client, week);
    const prior = await loadPriorPicks(client, week);
    const priorByEntry = new Map<string, Map<string, number>>();
    for (const p of prior) {
      const seen = priorByEntry.get(p.entry_id) ?? new Map<string, number>();
      if (!seen.has(p.team)) seen.set(p.team, p.week);
      priorByEntry.set(p.entry_id, seen);
    }
    // The time the MAIL arrived, never the time this ran: a line dictated
    // before the lock stays before the lock however long it waited to be read.
    const madeAt = effectiveSubmitTime(m.receivedAt, new Date());

    const rows = parseSelfPickEmail(body, week, entries, plays);
    const conflicts = conflictingSelfRows(rows);
    const guarded = guardSelfRows(rows, {
      currentByEntry: new Map(current.map((p) => [p.entry_id, p])),
      priorByEntry,
      madeAt,
      lateDeadlineIso: bounds.late_deadline_at,
    });
    const final: SelfPickRow[] = guarded.map((r) =>
      r.ok && conflicts.has(r.entryId)
        ? {
            ok: false as const,
            line: r.line,
            reason: "this entry is given two different teams in this message",
            entryId: r.entryId,
            entryName: r.entryName,
            team: r.team,
          }
        : r,
    );
    const toWrite = final.filter((r): r is Extract<SelfPickRow, { ok: true }> => r.ok);
    // Every row this run calls staged is sent to the RPC and really staged, in
    // the same transaction as the applies. A row that resolved to an entry and
    // a team is kind "pick", where approving writes the pick he dictated; a
    // line that never resolved is a question.
    const toStage = final
      .filter((r): r is Extract<SelfPickRow, { ok: false }> => !r.ok)
      .map((r) =>
        r.entryId && r.team
          ? {
              kind: "pick",
              entry_id: r.entryId,
              entry_name: r.entryName,
              week,
              team: r.team,
              source: "text",
              received_at: m.receivedAt,
              line: r.line,
              reason: r.reason,
              question: `Record this pick anyway? ${r.reason}. Approve writes it; dismiss leaves the entry as it is.`,
            }
          : {
              kind: "player_question",
              week,
              line: r.line,
              reason: r.reason,
              question: `Which entry and team did this mean? ${r.reason}.`,
            },
      );

    console.log(`\n${m.subject}  (week ${week}, ${m.id})`);
    for (const r of final) {
      console.log(r.ok ? `  apply  ${r.lynneNumber ?? r.entryName}  ${r.team}` : `  stage  ${r.line}  - ${r.reason}`);
    }
    if (args.dryRun) continue;
    if (!toWrite.length && !toStage.length) {
      console.log("Nothing to write from this message.");
      await notify(needsAnthonyLine("picks:self", "nothing applied", `week ${week} - see the terminal`), { tags: "warning" });
      continue;
    }
    if (!args.yes && !(await confirm(`Apply ${toWrite.length} pick(s) and stage ${toStage.length}? (y/N) `))) {
      console.log("Not approved. Nothing written.");
      continue;
    }

    const { data, error } = await client.rpc("admin_apply_self_pick_email", {
      p_message_id: m.id,
      p_rows: toWrite.map((r) => ({
        entry_id: r.entryId,
        week,
        team: r.team,
        line: r.line,
        // The receipt time, so a run after the deadline does not mark a pick
        // late that the mail beat.
        submitted_at: m.receivedAt,
      })),
      p_staged: toStage,
      // The actor is the one adminClient derived, never a literal:
      // tests/unit/audit-actor-names.test.ts fails on a hardcoded actor.
      p_actor: admin.actor,
    });
    if (error) throw new Error(`admin_apply_self_pick_email: ${error.message}`);
    const result = data as { applied: number; staged: number; already_applied: boolean };
    // A REPLAY STOPS HERE. The rows say "applied" because the parser could
    // read them, not because this run wrote anything, and a second draft
    // saying so on the same thread is a lie that accumulates.
    if (result.already_applied) {
      console.log("Already applied on an earlier run; nothing written, nothing staged, no reply drafted.");
      await fileMessage(m.id);
      continue;
    }
    console.log(`${result.applied} written, ${result.staged} staged.`);

    const reply = selfPickReply(final, week);
    const d = await createDraft(gmail, { to: [ADMIN_MAILBOX], subject: `Re: ${m.subject}`, body: reply }, m.threadId);
    console.log(`\n${reply}\n(reply drafted ${d.draftId}; a draft is never a send)`);
    // Read and filed, so the next run does not find it again and re-prompt.
    await fileMessage(m.id);
    await notify(finishedLine("picks:self", `week ${week}: ${result.applied} applied, ${result.staged} staged`));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
