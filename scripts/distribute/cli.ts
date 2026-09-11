// npm run distribute -- --week N [--dry-run] [--yes]
//
// After a week locks, drafts the one group message that says the picks are
// posted: a link to the grid and the dashboard's standings sentence, BCC to
// every owner and to every person who plays a gifted entry. It creates
// exactly one Gmail draft and never sends: Anthony opens it, checks it and
// sends it himself. Before the week's late deadline it refuses and creates
// nothing.
//
//   --week N      required
//   --dry-run     print the message and the count, create no draft
//   --yes         skip the confirmation prompt
//   --again       draft this week again, after one has already been drafted

import { groupSendList } from "@/lib/emails/group-send";
import { EXPECTED_ROSTER_ADDRESSES, SITE_URL } from "../lib/constants";
import { adminClient, loadAuditByAction, loadLiveEntries, loadOwners, loadStandings, loadWeeks, recordAudit } from "../lib/db";
import { createDraft, gmailClient, profileAddress } from "../lib/gmail";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { countGate } from "../remind/lib/recipients";
import { confirm } from "../lib/prompt";
import { confirmedOwners } from "../lib/roster";
import { formatEt, type WeekBounds } from "../picks/lib/deadline";
import { DRAFTED_ACTION, DRAFT_CLAIM_ACTION, priorDraftFor } from "./lib/drafted";
import { refusalBeforeLock } from "./lib/lock";
import { distributeMessage } from "./lib/message";
import { buildGroupSendOwners } from "./lib/recipients";
import { countStandings, type StandingInput } from "./lib/standings";

interface Args {
  week: number;
  dryRun: boolean;
  yes: boolean;
  /** Draft again for a week that already has one: Anthony deleting a draft and redoing it. */
  again: boolean;
}

function parseArgs(argv: string[]): Args {
  let week: number | null = null;
  let dryRun = false;
  let yes = false;
  let again = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") week = Number(argv[++i]);
    else if (x === "--dry-run") dryRun = true;
    else if (x === "--yes") yes = true;
    else if (x === "--again") again = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  if (week === null || !Number.isInteger(week)) throw new Error("--week N is required");
  return { week, dryRun, yes, again };
}

