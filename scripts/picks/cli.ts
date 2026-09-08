// npm run picks
//
// Reads every unread message from a known player address, or a pasted block
// of text, turns each line into a proposed pick, shows the table, and writes
// nothing until Anthony types y. Writes go through admin_submit_pick with the
// source the pick arrived by; what cannot be resolved is staged for him in
// pending_actions with the message id, never dropped and never guessed.
//
//   npm run picks                       scan Gmail (source email)
//   npm run picks -- --paste            read picks from stdin (source text)
//   npm run picks -- --file picks.txt   read picks from a file (source text)
//   options: --week N  --from <email or name>  --source text|email
//            --dry-run  --keep-unread
//
// The week a message names in its subject or first lines is the week it is
// recorded in; --week (then the open week) is only the fallback. A mail's
// Gmail receipt time is the pick's time, for the LATE column and for the
// RPC, so a reply that beat its deadline stays on time however long it
// waited. A known sender may pick only for entries they own or play;
// anything else they name is staged, never written.

import fs from "node:fs";
import {
  adminClient,
  currentWeek,
  loadCurrentPicks,
  loadGames,
  loadLiveEntries,
  loadOwners,
  loadWeeks,
  stagePending,
  submitPick,
  type CurrentPickRow,
} from "../lib/db";
import { gmailClient, listUnreadFrom, markProcessed, type InboundMessage } from "../lib/gmail";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { confirm, readStdin } from "../lib/prompt";
import { deadlineFor, formatEt, isLate, type GameLite, type WeekBounds } from "./lib/deadline";
import {
  effectiveSubmitTime,
  leadingLines,
  parsePickLines,
  pendingKind,
  pickSourceFor,
  resolveEntry,
  scopeCheck,
  stripQuotedReply,
  weekNamedIn,
  type RosterEntry,
} from "./lib/resolve";

const DONE_LABEL = "Pool-Survivor-Done";

interface Args {
  week: number | null;
  paste: boolean;
  file: string | null;
  from: string | null;
  source: "email" | "text" | null;
  dryRun: boolean;
  keepUnread: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { week: null, paste: false, file: null, from: null, source: null, dryRun: false, keepUnread: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--week") a.week = Number(argv[++i]);
    else if (x === "--paste") a.paste = true;
    else if (x === "--file") a.file = argv[++i];
    else if (x === "--from") a.from = argv[++i];
    else if (x === "--source") {
      const s = argv[++i];
      if (s !== "email" && s !== "text") throw new Error("--source must be email or text");
      a.source = s;
    } else if (x === "--dry-run") a.dryRun = true;
    else if (x === "--keep-unread") a.keepUnread = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  return a;
}

interface Item {
  label: string;
  text: string;
  source: "email" | "text";
  senderAddress: string | null;
  messageId: string | null;
  /** The week the message names, else the command's week. */
  week: number;
  /** Gmail receipt time; null for pasted or filed text. */
  receivedAt: string | null;
}

interface Proposal {
  entry: RosterEntry;
  week: number;
  team: string;
  source: "email" | "text";
  deadline: string;
  late: boolean;
  /** The instant the pick counts as made; passed to the RPC when known. */
  submittedAt: string | null;
  existing: CurrentPickRow | null;
  how: string;
  messageId: string | null;
  itemLabel: string;
}

interface WeekContext {
  bounds: WeekBounds;
  games: GameLite[];
  currentByEntry: Map<string, CurrentPickRow>;
}

interface Unresolved {
  kind: "identity" | "player_question";
  reason: string;
  line: string;
  candidates: string[];
  item: Item;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { client, actor } = await adminClient();
  const [owners, entries, weeks] = await Promise.all([loadOwners(client), loadLiveEntries(client), loadWeeks(client)]);
  const now = new Date();
  // The week a message names wins; --week, then the open week, is only the
  // fallback for a message that names none. A Week 1 reply read on Saturday
  // is a late Week 1 pick, never a Week 2 one.
  const fallbackWeek = args.week ?? currentWeek(weeks, now);
  const weekFor = (named: number | null): number => {
    if (named !== null) return named;
    if (fallbackWeek === null) throw new Error("No open week and the message names none; pass --week N.");
    return fallbackWeek;
  };
  const contexts = new Map<number, WeekContext>();
  const contextFor = async (week: number): Promise<WeekContext> => {
    const cached = contexts.get(week);
    if (cached) return cached;
    const bounds = weeks.find((w) => w.week === week);
    if (!bounds) throw new Error(`Week ${week} not found.`);
    const [gameRows, current] = await Promise.all([loadGames(client, week), loadCurrentPicks(client, week)]);
    const ctx: WeekContext = {
      bounds: { week, earlyDeadlineAt: bounds.early_deadline_at, lateDeadlineAt: bounds.late_deadline_at },
      games: gameRows.map((g) => ({ week: g.week, dayOfWeek: g.day_of_week, homeTeam: g.home_team, awayTeam: g.away_team })),
      currentByEntry: new Map(current.map((p) => [p.entry_id, p])),
    };
    contexts.set(week, ctx);
    return ctx;
  };

  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const roster: RosterEntry[] = entries.map((e) => {
    const o = ownerById.get(e.owner_id);
    return {
      id: e.id,
      entryName: e.entry_name,
      ownerId: e.owner_id,
      ownerName: o ? `${o.first_name} ${o.last_name}` : "",
      ownerEmail: o?.email ?? null,
      playerEmail: e.player_email,
    };
  });

