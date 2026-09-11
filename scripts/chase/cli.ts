// npm run chase -- --week N [--bcc] [--send] [--dry-run] [--yes]
//
// Finds every live entry with no current pick for the week, works out who is
// asked for each (the same recipient rule as /admin/emails/picks: a giftee
// gets their own message, a gifted entry with no address goes on nobody's),
// and creates one Gmail draft per recipient. The live roster decides who is
// unpicked; Gmail is never consulted for that. Nothing is created until
// Anthony types y, and nothing is ever sent except through sendAllowlisted,
// which needs --send AND REMINDER_AUTOSEND=true and refuses a second message
// to the same recipient on the same lock day.
//
//   npm run chase -- --week 1             one draft per recipient, after y
//   npm run chase -- --week 1 --bcc       one draft, every recipient on Bcc
//   npm run chase -- --week 1 --dry-run   table and the first body; nothing created
//   npm run chase -- --week 1 --send      send instead of draft (REMINDER_AUTOSEND=true only)
//   --yes skips the y/N prompt. --week defaults to the open week.

import type { Recipient } from "@/lib/emails/recipients";
import {
  adminClient,
  currentWeek,
  loadCurrentPicks,
  loadGames,
  loadLiveEntries,
  loadOwners,
  loadStandings,
  loadUsedTeams,
  loadWeeks,
} from "../lib/db";
import { createDraft, gmailClient, profileAddress } from "../lib/gmail";
import { ccFor, deliveryAddressesFor, expandDelivery } from "@/lib/emails/recipient-exceptions";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { confirm } from "../lib/prompt";
import { splitRecipients, unpickedEntries, type OpenDeadline, entriesOfConfirmedOwners } from "../lib/roster";
import { autosendEnabled, priorSends, sendAllowlisted } from "../lib/send";
import { formatEt, type GameLite, type WeekBounds } from "../picks/lib/deadline";
import {
  bccBody,
  buildChase,
  chaseSubject,
  dedupeAddresses,
  earliestOf,
  mergeTiers,
  openTiers,
  recipientBody,
  reconcile,
  weekLine,
  type Tier, entryNotesFor } from "./lib/message";

interface Args {
  week: number | null;
  bcc: boolean;
  send: boolean;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { week: null, bcc: false, send: false, dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") {
      a.week = Number(argv[++i]);
      if (!Number.isInteger(a.week) || a.week < 1) throw new Error("--week must be a whole number from 1 up");
    } else if (x === "--bcc") a.bcc = true;
    else if (x === "--send") a.send = true;
    else if (x === "--dry-run") a.dryRun = true;
    else if (x === "--yes") a.yes = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  return a;
}

interface Chase {
  recipient: Recipient;
  /** The earliest open deadline across this person's entries: the lock day a send is keyed on. */
  deadline: OpenDeadline;
  tiers: Tier[];
  subject: string;
  body: string;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printTable(chases: Chase[]): void {
  const header = `${pad("recipient", 34)} ${pad("kind", 7)} ${pad("entries", 8)} ${pad("deadline", 24)} names`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const c of chases) {
    const names = c.recipient.entries.map((e) => e.entryName).join(" | ");
    console.log(
      `${pad(c.recipient.email, 34)} ${pad(c.recipient.kind, 7)} ${pad(String(c.recipient.entries.length), 8)} ${pad(formatEt(c.deadline.deadlineIso), 24)} ${names}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // The send gate is checked before anything signs in anywhere: a run that
  // cannot send should not have touched Gmail or the database to find out.
  if (args.send && !autosendEnabled()) {
    throw new Error("REMINDER_AUTOSEND is not true: drafts only.");
  }
  if (args.send && args.bcc) {
    throw new Error("--send with --bcc is refused: once per recipient per lock day cannot be kept on a Bcc. Drop one of them.");
  }

  const { client, actor } = await adminClient();
  const [owners, entries, weeks, standings] = await Promise.all([
    loadOwners(client),
    loadLiveEntries(client),
    loadWeeks(client),
    loadStandings(client),
  ]);
  const now = new Date();
  const week = args.week ?? currentWeek(weeks, now);
  if (week === null) throw new Error("No open week; pass --week N.");
  const weekRow = weeks.find((w) => w.week === week);
  if (!weekRow) throw new Error(`Week ${week} not found.`);
  const bounds: WeekBounds = { week, earlyDeadlineAt: weekRow.early_deadline_at, lateDeadlineAt: weekRow.late_deadline_at };
  const [gameRows, current, used] = await Promise.all([
    loadGames(client, week),
    loadCurrentPicks(client, week),
    loadUsedTeams(client, week),
  ]);
  const games: GameLite[] = gameRows.map((g) => ({ week: g.week, dayOfWeek: g.day_of_week, homeTeam: g.home_team, awayTeam: g.away_team }));

  // ---- who has no pick: the live roster, never Gmail
  const unpicked = unpickedEntries(entriesOfConfirmedOwners(owners, entries), current.map((p) => p.entry_id), standings);
  const unpickedIds = new Set(unpicked.map((e) => e.id));
  console.log(`Week ${week}: ${unpicked.length} live entr${unpicked.length === 1 ? "y" : "ies"} with no pick.`);

  const split = splitRecipients(owners, entries, (e) => unpickedIds.has(e.id));
  for (const o of split.ownersWithoutEmail) {
    const line = needsAnthonyLine(
      "chase",
      "owner with no email",
      `${o.name} - ${o.entryCount} unpicked entr${o.entryCount === 1 ? "y" : "ies"} (${o.entryNames.join(" | ")}) - nobody can be mailed - /admin/entries`,
    );
    console.log(line);
    await notify(line, { tags: "warning" });
  }
  for (const g of split.giftedWithoutEmail) {
    const line = needsAnthonyLine(
      "chase",
      "gifted entry with no address",
      `${g.entryName} (bought by ${g.ownerName}) - gifted, no player_email, on nobody's message - /admin/entries`,
    );
    console.log(line);
    await notify(line, { tags: "warning" });
  }

