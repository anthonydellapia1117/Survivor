// npm run picks
//
// Reads every message from a known player address that the sweep has not
// already processed - WHATEVER its read state (Anthony, 2026-09-15) - or a
// pasted block of text, turns each line into a proposed pick, shows the
// table, and writes nothing until Anthony types y. Writes go through
// admin_submit_pick with the source the pick arrived by; what cannot be
// resolved is staged for him in pending_actions with the message id, never
// dropped and never guessed.
//
//   npm run picks                       scan Gmail (source email)
//   npm run picks -- --paste            read picks from stdin (source text)
//   npm run picks -- --file picks.txt   read picks from a file (source text)
//   npm run picks -- --message-id <id>  exactly these messages, whatever
//                                       their labels or read state (repeatable)
//   options: --week N  --from <email or name>  --source text|email
//            --dry-run  --keep-unfiled  --yes
//
// Processed means: the message carries the DONE label, or its Gmail id is
// already on file (a pending_actions row, or a pick_from_message audit row
// beside a written pick). The label is resolved or created before anything
// is read; a run that could not file a message would read it again every
// hour. Three reads: every roster address, whatever the subject; strangers
// whose subject names the pool; and delivery failures from a mailer, whose
// failed recipient is matched to the roster.
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
  loadDoubleElimThroughWeek,
  loadFiledMessageIds,
  loadGames,
  loadLiveEntries,
  loadOwners,
  loadPriorPicks,
  loadStandings,
  loadWeeks,
  recordPickMessage,
  stagePending,
  submitPick,
  type CurrentPickRow,
} from "../lib/db";
import { ensureLabel, getMessageFull, gmailClient, listSweepFrom, listSweepMatching, markProcessed, type InboundMessage, type SweepSkip } from "../lib/gmail";
import { takeValue, weekArg } from "../lib/args";
import { ADMIN_MAILBOX, DONE_LABEL, LYNNE_EMAIL, MAX_NOISE_ROWS_PER_RUN, MAX_ROSTER_ROWS_PER_RUN } from "../lib/constants";
import { loadOpsConfig } from "../ops/lib/config";
import { STRANGER_NOTHING_LINE, strangerIdentityRow, strangerMessages, subjectSweepQuery } from "./lib/subject-sweep";
import { bouncePayload, bounceSweepQuery, classifyBounces, isBounceSender, type BounceRow } from "./lib/bounce";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { aliveEntries, confirmedOwners, intakeAddresses } from "../lib/roster";
import { resolveFromArg } from "./lib/from";
import { confirm, readStdin } from "../lib/prompt";
import { SKIP_WEEK } from "@/lib/standing";
import { deadlineFor, formatEt, isLate, type GameLite, type WeekBounds } from "./lib/deadline";
import {
  byeRefusal,
  ceilingDetail,
  ceilingSenderLines,
  conflictedKeys,
  effectiveSubmitTime,
  itemIdentity,
  overrideDecision,
  parsePickLines,
  pendingKind,
  pickSourceFor,
  picksToCarryForward,
  repeatedWeek,
  resolveEntry,
  rowClassOf,
  scopeCheck,
  scopeEntriesFor,
  senderUnplaced,
  stagedDetail,
  stagingCeiling,
  stripQuotedReply,
  stripWeekHeading,
  type RosterEntry,
  unparsedLinesToAsk,
  weekNamedIn,
  weekOfMessage,
} from "./lib/resolve";