async function main(): Promise<void> {
  const { week, dryRun, yes, again } = parseArgs(process.argv.slice(2));
  // The token check is local and instant; do it before asking for a password.
  const gmail = gmailClient();
  const { client, actor } = await adminClient();

  // ---- refuse before the lock
  const weeks = await loadWeeks(client);
  const row = weeks.find((w) => w.week === week);
  if (!row) throw new Error(`Week ${week} is not in the weeks table.`);
  const bounds: WeekBounds = {
    week: row.week,
    earlyDeadlineAt: row.early_deadline_at,
    lateDeadlineAt: row.late_deadline_at,
  };
  const refusal = refusalBeforeLock(bounds, new Date());
  if (refusal !== null) {
    console.log(refusal);
    process.exitCode = 1;
    return;
  }

  // ---- already drafted for this week?
  // The guard exists to stop a second tick, or a hand run beside a scheduled
  // one, leaving two whole-roster Bcc drafts in Gmail (issue #40). It must not
  // stop the two things a person legitimately does: read the preview, and
  // deliberately draft again after deleting the first. A dry run creates
  // nothing, so it is never blocked; --again is the deliberate redraft, and it
  // records its own row like any other.
  const [claims, drafted] = await Promise.all([
    loadAuditByAction(client, DRAFT_CLAIM_ACTION),
    loadAuditByAction(client, DRAFTED_ACTION),
  ]);
  // Drafted first, so a completed draft is found before the claim that
  // preceded it; a claim with no drafted row still counts on its own.
  const prior = priorDraftFor([...drafted, ...claims], week);
  if (prior && !dryRun && !again) {
    console.log(`Already drafted for week ${week} at ${prior.at}; nothing to do. Pass --again to draft it again.`);
    await notify(finishedLine("distribute", `week ${week}: already drafted, skipped`));
    return;
  }
  if (prior) console.log(`Note: week ${week} was already drafted at ${prior.at}.${dryRun ? "" : " Drafting again (--again)."}`);

  const [owners, entries, standings] = await Promise.all([
    loadOwners(client),
    loadLiveEntries(client),
    loadStandings(client),
  ]);

  // ---- recipients: groupSendList decides, this only feeds it the roster
  const list = groupSendList(buildGroupSendOwners(owners, entries), { includeGiftedPlayers: true });
  const k = list.addresses.length;
  console.log(`Recipients: ${k} addresses.`);
  // The exact count gate every whole-roster message keeps: not a range.
  const gate = countGate(EXPECTED_ROSTER_ADDRESSES, list.addresses);
  for (const line of gate.lines) console.log(line);
  if (!gate.ok) {
    await notify(needsAnthonyLine("distribute", "count gate", `${gate.actual} recipients derived, ${gate.expected} expected (${gate.delta > 0 ? "+" : ""}${gate.delta}) - nothing drafted - the list is on the terminal`), { tags: "warning" });
    throw new Error(`Count gate: ${gate.actual} recipients, ${gate.expected} expected. Stopped.`);
  }
  for (const o of list.missingEmail) {
    const line = needsAnthonyLine(
      "distribute",
      "missing email",
      `${o.name} - no address on file, misses the send. ${SITE_URL}/admin/owners`,
    );
    console.log(line);
    await notify(line, { tags: "warning" });
  }
  for (const d of list.duplicates) {
    console.log(`note: ${d.address} is on more than one row (also ${d.ownerName}); listed once.`);
  }

  // ---- standings: live entries of confirmed owners, bucketed as the dashboard does
  const confirmedIds = new Set(confirmedOwners(owners).map((o) => o.id));
  const byEntry = new Map(standings.map((s) => [s.entry_id, s]));
  const rows: StandingInput[] = [];
  const missing: string[] = [];
  for (const e of entries) {
    if (e.voided_at !== null || !confirmedIds.has(e.owner_id)) continue;
    const s = byEntry.get(e.id);
    if (!s) {
      missing.push(e.entry_name);
      continue;
    }
    rows.push({ status: s.status, losses: s.losses, byeUsed: s.bye_used });
  }
  if (missing.length) {
    throw new Error(
      `${missing.length} live entries have no standings row in v_entry_public (${missing.join(", ")}); the standings line cannot be built.`,
    );
  }

  // ---- the message
  const msg = distributeMessage(week, countStandings(rows));
  console.log(`\nSubject: ${msg.subject}\n`);
  console.log(msg.body);
  console.log(`BCC: ${k} addresses.`);
  if (dryRun) {
    console.log("\nDry run. No draft created.");
    return;
  }
  if (k === 0) throw new Error("No addresses on the list; no draft created.");
  if (!yes) {
    const ok = await confirm(`\nCreate one BCC draft to ${k} addresses? (y/N) `);
    if (!ok) {
      console.log("Not approved. No draft created.");
      return;
    }
  }

  // ---- exactly one draft, never a send
  // Claim first. If the process dies, or the audit insert fails, between here
  // and the drafted row, the claim alone stops every later run from drafting
  // this week again.
  await recordAudit(client, {
    actor,
    action: DRAFT_CLAIM_ACTION,
    targetTable: "gmail",
    targetId: `week:${week}`,
    after: { week, recipient_count: k, subject: msg.subject },
    note: `distribute draft claim for week ${week}; a drafted row follows on success`,
  });
  const { draftId } = await createDraft(gmail, {
    to: [await profileAddress(gmail)],
    bcc: list.addresses,
    subject: msg.subject,
    body: msg.body,
    html: msg.html,
  });
  console.log(`draft ${draftId} created, BCC ${k} addresses. Not sent: open Gmail, check it, send it yourself.`);
  await recordAudit(client, {
    actor,
    action: DRAFTED_ACTION,
    targetTable: "gmail",
    targetId: draftId,
    after: { week, draft_id: draftId, recipient_count: k, subject: msg.subject },
    note: `distribute draft for week ${week} to ${k} addresses on Bcc`,
  });
  await notify(finishedLine("distribute", `week ${week}: draft ${draftId}, ${k} addresses`));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
