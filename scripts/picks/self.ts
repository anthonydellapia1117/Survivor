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

import { adminClient, loadGames, loadLiveEntries } from "../lib/db";
import { ADMIN_MAILBOX } from "../lib/constants";
import { createDraft, gmailClient, listUnreadMatching, type InboundMessage } from "../lib/gmail";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { confirm } from "../lib/prompt";
import { takeValue, weekArg } from "../lib/args";
import { stripQuotedReply, weekOfMessage } from "./lib/resolve";
import {
  conflictingSelfRows,
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

/** Unread self-mail whose subject carries the word, newest first. */
function selfQuery(): string {
  return `is:unread -in:draft from:${ADMIN_MAILBOX} to:${ADMIN_MAILBOX} subject:${SELF_PICK_SUBJECT_TERM}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gmail = gmailClient();
  const admin = await adminClient();
  const client = admin.client;

  const found: InboundMessage[] = await listUnreadMatching(gmail, selfQuery());
  const msgs = args.messageId ? found.filter((m) => m.id === args.messageId) : found;
  if (!msgs.length) {
    console.log("No unread self-email with a Survivor subject. Nothing to do.");
    return;
  }

  const entriesRows = await loadLiveEntries(client);
  const entries: SelfEntry[] = entriesRows.map((e) => ({
    id: e.id,
    entryName: e.entry_name,
    lynneNumber: e.lynne_number,
  }));

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

    const rows = parseSelfPickEmail(body, week, entries, plays);
    const conflicts = conflictingSelfRows(rows);
    const final: SelfPickRow[] = rows.map((r) =>
      r.ok && conflicts.has(r.entryId)
        ? { ok: false as const, line: r.line, reason: "this entry is given two different teams in this message" }
        : r,
    );
    const toWrite = final.filter((r): r is Extract<SelfPickRow, { ok: true }> => r.ok);

    console.log(`\n${m.subject}  (week ${week}, ${m.id})`);
    for (const r of final) {
      console.log(r.ok ? `  apply  ${r.lynneNumber ?? r.entryName}  ${r.team}` : `  stage  ${r.line}  - ${r.reason}`);
    }
    if (args.dryRun) continue;
    if (!toWrite.length) {
      console.log("Nothing to write from this message.");
      await notify(needsAnthonyLine("picks:self", "nothing applied", `week ${week} - see the terminal`), { tags: "warning" });
      continue;
    }
    if (!args.yes && !(await confirm(`Apply ${toWrite.length} pick(s)? (y/N) `))) {
      console.log("Not approved. Nothing written.");
      continue;
    }

    const { data, error } = await client.rpc("admin_apply_self_pick_email", {
      p_message_id: m.id,
      p_rows: toWrite.map((r) => ({ entry_id: r.entryId, week, team: r.team, line: r.line })),
      // The actor is the one adminClient derived, never a literal:
      // tests/unit/audit-actor-names.test.ts fails on a hardcoded actor.
      p_actor: admin.actor,
    });
    if (error) throw new Error(`admin_apply_self_pick_email: ${error.message}`);
    const result = data as { applied: number; already_applied: boolean };
    console.log(result.already_applied ? "Already applied on an earlier run; nothing written." : `${result.applied} written.`);

    const reply = selfPickReply(final, week);
    const d = await createDraft(gmail, { to: [ADMIN_MAILBOX], subject: `Re: ${m.subject}`, body: reply }, m.threadId);
    console.log(`\n${reply}\n(reply drafted ${d.draftId}; a draft is never a send)`);
    await notify(finishedLine("picks:self", `week ${week}: ${result.applied} applied, ${final.length - toWrite.length} staged`));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
