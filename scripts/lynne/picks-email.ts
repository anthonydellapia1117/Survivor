// npm run lynne:picks -- --message-id <gmail id> [--week N] [--dry-run] [--yes]
// npm run lynne:picks -- --find [--week N] [--dry-run] [--yes]
//
// Shape B of her pick publishing: a plain-text email with no attachment,
// naming a team and then the NO.s taking it. It reads the message (the whole
// thread, so a correction she sent as a reply is not missed), maps her team
// words to this app's codes, and writes what she stated into her own week
// cells through admin_apply_lynne_email_cells.
//
// It never writes to `picks`. `picks` is this group's record of what its own
// 121 chose; this is her statement about her whole pool. Where the two meet -
// one of our 121 at a NO. she named - the difference is REPORTED with both
// values and that row is left alone. Neither side is corrected.
//
// Four things it refuses to do:
//   * guess a team. A heading that maps to no team in her vocabulary, or to
//     more than one, stops the run and is printed.
//   * match on a name. Her NO. is the key; the name is carried for the report.
//   * fill a silence. A NO. she did not name gets nothing and is not out.
//   * write twice. A second run on the same message writes nothing at all,
//     guarded by an audit row rather than by anything this file remembers.

import { adminClient, loadWeeks } from "../lib/db";
import { weekForMessage } from "../ops/lib/weeks";
import { LYNNE_EMAIL } from "../lib/constants";
import { getMessageFull, getThreadFull, gmailClient, searchMessages } from "../lib/gmail";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { confirm } from "../lib/prompt";
import { conflictingNos, parsePickEmail, type LynnePickLine } from "@/lib/lynne/pick-email";

interface Args {
  messageId: string | null;
  find: boolean;
  week: number | null;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  let messageId: string | null = null;
  let find = false;
  let week: number | null = null;
  let dryRun = false;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--message-id") messageId = argv[++i] ?? null;
    else if (x === "--find") find = true;
    else if (x === "--week") week = Number(argv[++i]);
    else if (x === "--dry-run") dryRun = true;
    else if (x === "--yes") yes = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  if (!messageId && !find) throw new Error("--message-id <gmail id>, or --find to take her newest pick email");
  if (messageId && find) throw new Error("--message-id and --find name the message two different ways; give one");
  if (week !== null && (!Number.isInteger(week) || week < 1 || week > 18)) throw new Error("--week must be 1-18");
  return { messageId, find, week, dryRun, yes };
}

