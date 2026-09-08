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
  loadPriorPicks,
  loadStandings,
  loadWeeks,
  stagePending,
  submitPick,
  type CurrentPickRow,
} from "../lib/db";
import { gmailClient, listUnreadFrom, markProcessed, type InboundMessage } from "../lib/gmail";
import { takeValue, weekArg } from "../lib/args";
import { ADMIN_MAILBOX } from "../lib/constants";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { aliveEntries, confirmedOwners, intakeAddresses } from "../lib/roster";
import { resolveFromArg } from "./lib/from";
import { confirm, readStdin } from "../lib/prompt";
import { deadlineFor, formatEt, isLate, type GameLite, type WeekBounds } from "./lib/deadline";
import {
  effectiveSubmitTime,
  leadingLines,
  overrideDecision,
  parsePickLines,
  pendingKind,
  pickSourceFor,
  resolveEntry,
  scopeCheck,
  scopeEntriesFor,
  senderUnplaced,
  conflictedKeys,
  itemIdentity,
  repeatedWeek,
  stripQuotedReply,
  stripWeekHeading,
  weekNamedIn,
  weekOfMessage,
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
    if (x === "--week") a.week = weekArg(takeValue(argv, ++i, x));
    else if (x === "--paste") a.paste = true;
    else if (x === "--file") a.file = takeValue(argv, ++i, x);
    else if (x === "--from") a.from = takeValue(argv, ++i, x);
    else if (x === "--source") {
      const s = takeValue(argv, ++i, x);
      if (s !== "email" && s !== "text") throw new Error("--source must be email or text");
      a.source = s;
    } else if (x === "--dry-run") a.dryRun = true;
    else if (x === "--keep-unread") a.keepUnread = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  return a;
}

interface Item {
  /** The identity for per-message checks: the Gmail message id, or label plus ordinal for pasted text. */
  id: string;
  label: string;
  text: string;
  source: "email" | "text";
  senderAddress: string | null;
  /** --from matched one owner by name; their entries are the scope even with no address on file. */
  fromOwnerId: string | null;
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
  itemId: string;
}

interface WeekContext {
  bounds: WeekBounds;
  games: GameLite[];
  currentByEntry: Map<string, CurrentPickRow>;
  /** entry id -> team -> the earlier week it was used in. */
  priorByEntry: Map<string, Map<string, number>>;
}

