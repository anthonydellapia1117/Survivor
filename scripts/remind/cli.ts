// npm run remind -- [--week N --slot wed|thu|fri] [--send] [--dry-run] [--yes]
//
// The week reminder: one message, To the admin's mailbox and Bcc every address
// on the live roster, on the morning of one of a week's THREE slots (Anthony,
// 2026-09-10) - Wednesday naming the early boundary, Thursday naming the late
// one, Friday the FINAL CALL naming that same late one. Everything is derived
// on the run - the slot from the weeks table and the ET calendar, the
// recipients from the live roster, the text from the week's games and
// deadlines - and the recipient count must equal EXPECTED_ROSTER_ADDRESSES
// exactly or the run stops with the list and the delta printed. Nothing is
// ever sent except through sendWeekReminder, which needs --send AND
// REMINDER_AUTOSEND=true and refuses a second send for the same SLOT.
//
//   npm run remind                           the slot due today, as one Bcc draft (nothing due: says so and exits)
//   npm run remind -- --week 2 --slot fri    a named slot, for a hand run
//   npm run remind -- --send --yes           send instead of draft (REMINDER_AUTOSEND=true only); the Routine's form
//   --dry-run prints the message and stops. --yes skips the y/N prompt.

import { adminClient, loadGames, loadLiveEntries, loadOwners, loadWeeks } from "../lib/db";
import { ADMIN_MAILBOX, EXPECTED_ROSTER_ADDRESSES } from "../lib/constants";
import { createDraft, gmailClient } from "../lib/gmail";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { confirm } from "../lib/prompt";
import { autosendEnabled, sendWeekReminder } from "../lib/send";
import { formatEt, type GameLite, type WeekBounds } from "../picks/lib/deadline";
import { dueSlot, findSlot, isSlotName, slotKey, SLOT_NAMES, type ReminderSlot, type SlotName } from "./lib/due";
import { reminderBody, reminderSubject } from "./lib/message";
import { countGate, reminderAddresses } from "./lib/recipients";

interface Args {
  week: number | null;
  slot: SlotName | null;
  send: boolean;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { week: null, slot: null, send: false, dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") {
      a.week = Number(argv[++i]);
      if (!Number.isInteger(a.week) || a.week < 1 || a.week > 18) throw new Error("--week must be 1-18");
    } else if (x === "--slot") {
      const v = argv[++i] ?? "";
      if (!isSlotName(v)) throw new Error(`--slot must be one of ${SLOT_NAMES.join(", ")}`);
      a.slot = v;
    } else if (x === "--send") a.send = true;
    else if (x === "--dry-run") a.dryRun = true;
    else if (x === "--yes") a.yes = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  if ((a.week === null) !== (a.slot === null)) throw new Error("--week and --slot go together.");
  return a;
}