  const entriesFor = (address: string): RosterEntry[] => {
    const a = address.toLowerCase();
    return roster.filter(
      (e) => (e.playerEmail ? e.playerEmail.toLowerCase() === a : (e.ownerEmail ?? "").toLowerCase() === a),
    );
  };

  // ---- gather
  const items: Item[] = [];
  if (args.paste || args.file) {
    const text = args.file ? fs.readFileSync(args.file, "utf8") : await readStdin();
    let sender: string | null = null;
    if (args.from) {
      const needle = args.from.toLowerCase();
      const byEmail = owners.filter((o) => (o.email ?? "").toLowerCase() === needle);
      const byPlayer = entries.filter((e) => (e.player_email ?? "").toLowerCase() === needle);
      if (byEmail.length === 1 || byPlayer.length > 0) sender = needle;
      else {
        const hits = owners.filter(
          (o) =>
            `${o.first_name} ${o.last_name}`.toLowerCase().includes(needle) ||
            (o.email ?? "").toLowerCase().includes(needle) ||
            entries.some((e) => e.owner_id === o.id && e.entry_name.toLowerCase().includes(needle)),
        );
        if (hits.length === 1) sender = hits[0].email?.toLowerCase() ?? null;
        else throw new Error(`--from "${args.from}" matches ${hits.length} owners: ${hits.map((h) => `${h.first_name} ${h.last_name}`).join(", ") || "none"}`);
      }
    }
    items.push({
      label: args.file ?? "pasted text",
      text,
      source: pickSourceFor("paste", args.source),
      senderAddress: sender,
      messageId: null,
      week: weekFor(args.week ?? weekNamedIn(leadingLines(text))),
      receivedAt: null,
    });
  } else {
    if (args.source !== null) {
      throw new Error("--source applies to --paste or --file only; mail read from Gmail is always recorded as email.");
    }
    const gmail = gmailClient();
    const addresses = [
      ...owners.map((o) => o.email ?? ""),
      ...entries.map((e) => e.player_email ?? ""),
    ].filter(Boolean);
    const msgs: InboundMessage[] = await listUnreadFrom(gmail, addresses);
    for (const m of msgs) {
      items.push({
        label: `${m.from} | ${m.subject || "(no subject)"} | ${m.date}`,
        text: m.body,
        source: pickSourceFor("gmail", args.source),
        senderAddress: m.fromAddress,
        messageId: m.id,
        week: weekFor(weekNamedIn(m.subject) ?? weekNamedIn(leadingLines(stripQuotedReply(m.body)))),
        receivedAt: m.receivedAt,
      });
    }
    if (!msgs.length) console.log("No unread mail from any known player address.");
  }

  // ---- resolve
  const proposals: Proposal[] = [];
  const unresolved: Unresolved[] = [];
  for (const item of items) {
    const ctx = await contextFor(item.week);
    const madeAt = effectiveSubmitTime(item.receivedAt, now);
    const scopeEntries = item.senderAddress ? entriesFor(item.senderAddress) : [];
    const kind = pendingKind(item.senderAddress, scopeEntries.length);
    const preferredIds = new Set(scopeEntries.map((e) => e.id));
    const body = stripQuotedReply(item.text);
    const { picks, unparsed } = parsePickLines(body);
    const fail = (reason: string, line: string, candidates: RosterEntry[] = []) =>
      unresolved.push({
        kind,
        reason,
        line,
        candidates: candidates.map((c) => c.entryName),
        item,
      });
    for (const u of unparsed) {
      if (/[A-Za-z]{3,}/.test(u) && !/^(hi|hey|hello|thanks|thank you|thx)\b/i.test(u)) fail("no team recognised on this line", u);
    }
    for (const p of picks) {
      let targets: { entry: RosterEntry; how: string }[] = [];
      if (p.all) {
        if (!scopeEntries.length) {
          fail("team for all entries, but the sender is not a known player address", p.line);
          continue;
        }
        targets = scopeEntries.map((entry) => ({ entry, how: "all entries of sender" }));
      } else if (p.entryRaw === null) {
        if (scopeEntries.length === 1) targets = [{ entry: scopeEntries[0], how: "sender's only entry" }];
        else {
          fail(
            scopeEntries.length ? `no entry named and the sender has ${scopeEntries.length} entries` : "no entry named and the sender is not a known player address",
            p.line,
            scopeEntries,
          );
          continue;
        }
      } else {
        const r = resolveEntry(p.entryRaw, roster, { preferredIds });
        if (!r.ok) {
          fail(`entry "${p.entryRaw}": ${r.reason.replace(/_/g, " ")}`, p.line, r.candidates);
          continue;
        }
        // A known sender picks only for entries they own or play.
        if (scopeCheck(r.entry.id, preferredIds) === "outside") {
          fail(`entry "${p.entryRaw}" is ${r.entry.entryName}, not one of the sender's entries`, p.line, scopeEntries);
          continue;
        }
        targets = [{ entry: r.entry, how: r.how }];
      }
      for (const t of targets) {
        const deadline = deadlineFor(p.team, ctx.bounds, ctx.games);
        proposals.push({
          entry: t.entry,
          week: item.week,
          team: p.team,
          source: item.source,
          deadline,
          late: isLate(deadline, madeAt),
          submittedAt: item.receivedAt,
          existing: ctx.currentByEntry.get(t.entry.id) ?? null,
          how: t.how,
          messageId: item.messageId,
          itemLabel: item.label,
        });
      }
    }
  }