interface ApplyResult {
  already_applied: boolean;
  written: number;
  sheet_sha256?: string;
  applied: { no: number; week: number; team: string; abbr: string; key: string }[];
  unchanged: { no: number; week: number; team: string }[];
  unmatched: { no: number; week: number; team: string }[];
  variance: Record<string, unknown>[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gmail = gmailClient();

  let messageId = args.messageId;
  if (args.find) {
    // Her mail, no attachment, newest first. Named rather than guessed at: the
    // caller still sees which message was taken before anything is written.
    const refs = await searchMessages(gmail, `from:${LYNNE_EMAIL} -has:attachment`, 25);
    if (refs.length === 0) throw new Error(`No message from ${LYNNE_EMAIL} without an attachment. Nothing to read.`);
    messageId = refs[0].id;
  }
  if (!messageId) throw new Error("no message id");

  const message = await getMessageFull(gmail, messageId);
  console.log(`Message:    ${message.id}`);
  console.log(`From:       ${message.from}`);
  console.log(`Subject:    ${JSON.stringify(message.subject)}`);
  console.log(`Received:   ${message.receivedAt}`);

  // The whole thread, per CLAUDE.md: a correction of hers arrives as a reply,
  // and a search preview would not show it. Later messages are only reported
  // here - each is applied by its own run, under its own message id, so the
  // idempotence guard stays one row per message.
  const thread = await getThreadFull(gmail, message.threadId);
  const later = thread.filter((m) => new Date(m.receivedAt).getTime() > new Date(message.receivedAt).getTime());
  if (later.length) {
    console.log(`\nThe thread carries ${later.length} later message(s). This run applies only ${message.id}; each of these needs its own run:`);
    for (const m of later) console.log(`  ${m.id}  ${m.receivedAt}  ${JSON.stringify(m.subject)}`);
  }

  const parsed = parsePickEmail(message.body);

  // A word that does not map exactly stops the run, before anything is read
  // from the database and long before anything is written.
  if (parsed.unmapped.length || parsed.orphans.length) {
    console.error("\nStopped. Nothing written.");
    for (const u of parsed.unmapped) {
      console.error(`  line ${u.line}: ${JSON.stringify(u.text)} - ${u.reason}`);
    }
    for (const o of parsed.orphans) {
      console.error(`  line ${o.line}: ${JSON.stringify(o.text)} - an entry line under no heading`);
    }
    await notify(needsAnthonyLine("lynne:picks", "an unreadable heading", `${message.id}: ${parsed.unmapped.map((u) => JSON.stringify(u.text)).join("; ") || "entry lines under no heading"}`), { tags: "warning" });
    process.exitCode = 1;
    return;
  }
  if (parsed.picks.length === 0) {
    console.log("\nShe names no NO. in this message. Nothing to write.");
    await notify(finishedLine("lynne:picks", `${message.id} names no entry, nothing written`));
    return;
  }

  const clashes = conflictingNos(parsed.picks);
  if (clashes.length) {
    console.error("\nStopped. Nothing written. She states a NO. under two teams; that is hers to settle:");
    for (const c of clashes) console.error(`  #${c.no}: ${c.teams.join(" and ")}`);
    await notify(needsAnthonyLine("lynne:picks", "a NO. stated twice", `${message.id}: ${clashes.map((c) => `#${c.no} ${c.teams.join("/")}`).join(", ")}`), { tags: "warning" });
    process.exitCode = 1;
    return;
  }

  const { client, actor } = await adminClient();
  const weeks = await loadWeeks(client);
  const derived = weekForMessage(weeks, message.receivedAt);
  const week = args.week ?? derived;
  if (week === null) {
    throw new Error("No week's late deadline falls at or after this message; name one with --week.");
  }
  console.log(`Week:       ${week}${args.week !== null ? ` (given; derived ${derived ?? "none"})` : " (derived from the weeks table)"}`);

  const byTeam = new Map<string, LynnePickLine[]>();
  for (const p of parsed.picks) byTeam.set(p.teamAbbr, [...(byTeam.get(p.teamAbbr) ?? []), p]);
  console.log(`\nShe states ${parsed.picks.length} entr${parsed.picks.length === 1 ? "y" : "ies"} across ${byTeam.size} team(s):`);
  for (const [abbr, rows] of [...byTeam].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${abbr} (${JSON.stringify(rows[0].teamText)}): ${rows.map((r) => r.no).join(", ")}`);
  }
  console.log("Her list is partial by rule: a NO. she does not name has no pick recorded here and is not eliminated.");

  if (args.dryRun) {
    console.log("\nDry run. Nothing written.");
    await notify(finishedLine("lynne:picks", `${message.id} dry run, ${parsed.picks.length} stated, nothing written`));
    return;
  }
  if (!args.yes && !(await confirm(`\nWrite ${parsed.picks.length} of her week ${week} cells from ${message.id}? (y/N) `))) {
    console.log("Not approved. Nothing written.");
    await notify(finishedLine("lynne:picks", `${message.id} not approved, nothing written`));
    return;
  }

  const { data, error } = await client.rpc("admin_apply_lynne_email_cells", {
    p_gmail_message_id: message.id,
    p_rows: parsed.picks.map((p) => ({ no: p.no, week, team_text: p.teamText, team_abbr: p.teamAbbr })),
    p_actor: actor,
  });
  if (error) throw new Error(`admin_apply_lynne_email_cells: ${error.message}`);
  const res = data as ApplyResult;

  if (res.already_applied) {
    console.log(`\nMessage ${message.id} was applied before. Nothing written.`);
    await notify(finishedLine("lynne:picks", `${message.id} already applied, nothing written`));
    return;
  }

  console.log(`\nWrote ${res.written} cell(s) onto her sheet ${res.sheet_sha256?.slice(0, 12)}.`);
  if (res.unchanged.length) {
    console.log(`Already read the same on her sheet (${res.unchanged.length}): ${res.unchanged.map((u) => `#${u.no} ${u.team}`).join(", ")}`);
  }
  if (res.unmatched.length) {
    console.log(`Not on her newest sheet, reported and never invented (${res.unmatched.length}): ${res.unmatched.map((u) => `#${u.no}`).join(", ")}`);
  }
  if (res.variance.length) {
    console.log(`\nVARIANCES (${res.variance.length}) - each row is left alone, neither side corrected:`);
    for (const v of res.variance) {
      if (v.kind === "her email differs from our pick") {
        console.log(`  #${v.no} week ${v.week}: ours ${v.ours} (${v.entry}) / hers ${v.hers} [${v.hers_abbr}]`);
      } else {
        console.log(`  #${v.no} week ${v.week}: her sheet ${JSON.stringify(v.stored)} / her email ${JSON.stringify(v.stated)}`);
      }
    }
    await notify(needsAnthonyLine("lynne:picks", "a variance against her list", `${res.variance.length} row(s) on week ${week} from ${message.id}; nothing was changed on either side`), { tags: "warning" });
  }
  console.log("\nNothing was written to picks. Her data lives in her own rows.");
  await notify(finishedLine("lynne:picks", `${message.id}: ${res.written} of her week ${week} cells written, ${res.variance.length} variance(s), 0 picks touched`));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