interface Unresolved {
  kind: "identity" | "player_question" | "pick";
  reason: string;
  line: string;
  candidates: string[];
  item: Item;
  /** A fully resolved pick Anthony has to decide on (a repeated team); approving it on /admin/queue records it. */
  pick?: { entryId: string; entryName: string; week: number; team: string };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { client, actor } = await adminClient();
  const [owners, entries, weeks, standings] = await Promise.all([loadOwners(client), loadLiveEntries(client), loadWeeks(client), loadStandings(client)]);
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
    const [gameRows, current, prior] = await Promise.all([
      loadGames(client, week),
      loadCurrentPicks(client, week),
      loadPriorPicks(client, week),
    ]);
    const priorByEntry = new Map<string, Map<string, number>>();
    for (const r of prior) {
      if (!priorByEntry.has(r.entry_id)) priorByEntry.set(r.entry_id, new Map());
      priorByEntry.get(r.entry_id)!.set(r.team, r.week);
    }
    const ctx: WeekContext = {
      bounds: { week, earlyDeadlineAt: bounds.early_deadline_at, lateDeadlineAt: bounds.late_deadline_at },
      games: gameRows.map((g) => ({ week: g.week, dayOfWeek: g.day_of_week, homeTeam: g.home_team, awayTeam: g.away_team })),
      currentByEntry: new Map(current.map((p) => [p.entry_id, p])),
      priorByEntry,
    };
    contexts.set(week, ctx);
    return ctx;
  };

  // Only entries of confirmed owners are in play: changing an owner's
  // participation_status does not void their entries, and the app's own
  // views keep the same line.
  const ownerById = new Map(confirmedOwners(owners).map((o) => [o.id, o]));
  // An eliminated entry is off the intake roster, as it is off the pick-email
  // screen: a reply naming it resolves to nothing and is staged, never
  // written. Named here so nothing drops out silently.
  const { alive, out } = aliveEntries(entries.filter((e) => ownerById.has(e.owner_id)), standings);
  if (out.length) {
    console.log(`Not taking picks (${out.length}): ${out.map((x) => `${x.entry.entry_name} (${x.why})`).join(", ")}`);
  }
  const roster: RosterEntry[] = alive.map((e) => {
    const o = ownerById.get(e.owner_id);
    return {
      id: e.id,
      entryName: e.entry_name,
      ownerId: e.owner_id,
      ownerName: o ? `${o.first_name} ${o.last_name}` : "",
      ownerEmail: o?.email ?? null,
      playerEmail: e.player_email,
      isGifted: e.is_gifted,
    };
  });

  // A gifted entry with no address is on nobody's scope: its pick belongs
  // to a person the roster cannot reach yet, so the buyer's "for all" must
  // not write it (CLAUDE.md, Gifted entries).
  const addressless = roster.filter((e) => e.isGifted && !e.playerEmail);
  if (addressless.length) {
    console.log(`Gifted with no address, picked by nobody here: ${addressless.map((e) => e.entryName).join(", ")}`);
  }
  const entriesFor = (address: string): RosterEntry[] => {
    const a = address.toLowerCase();
    return roster.filter((e) => {
      if (e.isGifted && !e.playerEmail) return false;
      return e.playerEmail ? e.playerEmail.toLowerCase() === a : (e.ownerEmail ?? "").toLowerCase() === a;
    });
  };

  // ---- gather
  const items: Item[] = [];
  if (args.paste || args.file) {
    const text = args.file ? fs.readFileSync(args.file, "utf8") : await readStdin();
    let sender: string | null = null;
    let fromOwnerId: string | null = null;
    if (args.from) {
      const scope = resolveFromArg(args.from, confirmedOwners(owners), entries);
      sender = scope.address;
      fromOwnerId = scope.ownerId;
    }
    const label = args.file ?? "pasted text";
    items.push({
      id: itemIdentity(null, label, items.length),
      label,
      text,
      source: pickSourceFor("paste", args.source),
      senderAddress: sender,
      fromOwnerId,
      messageId: null,
      // The pasted block's own week wins; --week is the fallback.
      week: weekFor(weekNamedIn(leadingLines(text))),
      receivedAt: null,
    });
  } else {
    if (args.source !== null) {
      throw new Error("--source applies to --paste or --file only; mail read from Gmail is always recorded as email.");
    }
    const gmail = gmailClient();
    const addresses = intakeAddresses(owners, entries, ADMIN_MAILBOX);
    const msgs: InboundMessage[] = await listUnreadFrom(gmail, addresses);
    for (const m of msgs) {
      items.push({
        id: itemIdentity(m.id, m.subject, items.length),
        label: `${m.from} | ${m.subject || "(no subject)"} | ${m.date}`,
        text: m.body,
        source: pickSourceFor("gmail", args.source),
        senderAddress: m.fromAddress,
        fromOwnerId: null,
        messageId: m.id,
        week: weekFor(weekOfMessage(m.subject, m.body)),
        receivedAt: m.receivedAt,
      });
    }
    if (!msgs.length) console.log("No unread mail from any known player address.");
  }

  // ---- resolve
  const proposals: Proposal[] = [];
  const unresolved: Unresolved[] = [];
  /** Repeated teams staged as eliminations, kept so the one-entry-one-team check still sees them. */
  const stagedRepeats: { key: string; team: string; entryName: string; usedIn: number; item: Item }[] = [];
  // Keyed by the item's identity (the Gmail message id), never its label.
  const keyFor = (itemId: string, week: number, entryId: string) => `${itemId}|${week}|${entryId}`;
  for (const item of items) {
    const ctx = await contextFor(item.week);
    const madeAt = effectiveSubmitTime(item.receivedAt, now);
    const scopeEntries = scopeEntriesFor(item, roster, entriesFor);
    const kind = pendingKind(item.senderAddress, scopeEntries.length);
    const preferredIds = new Set(scopeEntries.map((e) => e.id));
    const body = stripWeekHeading(stripQuotedReply(item.text));
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
    // A known address, or a --from owner, with no live entry behind it (a
    // declined owner, a voided roster) may name anything; nothing it names
    // is written.
    const unplaced = senderUnplaced(item, scopeEntries.length);
    for (const p of picks) {
      if (unplaced) {
        fail("sender matches no live entry on the roster", p.line);
        continue;
      }
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
        const existing = ctx.currentByEntry.get(t.entry.id) ?? null;
        const decision = overrideDecision(existing, madeAt, ctx.bounds.lateDeadlineAt, now);
        if (!decision.ok && existing && existing.team !== p.team) {
          fail(`${t.entry.entryName} -> ${p.team}: ${decision.reason}`, p.line);
          continue;
        }
        // A team this entry already used is an elimination in her pool, not
        // a warning (CLAUDE.md). It is staged as a pick with that said, so
        // Anthony records it knowingly on /admin/queue or dismisses it.
        const usedIn = repeatedWeek(p.team, ctx.priorByEntry.get(t.entry.id));
        if (usedIn !== null) {
          stagedRepeats.push({ key: keyFor(item.id, item.week, t.entry.id), team: p.team, entryName: t.entry.entryName, usedIn, item });
          unresolved.push({
            kind: "pick",
            reason: `${t.entry.entryName} -> ${p.team}: already used in week ${usedIn}; a repeated team is an ELIMINATION in her pool`,
            line: p.line,
            candidates: [],
            item,
            pick: { entryId: t.entry.id, entryName: t.entry.entryName, week: item.week, team: p.team },
          });
          continue;
        }
        proposals.push({
          entry: t.entry,
          week: item.week,
          team: p.team,
          source: item.source,
          deadline,
          late: isLate(deadline, madeAt),
          submittedAt: item.receivedAt,
          existing,
          how: t.how,
          messageId: item.messageId,
          itemLabel: item.label,
          itemId: item.id,
        });
      }
    }
  }

  // ---- one entry, one team, per message: two teams for one entry are staged,
  // a repeated team staged as an elimination counting as one of them.
  const keyOf = (p: Proposal) => keyFor(p.itemId, p.week, p.entry.id);
  const conflicts = conflictedKeys(
    proposals.map((p) => ({ key: keyOf(p), team: p.team })),
    stagedRepeats.map((s) => ({ key: s.key, team: s.team })),
  );
  if (conflicts.size) {
    const byKey = new Map<string, { entryName: string; teams: string[]; item: Item }>();
    for (const p of proposals) {
      if (!conflicts.has(keyOf(p))) continue;
      const g = byKey.get(keyOf(p)) ?? { entryName: p.entry.entryName, teams: [], item: items.find((i) => i.id === p.itemId)! };
      g.teams.push(p.team);
      byKey.set(keyOf(p), g);
    }
    for (const s of stagedRepeats) {
      if (!conflicts.has(s.key)) continue;
      const g = byKey.get(s.key) ?? { entryName: s.entryName, teams: [], item: s.item };
      g.teams.push(`${s.team} (already used in week ${s.usedIn})`);
      byKey.set(s.key, g);
    }
    // A repeat staged on its own would ask "record this elimination anyway?";
    // when the same message also names another team, the question is which
    // team was meant, so the pick row is withdrawn and the conflict row asks.
    const withdrawn = new Set(stagedRepeats.filter((s) => conflicts.has(s.key)).map((s) => s.key));
    const kept = unresolved.filter((u) => !(u.pick && withdrawn.has(keyFor(u.item.id, u.pick.week, u.pick.entryId))));
    unresolved.length = 0;
    unresolved.push(...kept);
    for (const g of byKey.values()) {
      const teams = [...new Set(g.teams)];
      unresolved.push({
        kind: pendingKind(g.item.senderAddress, 1),
        reason: `${g.entryName}: ${teams.join(" and ")} in one message; one entry, one team`,
        line: teams.join(" / "),
        candidates: [],
        item: g.item,
      });
    }
  }
  const seenKey = new Set<string>();
  const kept: Proposal[] = [];
  for (const p of proposals) {
    const k = keyOf(p);
    if (conflicts.has(k) || seenKey.has(k)) continue;
    seenKey.add(k);
    kept.push(p);
  }
  proposals.length = 0;
  proposals.push(...kept);

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
  // A message whose every pick is already on file is handled: it is filed
  // like any other, or it stays unread and comes back on every run.
  const fileOnly = new Set<string>();
  for (const p of already) if (p.messageId) fileOnly.add(p.messageId);
  for (const p of toWrite) if (p.messageId) fileOnly.delete(p.messageId);
  for (const u of unresolved) if (u.item.messageId) fileOnly.delete(u.item.messageId);
  const fileMessages = async (ids: Set<string>) => {
    if (!ids.size || args.keepUnread || args.paste || args.file) return;
    const gmail = gmailClient();
    for (const id of ids) {
      const labelled = await markProcessed(gmail, id, DONE_LABEL);
      if (!labelled) console.log(`label ${DONE_LABEL} not found; ${id} marked read only`);
    }
    console.log(`${ids.size} message(s) marked read and filed under ${DONE_LABEL}.`);
  };
  if (!toWrite.length && !unresolved.length) {
    console.log(`\nNothing to write.${fileOnly.size ? ` ${fileOnly.size} message(s) already recorded in full.` : ""}`);
    await fileMessages(fileOnly);
    return;
  }
  const ok = await confirm(`\nWrite ${toWrite.length} pick(s) and stage ${unresolved.length} pending row(s)? (y/N) `);
  if (!ok) {
    console.log("Not approved. Nothing written.");
    return;
  }

  // ---- write
  const touched = new Set<string>(fileOnly);
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
      payload: u.pick
        ? {
            entry_id: u.pick.entryId,
            entry_name: u.pick.entryName,
            week: u.pick.week,
            team: u.pick.team,
            source: u.item.source,
            received_at: u.item.receivedAt,
            from: u.item.senderAddress,
            subject: u.item.label,
            line: u.line,
            reason: u.reason,
            question: `Record this pick anyway? ${u.reason}. Approve writes it with its receipt time; dismiss leaves the entry unpicked.`,
          }
        : {
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
  await fileMessages(touched);
  console.log(`\nDone. ${toWrite.length} written, ${unresolved.length} staged.`);
  await notify(finishedLine("picks", `week${weeksSeen.length > 1 ? "s" : ""} ${weeksSeen.join(", ") || String(fallbackWeek ?? "?")}: ${toWrite.length} written, ${unresolved.length} staged`));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