interface Args {
  week: number | null;
  paste: boolean;
  file: string | null;
  from: string | null;
  source: "email" | "text" | null;
  dryRun: boolean;
  /** Leave processed mail unfiled (no DONE label, still unread), so the next run reads it again. */
  keepUnfiled: boolean;
  /** Exactly these Gmail messages, whatever their labels or read state. */
  messageIds: string[];
  /** Skip the y/N prompt: the schedule's form (npm run ops -- sweep). */
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { week: null, paste: false, file: null, from: null, source: null, dryRun: false, keepUnfiled: false, messageIds: [], yes: false };
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
    else if (x === "--keep-unfiled") a.keepUnfiled = true;
    else if (x === "--keep-unread") {
      // The old spelling, from when read state was the marker. Accepted for
      // one release so a pasted command still runs; the new name is printed.
      console.log("--keep-unread is now --keep-unfiled (the DONE label is the marker, not read state); accepted this once.");
      a.keepUnfiled = true;
    } else if (x === "--message-id") a.messageIds.push(takeValue(argv, ++i, x));
    else if (x === "--yes") a.yes = true;
    else throw new Error(`Unknown argument ${x}`);
  }
  if (a.messageIds.length && (a.paste || a.file)) throw new Error("--message-id reads Gmail; it cannot be combined with --paste or --file.");
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
  /**
   * The sender is on no roster row and the message came in on the subject
   * rule. Carried through parsing because a stranger whose body parses to
   * nothing produced no row at all: it was never staged and never marked, so
   * every hourly sweep found it again while the log said it had been staged
   * (issue #42).
   */
  stranger: boolean;
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
  /** A delivery failure for a roster address: the payload is the bounce's, not a line's. */
  bounce?: Record<string, unknown>;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { client, actor } = await adminClient();
  const [owners, entries, weeks, standings, doubleElimThroughWeek] = await Promise.all([
    loadOwners(client),
    loadLiveEntries(client),
    loadWeeks(client),
    loadStandings(client),
    loadDoubleElimThroughWeek(client),
  ]);
  const standingByEntry = new Map(standings.map((s) => [s.entry_id, s]));
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
      lynneNumber: e.lynne_number,
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
  /** Delivery failures for roster addresses, staged as they are; nothing to parse. */
  const bounceRows: Unresolved[] = [];
  /** Delivery failures for addresses on no roster row: filed, never staged. */
  const notOursBounces = new Set<string>();
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
      // The week is read from the unquoted text, the same way a Gmail
      // message's is: a pasted reply whose own lines name no week falls back
      // to --week, never to a week named in the quoted history under it.
      week: weekFor(weekOfMessage("", text)),
      receivedAt: null,
      stranger: false,
    });
  } else {
    if (args.source !== null) {
      throw new Error("--source applies to --paste or --file only; mail read from Gmail is always recorded as email.");
    }
    const gmail = gmailClient();
    // THE LABEL FIRST, before anything is read. Read state is no longer the
    // marker (2026-09-15), so the DONE label is the only thing that keeps a
    // processed message out of the next run; if it is missing it is created,
    // and if that fails the run stops here with nothing read.
    const doneLabelId = await ensureLabel(gmail, DONE_LABEL);
    const skip: SweepSkip = { doneLabelId, onFileIds: await loadFiledMessageIds(client) };
    const addresses = intakeAddresses(owners, entries, ADMIN_MAILBOX);
    const addressSet = new Set(addresses);
    const ops = loadOpsConfig();
    const terms = ops.sweepSubjectTerms;
    // The machine senders are excluded twice on purpose: in the Gmail query,
    // so their mail is never fetched, and in strangerMessages, so a forwarded
    // copy arriving by another route is still dropped.
    const excluded = [ADMIN_MAILBOX, LYNNE_EMAIL, ...ops.sweepExcludeSenders];
    let known: InboundMessage[] = [];
    let strangers: InboundMessage[] = [];
    let bounces: BounceRow[] = [];
    if (args.messageIds.length) {
      // Named messages are read whatever their labels or read state, and
      // the on-file check is skipped for the id itself. Every pick-level
      // check below still applies: this is how a message staged once is
      // re-read after the parser has learned its shape.
      for (const id of args.messageIds) {
        const m = await getMessageFull(gmail, id);
        if (m.fromAddress === ADMIN_MAILBOX) {
          throw new Error(`${id} is from the admin mailbox; this sweep never reads it. Dictated picks go through npm run picks:self.`);
        }
        if (isBounceSender(m.fromAddress)) bounces.push(...classifyBounces([m], addresses, entriesFor));
        else if (addressSet.has(m.fromAddress)) known.push(m);
        else strangers.push(m);
      }
    } else {
      // Three reads. Every message from a known address, whatever its
      // subject or label; the Gmail filter's rule in code - mail from anyone
      // else whose subject names the pool or the picks - which lands below
      // as an identity question, never as a written pick; and delivery
      // failures from a mailer, matched to the roster by the failed address.
      known = await listSweepFrom(gmail, addresses, skip);
      strangers = strangerMessages(await listSweepMatching(gmail, subjectSweepQuery(terms, ops.sweepExcludeSenders), skip), addresses, excluded, terms);
      bounces = classifyBounces(await listSweepMatching(gmail, bounceSweepQuery(), skip), addresses, entriesFor);
      // A DSN whose subject happened to carry a term is a bounce, not a stranger.
      const bounceIds = new Set(bounces.map((b) => b.messageId));
      strangers = strangers.filter((m) => !bounceIds.has(m.id));
    }
    const msgs: InboundMessage[] = [...known, ...strangers];
    const strangerIds = new Set(strangers.map((m) => m.id));
    if (strangers.length) console.log(`${strangers.length} message(s) from unknown senders with "${terms.join('" or "')}" in the subject; staged for Anthony, never written.`);
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
        stranger: strangerIds.has(m.id),
      });
    }
    for (const b of bounces) {
      const item: Item = {
        id: itemIdentity(b.messageId, b.subject, items.length + bounceRows.length),
        label: `${b.from} | ${b.subject || "(no subject)"} | bounce`,
        text: "",
        source: "email",
        senderAddress: b.from,
        fromOwnerId: null,
        messageId: b.messageId,
        week: weekFor(weekNamedIn(b.subject)),
        receivedAt: b.receivedAt,
        stranger: false,
      };
      if (b.onRoster || b.bouncedAddress === null) {
        // ONE identity row per roster bounce - the kind the queue already
        // renders - naming the person's entries. A notice whose recipient
        // could not be read is staged too: it may be one of ours.
        const reason = b.bouncedAddress === null
          ? "delivery failed; the recipient could not be read from the notice"
          : `delivery failed to ${b.bouncedAddress} (${b.entryNames.join(", ") || "no live entry"})`;
        bounceRows.push({ kind: "identity", reason, line: b.subject || "(no subject)", candidates: b.entryNames, item, bounce: bouncePayload(b, item.week) });
      } else {
        // Not ours: filed under DONE, not staged. Nothing of the roster failed.
        notOursBounces.add(b.messageId);
        console.log(`bounce for ${b.bouncedAddress}, not a roster address: filed, not staged`);
      }
    }
    if (!msgs.length && !bounces.length) console.log("No unprocessed mail from any known player address.");
  }

  // ---- resolve
  const proposals: Proposal[] = [];
  const unresolved: Unresolved[] = [];
  /** Repeated teams staged as eliminations, kept so the one-entry-one-team check still sees them. */
  const stagedRepeats: { key: string; team: string; entryName: string; usedIn: number; item: Item }[] = [];
  // Keyed by the item's identity (the Gmail message id), never its label.
  const keyFor = (itemId: string, week: number, entryId: string) => `${itemId}|${week}|${entryId}`;
  for (const item of items) {
    const rowsBefore = unresolved.length + proposals.length;
    const ctx = await contextFor(item.week);
    // What THIS message gave each entry, so the snapshot can be moved on
    // after it. Two messages for one entry in one run both read the pre-run
    // snapshot, so an after-lock correction saw no current pick and was
    // written straight over the on-time one instead of being staged
    // (issue #21). Merged at the end of the item, never inside it: within one
    // message two teams for one entry is the conflict the pass below reports,
    // and moving the snapshot mid-message would turn that into a stale-pick
    // complaint instead.
    const itemTeams = new Map<string, Set<string>>();
    const itemPicks = new Map<string, CurrentPickRow>();
    const sawTeam = (entryId: string, team: string) => {
      const seen = itemTeams.get(entryId) ?? new Set<string>();
      seen.add(team);
      itemTeams.set(entryId, seen);
    };
    const madeAt = effectiveSubmitTime(item.receivedAt, now);
    const scopeEntries = scopeEntriesFor(item, roster, entriesFor);
    const kind = pendingKind(item.senderAddress, scopeEntries.length);
    const preferredIds = new Set(scopeEntries.map((e) => e.id));
    const body = stripWeekHeading(stripQuotedReply(item.text));
    const { picks, unparsed, multi } = parsePickLines(body);
    const fail = (reason: string, line: string, candidates: RosterEntry[] = []) =>
      unresolved.push({
        kind,
        reason,
        line,
        candidates: candidates.map((c) => c.entryName),
        item,
      });
    // ONE ROW PER MESSAGE, NEVER ONE PER LINE, when the sender resolves to no
    // live entry (Anthony, 2026-09-10). unparsedReason calls any line with
    // three consecutive letters and no greeting "no team recognised on this
    // line", which is right for a player's reply and catastrophic for a
    // newsletter: a Codex review email is 149 lines, so it was 149 rows.
    // Placed senders keep the per-line questions - that is the useful half.
    const placed = scopeEntries.length > 0;
    let askedForThisItem = false;
    const askOnce = (reason: string) => {
      if (askedForThisItem) return;
      askedForThisItem = true;
      fail(reason, STRANGER_NOTHING_LINE);
    };
    // A line that is the sender's own name is a signature, not a question.
    const signatures = [...new Set(scopeEntries.map((e) => e.ownerName))];
    for (const ask of unparsedLinesToAsk(placed, unparsed, signatures)) fail(ask.reason, ask.line);
    // A known address, or a --from owner, with no live entry behind it (a
    // declined owner, a voided roster) may name anything; nothing it names
    // is written.
    const unplaced = senderUnplaced(item, scopeEntries.length);
    // TWO TEAMS FOR TWO ENTRIES WITH THE ORDER UNSTATED ("Chargers & 49ers",
    // Kris Tomasco, 2026-09-15) is NEVER assigned by order. One question for
    // the message naming the entries and the teams, and Anthony says which is
    // which. Any other count of teams against entries is the same question
    // with the mismatch stated.
    for (const m of multi) {
      if (unplaced) {
        askOnce("sender matches no live entry on the roster");
        continue;
      }
      const names = scopeEntries.map((e) => e.entryName).join(", ");
      if (scopeEntries.length === m.teams.length) {
        fail(`names ${m.teams.length} teams for ${scopeEntries.length} entries with the order unstated: which is which? entries ${names}; teams ${m.teams.join(", ")}`, m.line, scopeEntries);
      } else {
        fail(`names ${m.teams.length} teams (${m.teams.join(", ")}) and the sender has ${scopeEntries.length} entr${scopeEntries.length === 1 ? "y" : "ies"} (${names})`, m.line, scopeEntries);
      }
    }
    for (const p of picks) {
      if (unplaced) {
        askOnce("sender matches no live entry on the roster");
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
        const decision = overrideDecision(existing, madeAt, ctx.bounds.lateDeadlineAt);
        if (!decision.ok && existing && existing.team !== p.team) {
          fail(`${t.entry.entryName} -> ${p.team}: ${decision.reason}`, p.line);
          continue;
        }
        // A team this entry already used is an elimination in her pool, not
        // a warning (CLAUDE.md). It is staged as a pick with that said, so
        // Anthony records it knowingly on /admin/queue or dismisses it.
        const usedIn = repeatedWeek(p.team, ctx.priorByEntry.get(t.entry.id));
        if (usedIn !== null) {
          sawTeam(t.entry.id, p.team);
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
        // A bye admin_submit_pick would refuse is staged as a question here.
        // Reaching the write with it killed the run: what was written before
        // it stayed, the rest was not written, and the remaining mail stayed
        // unread until the next sweep (issue #22).
        // An entry whose current pick for THIS week is already the bye reads
        // as bye_used, so re-sending the same bye would be refused as "bye
        // already used" and staged as a question where the ordinary
        // already-recorded no-op belongs. The rules engine has the same
        // exemption in effect: it is not a second bye.
        if (p.team === SKIP_WEEK && !(existing && existing.team === SKIP_WEEK)) {
          const why = byeRefusal(item.week, standingByEntry.get(t.entry.id) ?? null, doubleElimThroughWeek);
          if (why !== null) {
            fail(`${t.entry.entryName} -> bye: ${why}`, p.line);
            continue;
          }
        }
        sawTeam(t.entry.id, p.team);
        // Only a pick that will actually be WRITTEN moves the snapshot on.
        // A message naming the team already on file writes nothing, so the
        // row on file is still the truth - and replacing its submitted_at
        // with this message's would make a later, still-older message look
        // newer than the pick in the database and overwrite it. A Tuesday PHI
        // on file, then an older Monday PHI and a later Monday KC in one run,
        // is enough: line 401 lets the same-team message through even when
        // overrideDecision refuses it, so the snapshot took Monday and KC
        // then passed the stale-message guard.
        if (!(existing && existing.team === p.team)) {
          itemPicks.set(t.entry.id, {
            entry_id: t.entry.id,
            team: p.team,
            late: isLate(deadline, madeAt),
            submitted_at: madeAt.toISOString(),
            result: null,
          });
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
    // A stranger's mail that parsed to nothing at all - an empty body, a bare
    // greeting, anything unparsedReason calls noise - would leave this loop
    // having produced no row, so it was neither staged nor marked and came
    // back on every sweep (issue #42). It becomes one identity question, which
    // is what the log line above already claimed. A stranger never becomes a
    // pick; this only makes sure they become a question.
    // Only an entry this message gave exactly one team moves the snapshot on.
    for (const [entryId, row] of picksToCarryForward(itemPicks, itemTeams)) ctx.currentByEntry.set(entryId, row);

    // Widened from item.stranger to !placed on 2026-09-10: a known address
    // with no live entry behind it (a declined owner, a voided roster) is in
    // exactly the same position as a stranger - nothing it says can be
    // written - and it was the one shape that could still produce no row at
    // all and come back on every sweep.
    const nothingHeard = strangerIdentityRow(!placed, unresolved.length + proposals.length - rowsBefore);
    if (nothingHeard) unresolved.push({ ...nothingHeard, candidates: [], item });
  }
  unresolved.push(...bounceRows);

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
  // like any other, or it comes back on every run. A bounce for an address
  // on no roster row is filed the same way.
  const fileOnly = new Set<string>(notOursBounces);
  for (const p of already) if (p.messageId) fileOnly.add(p.messageId);
  for (const p of toWrite) if (p.messageId) fileOnly.delete(p.messageId);
  for (const u of unresolved) if (u.item.messageId) fileOnly.delete(u.item.messageId);
  const fileMessages = async (ids: Set<string>) => {
    if (!ids.size || args.keepUnfiled || args.paste || args.file) return;
    const gmail = gmailClient();
    for (const id of ids) {
      const labelled = await markProcessed(gmail, id, DONE_LABEL);
      if (!labelled) console.log(`label ${DONE_LABEL} not found; ${id} marked read only`);
    }
    console.log(`${ids.size} message(s) filed under ${DONE_LABEL} and marked read.`);
  };
  // THE CEILING, split by class (Anthony, 2026-09-15). Before the confirm,
  // before any write, before a single message is filed.
  //
  // ROSTER over its limit (rows from placed senders: picks and player
  // questions, limit the roster size) stops the whole run dead and prints
  // who it came from. Nothing is written, nothing is staged, nothing is
  // filed - more than one row per live entry in one run is a reader defect,
  // and picks written out of that run would be picks read by the same
  // defect.
  //
  // NOISE over its limit (identity rows: senders with no live entry) leaves
  // THOSE rows unstaged and unfiled and prints who they came from - the same
  // mail is still there once the filter is right - and the roster rows and
  // the clean picks in this run STILL GO THROUGH. A newsletter flood on a
  // Wednesday must not hold 43 people's picks. Raising either limit is never
  // the fix.
  const ceiling = stagingCeiling(
    unresolved.map((u) => ({ sender: u.item.senderAddress, klass: rowClassOf(u.kind) })),
    { noise: MAX_NOISE_ROWS_PER_RUN, roster: MAX_ROSTER_ROWS_PER_RUN },
  );
  if (ceiling.tripped === "roster") {
    console.log(`\nNEEDS ANTHONY: this run would stage ${ceiling.roster.staged} roster rows, over the ceiling of ${ceiling.roster.limit}.`);
    console.log("Nothing was written, nothing was staged and no message was filed.");
    for (const line of ceilingSenderLines(ceiling.roster)) console.log(line);
    console.log("More than one row per live entry in one run is a reader defect. Fix the parser; do not raise the ceiling.");
    await notify(needsAnthonyLine("picks", "roster staging ceiling", ceilingDetail("roster", ceiling.roster.staged, ceiling.roster.limit)), { tags: "warning" });
    return;
  }
  if (ceiling.tripped === "noise") {
    const held = unresolved.filter((u) => rowClassOf(u.kind) === "noise");
    const kept = unresolved.filter((u) => rowClassOf(u.kind) !== "noise");
    unresolved.length = 0;
    unresolved.push(...kept);
    console.log(`\nNEEDS ANTHONY: ${held.length} noise rows from senders with no live entry, over the ceiling of ${ceiling.noise.limit}. Left unstaged and unfiled; the roster's rows and picks below still go through.`);
    for (const line of ceilingSenderLines(ceiling.noise)) console.log(line);
    console.log("A sweep reading this much stranger mail has the wrong filter. Fix the filter; do not raise the ceiling.");
    await notify(needsAnthonyLine("picks", "noise staging ceiling", ceilingDetail("noise", ceiling.noise.staged, ceiling.noise.limit)), { tags: "warning" });
  }
  if (!toWrite.length && !unresolved.length) {
    console.log(`\nNothing to write.${fileOnly.size ? ` ${fileOnly.size} message(s) already recorded in full.` : ""}`);
    await fileMessages(fileOnly);
    return;
  }
  const ok = args.yes || (await confirm(`\nWrite ${toWrite.length} pick(s) and stage ${unresolved.length} pending row(s)? (y/N) `));
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
    if (p.messageId) {
      // The message id beside the pick, so the sweep can treat this message
      // as processed by id alone whatever its labels say (2026-09-15).
      await recordPickMessage(client, { actor, pickId: id, messageId: p.messageId, entryId: p.entry.id, week: p.week, team: p.team });
      touched.add(p.messageId);
    }
  }
  for (const u of unresolved) {
    await stagePending(client, {
      kind: u.kind,
      payload: u.bounce
        ? u.bounce
        : u.pick
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
    if (u.bounce) console.log(`NEEDS ANTHONY: ${u.reason} - see /admin/queue`);
    // The reason and the line can both carry a team, and a pick is not
    // public before kickoff: the push says the kind and the week, nothing
    // else - and never an address, so a bounce's push says only that one
    // was staged. The detail is on /admin/queue.
    await notify(needsAnthonyLine("picks", u.bounce ? "bounce" : u.kind, stagedDetail(u.item.week)), { tags: "warning" });
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