  // ---- show
  const toWrite = proposals.filter((p) => !(p.existing && p.existing.team === p.team));
  const already = proposals.filter((p) => p.existing && p.existing.team === p.team);
  const weeksSeen = [...new Set(proposals.map((p) => p.week))].sort((a, b) => a - b);
  console.log(`\nProposed picks (${toWrite.length} to write, ${already.length} already recorded)${weeksSeen.length ? `, week${weeksSeen.length > 1 ? "s" : ""} ${weeksSeen.join(", ")}` : ""}:\n`);
  const header = `${pad("#", 3)} ${pad("wk", 3)} ${pad("entry", 26)} ${pad("owner", 22)} ${pad("team", 5)} ${pad("deadline", 24)} ${pad("timing", 8)} note`;
  console.log(header);
  console.log("-".repeat(header.length));
  let i = 0;
  for (const p of proposals) {
    const skip = p.existing && p.existing.team === p.team;
    const note = skip
      ? "already recorded, skip"
      : p.existing
        ? `OVERRIDE, was ${p.existing.team}`
        : `new (${p.how})`;
    console.log(
      `${pad(String(++i), 3)} ${pad(String(p.week), 3)} ${pad(p.entry.entryName, 26)} ${pad(p.entry.ownerName.trim(), 22)} ${pad(p.team, 5)} ${pad(formatEt(p.deadline), 24)} ${pad(p.late ? "LATE" : "on time", 8)} ${note}`,
    );
  }
  if (unresolved.length) {
    console.log(`\nNot resolved (${unresolved.length}); each becomes a pending_actions row for Anthony:`);
    for (const u of unresolved) {
      console.log(`- [${u.kind}] ${u.reason}: "${u.line}"  <- ${u.item.label}` + (u.candidates.length ? `  candidates: ${u.candidates.join(" | ")}` : ""));
    }
  }
  if (args.dryRun) {
    console.log("\nDry run. Nothing written.");
    return;
  }
  if (!toWrite.length && !unresolved.length) {
    console.log("\nNothing to write.");
    return;
  }
  const ok = await confirm(`\nWrite ${toWrite.length} pick(s) and stage ${unresolved.length} pending row(s)? (y/N) `);
  if (!ok) {
    console.log("Not approved. Nothing written.");
    return;
  }

  // ---- write
  const touched = new Set<string>();
  for (const p of toWrite) {
    const id = await submitPick(client, {
      entryId: p.entry.id,
      week: p.week,
      team: p.team,
      source: p.source,
      actor,
      submittedAt: p.submittedAt,
    });
    console.log(`wrote week ${p.week} ${p.entry.entryName} -> ${p.team} (${p.source}${p.late ? ", late" : ""}${p.submittedAt ? `, received ${formatEt(p.submittedAt)}` : ""}) pick ${id}`);
    if (p.messageId) touched.add(p.messageId);
  }
  for (const u of unresolved) {
    await stagePending(client, {
      kind: u.kind,
      payload: {
        week: u.item.week,
        from: u.item.senderAddress,
        subject: u.item.label,
        line: u.line,
        reason: u.reason,
        candidates: u.candidates,
        question: `Which entry and team did this mean? ${u.reason}.`,
      },
      sourceMessageId: u.item.messageId,
      actor,
    });
    console.log(`staged ${u.kind}: ${u.line}`);
    // The line itself may carry a team, and a pick is not public before
    // kickoff: the push says what kind of row and why, never the text.
    await notify(needsAnthonyLine("picks", u.kind, `${u.reason} - week ${u.item.week} - /admin/queue`), { tags: "warning" });
    if (u.item.messageId) touched.add(u.item.messageId);
  }
  if (touched.size && !args.keepUnread && !args.paste && !args.file) {
    const gmail = gmailClient();
    for (const id of touched) {
      const labelled = await markProcessed(gmail, id, DONE_LABEL);
      if (!labelled) console.log(`label ${DONE_LABEL} not found; ${id} marked read only`);
    }
    console.log(`${touched.size} message(s) marked read and filed under ${DONE_LABEL}.`);
  }
  console.log(`\nDone. ${toWrite.length} written, ${unresolved.length} staged.`);
  await notify(finishedLine("picks", `week${weeksSeen.length > 1 ? "s" : ""} ${weeksSeen.join(", ") || String(fallbackWeek ?? "?")}: ${toWrite.length} written, ${unresolved.length} staged`));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