  // ---- reconcile before anything is created
  const mailable = split.recipients.reduce((n, r) => n + r.entries.length, 0);
  const check = reconcile({
    liveUnpicked: unpicked.length,
    mailable,
    ownersWithoutEmail: split.ownersWithoutEmail.reduce((n, o) => n + o.entryCount, 0),
    giftedWithoutEmail: split.giftedWithoutEmail.length,
  });
  if (!check.ok) {
    console.log("\nThe recipients do not account for every unpicked entry:");
    for (const l of check.lines) console.log(`  ${l}`);
    const confirmed = new Set(owners.filter((o) => o.participation_status === "confirmed").map((o) => o.id));
    const stray = unpicked.filter((e) => !confirmed.has(e.owner_id));
    if (stray.length) {
      console.log("  unpicked entries whose owner is missing or not confirmed:");
      for (const e of stray) console.log(`    ${e.entry_name} (owner ${e.owner_id})`);
    }
    throw new Error("Reconcile failed; nothing created.");
  }
  console.log(weekLine(week, split.recipients.length, mailable, check.unmailable));

  if (split.recipients.length === 0) {
    console.log("Nobody to chase; nothing created.");
    await notify(finishedLine("chase", `week ${week}: 0 recipients, 0 entries, nothing to chase`));
    return;
  }

  // On a mixed message (owned and gifted entries on one person) each gifted
  // entry names its buyer, so the reader sees which is which. Owner-only and
  // player-only messages carry no note: nothing there is ambiguous.
  const ownerNameById = new Map(owners.map((o) => [o.id, `${o.first_name} ${o.last_name}`.trim()]));
  const buyerByEntryId = new Map(entries.map((e) => [e.id, ownerNameById.get(e.owner_id) ?? ""]));
  const giftedNotes = (r: Recipient): Record<string, string> | undefined => entryNotesFor(r, buyerByEntryId);

  // ---- deadlines per recipient
  const chases: Chase[] = [];
  const closed: Recipient[] = [];
  for (const r of split.recipients) {
    const built = buildChase(r, { week, games, bounds, now, usedByEntry: used, notes: giftedNotes(r) });
    if (!built) {
      closed.push(r);
      continue;
    }
    chases.push({ recipient: r, ...built });
  }
  if (chases.length === 0) {
    console.log(`Week ${week} is locked; nothing to chase`);
    await notify(finishedLine("chase", `week ${week}: ${split.recipients.length} recipients, ${mailable} entries, week locked, nothing created`));
    return;
  }
  for (const r of closed) {
    console.log(`${r.email}: every deadline has passed for their entries; skipped.`);
  }

  console.log("");
  printTable(chases);
  const k = chases.length;
  const m = chases.reduce((n, c) => n + c.recipient.entries.length, 0);
  const summary = (what: string) => finishedLine("chase", `week ${week}: ${k} recipients, ${m} entries, ${what}`);

  // ---- dry run: show the first message and stop
  if (args.dryRun) {
    console.log(`\nSubject: ${chases[0].subject}\n`);
    console.log(chases[0].body);
    console.log("Dry run. Nothing created.");
    await notify(summary("dry run, nothing created"));
    return;
  }