function summary(line: string): string {
  return finishedLine("remind", line);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // The send gate is checked before anything signs in anywhere.
  if (args.send && !autosendEnabled()) {
    throw new Error("REMINDER_AUTOSEND is not true: drafts only.");
  }

  const { client, actor } = await adminClient();
  const [owners, entries, weeks] = await Promise.all([loadOwners(client), loadLiveEntries(client), loadWeeks(client)]);
  const now = new Date();

  // ---- which slot: the weeks table and the ET calendar, or a named one
  let b: ReminderSlot | null;
  if (args.week !== null && args.slot !== null) {
    b = findSlot(weeks, args.week, args.slot);
    if (!b) throw new Error(`Week ${args.week} has no ${args.slot} slot: the boundary it names is not in the weeks table.`);
    if (new Date(b.deadlineIso).getTime() <= now.getTime()) {
      throw new Error(`Week ${args.week} ${args.slot} names the ${b.kind} deadline ${formatEt(b.deadlineIso)}, which has passed. Nothing to remind about.`);
    }
  } else {
    b = dueSlot(weeks, now);
    if (!b) {
      console.log("Nothing due: no reminder slot sends today, or today's has already closed.");
      await notify(summary("nothing due"));
      return;
    }
  }
  const key = slotKey(b);
  console.log(`${key}: the ${b.slot} reminder, naming the ${b.kind} deadline ${formatEt(b.deadlineIso)}.`);

  // ---- who: derived live, then the exact count gate
  const bcc = reminderAddresses(owners, entries);
  const gate = countGate(EXPECTED_ROSTER_ADDRESSES, bcc);
  for (const line of gate.lines) console.log(line);
  if (!gate.ok) {
    await notify(
      needsAnthonyLine("remind", "count gate", `${gate.actual} recipients derived, ${gate.expected} expected (${gate.delta > 0 ? "+" : ""}${gate.delta}) - nothing drafted or sent - the list is on the terminal`),
      { tags: "warning" },
    );
    throw new Error(`Count gate: ${gate.actual} recipients, ${gate.expected} expected. Stopped.`);
  }

  // ---- what: the week's deadlines, judged on this clock
  const weekRow = weeks.find((w) => w.week === b.week);
  if (!weekRow) throw new Error(`Week ${b.week} not found.`);
  const bounds: WeekBounds = { week: b.week, earlyDeadlineAt: weekRow.early_deadline_at, lateDeadlineAt: weekRow.late_deadline_at };
  const games: GameLite[] = (await loadGames(client, b.week)).map((g) => ({ week: g.week, dayOfWeek: g.day_of_week, homeTeam: g.home_team, awayTeam: g.away_team }));
  const subject = reminderSubject(b, now);
  const body = reminderBody(b, bounds, games, now);

  console.log(`\nTo: ${ADMIN_MAILBOX}\nBcc: ${bcc.length} recipients\nSubject: ${subject}\n\n${body}\n`);

  if (args.dryRun) {
    console.log("Dry run. Nothing created.");
    return;
  }

  // ---- send: only through sendWeekReminder, once per slot
  if (args.send) {
    if (!args.yes && !(await confirm(`\nSend to ${bcc.length} recipients? (y/N) `))) {
      console.log("Not approved. Nothing sent.");
      await notify(summary("not approved, nothing sent"));
      return;
    }
    const out = await sendWeekReminder(gmailClient(), client, {
      template: "week_reminder",
      to: ADMIN_MAILBOX,
      bcc,
      subject,
      body,
      week: b.week,
      boundary: b.kind,
      slot: b.slot,
      deadlineIso: b.deadlineIso,
      expectedRecipients: EXPECTED_ROSTER_ADDRESSES,
      actor,
    });
    if (out.kind === "sent") {
      console.log(`sent ${out.messageId} -> ${bcc.length} recipients on Bcc (${key}, audit ${out.auditId})`);
      await notify(summary(`${key} sent to ${bcc.length} recipients`));
    } else {
      const what = out.prior.messageId ? `already sent ${out.prior.messageId}` : "already claimed (outcome on /admin/audit)";
      console.log(`${what} for ${key} at ${out.prior.at}, skipped`);
      await notify(summary(`${key} already sent, skipped`));
    }
    return;
  }

  // ---- draft: one Bcc draft to the admin's own mailbox
  if (!args.yes && !(await confirm(`\nCreate 1 Bcc draft to ${bcc.length} recipients? (y/N) `))) {
    console.log("Not approved. Nothing created.");
    await notify(summary("not approved, nothing created"));
    return;
  }
  const d = await createDraft(gmailClient(), { to: [ADMIN_MAILBOX], bcc, subject, body });
  console.log(`draft ${d.draftId} -> ${ADMIN_MAILBOX}, ${bcc.length} recipients on Bcc`);
  console.log("Not sent: open Gmail, check it, and send it yourself.");
  await notify(summary(`1 bcc draft created for ${bcc.length} recipients (${key})`));
}

main().catch(async (e: unknown) => {
  const why = e instanceof Error ? e.message : String(e);
  console.error(why);
  process.exitCode = 1;
});