  // ---- send: only through sendAllowlisted, once per recipient per lock day
  if (args.send) {
    const gmail = gmailClient();
    const prior = await priorSends(client);
    if (!args.yes && !(await confirm(`\nSend ${k} messages? (y/N) `))) {
      console.log("Not approved. Nothing sent.");
      await notify(summary("not approved, nothing sent"));
      return;
    }
    let sent = 0;
    let skipped = 0;
    for (const c of chases) {
      // A pick can land between the snapshot and this person's turn (a long
      // run, a y typed late). Re-read the week's current picks now; if any
      // of their entries is picked, this message is stale and is not sent.
      const nowPicked = new Set((await loadCurrentPicks(client, week)).map((p) => p.entry_id));
      const arrived = c.recipient.entries.filter((e) => nowPicked.has(e.id)).map((e) => e.entryName);
      if (arrived.length) {
        skipped++;
        console.log(`pick arrived since the snapshot for ${arrived.join(", ")} -> ${c.recipient.email}, skipped; re-run to chase the rest`);
        continue;
      }
      // The deadlines are judged again on a fresh clock right before the
      // send: a run that started before a lock and was carried past it by
      // the prompt or by earlier recipients must not mail a reminder for
      // choices that have closed, and must not claim the lock day for it.
      const fresh = buildChase(c.recipient, { week, games, bounds, now: new Date(), usedByEntry: used, notes: giftedNotes(c.recipient) });
      if (!fresh) {
        skipped++;
        console.log(`every deadline has passed since the snapshot -> ${c.recipient.email}, skipped, nothing claimed`);
        continue;
      }
      let out;
      try {
        out = await sendAllowlisted(gmail, client, prior, {
          template: "pick_reminder",
          to: c.recipient.email,
          subject: fresh.subject,
          body: fresh.body,
          week,
          deadlineIso: fresh.deadline.deadlineIso,
          entryNames: c.recipient.entries.map((e) => e.entryName),
          actor,
        });
      } catch (e: unknown) {
        // A send whose sent row failed, or a Gmail refusal after the claim,
        // is surfaced before the run stops. The push carries no address and
        // no error text (an address is roster data and stays off the push
        // service); the recipient and the error are on the terminal and the
        // claim row is on /admin/audit.
        const why = e instanceof Error ? e.message : String(e);
        console.log(`FAILED -> ${c.recipient.email}: ${why}`);
        await notify(needsAnthonyLine("chase", "send failed", `${sent} sent before it - run stopped - the recipient and the error are on the terminal and /admin/audit`), { tags: "warning" });
        throw e;
      }
      if (out.kind === "sent") {
        sent++;
        console.log(`sent ${out.messageId} -> ${c.recipient.email}`);
      } else {
        skipped++;
        const what = out.prior.messageId ? `already sent ${out.prior.messageId}` : "already claimed (outcome on /admin/audit)";
        console.log(`${what} on lock day ${out.lockDay} -> ${c.recipient.email}, skipped`);
      }
    }
    console.log(`\nDone. ${sent} sent, ${skipped} skipped.`);
    await notify(summary(`${sent} sent, ${skipped} already sent and skipped`));
    return;
  }

  // ---- bcc: one draft to Anthony's own mailbox, everyone on Bcc
  if (args.bcc) {
    // One line per PERSON first, then expanded to mailboxes: this branch
    // never goes through the per-recipient seam below, so without the
    // expansion a multi-address person would get only the one uncertain
    // roster address on the aggregate draft. Same order as every other
    // whole-roster message - people are what is counted, addresses are what
    // is addressed (src/lib/emails/recipient-exceptions.ts).
    const people = dedupeAddresses(chases.map((c) => c.recipient.email));
    const bcc = expandDelivery(people);
    const earliest = earliestOf(chases.map((c) => c.deadline));
    if (!earliest) throw new Error("No open deadline for the Bcc draft.");
    const body = bccBody({
      week,
      entryCounts: chases.map((c) => c.recipient.entries.length),
      tiers: mergeTiers(chases.map((c) => c.tiers)),
      lateDeadlineIso: bounds.lateDeadlineAt,
    });
    if (!args.yes && !(await confirm(`\nCreate 1 Bcc draft to ${people.length} recipients on ${bcc.length} addresses? (y/N) `))) {
      console.log("Not approved. Nothing created.");
      await notify(summary("not approved, nothing created"));
      return;
    }
    const gmail = gmailClient();
    const me = await profileAddress(gmail);
    const d = await createDraft(gmail, { to: [me], bcc, subject: chaseSubject(week), body });
    console.log(`draft ${d.draftId} -> ${me}, ${people.length} recipients on ${bcc.length} addresses, earliest deadline ${formatEt(earliest.deadlineIso)}`);
    console.log("Not sent: open Gmail, check it, and send it yourself.");
    await notify(summary(`1 bcc draft created for ${people.length} recipients on ${bcc.length} addresses`));
    return;
  }

  // ---- default: one draft per recipient
  if (!args.yes && !(await confirm(`\nCreate ${k} drafts? (y/N) `))) {
    console.log("Not approved. Nothing created.");
    await notify(summary("not approved, nothing created"));
    return;
  }
  const gmail = gmailClient();
  let created = 0;
  for (const c of chases) {
    const d = await createDraft(gmail, {
      to: deliveryAddressesFor(c.recipient.email),
      cc: ccFor(c.recipient.email),
      subject: c.subject,
      body: c.body,
    });
    created++;
    console.log(`draft ${d.draftId} -> ${c.recipient.email} (${c.recipient.entries.length} entries)`);
  }
  console.log(`\nDone. ${created} drafts created. Not sent: open Gmail, check them, and send them yourself.`);
  await notify(summary(`${created} drafts created`));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
