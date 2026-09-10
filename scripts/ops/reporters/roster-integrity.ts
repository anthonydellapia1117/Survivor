// The roster-integrity check, as a pure reporter.
//
// THIS ONE HAS NO ROUTINE BEHIND IT. The six claude.ai Routines of
// docs/ROUTINES.md had Gmail, the repo and the clock and no database at all
// (section 1b), so not one of them could ask a single question below: every
// one is a comparison between two things only the DATABASE holds. It is the
// check that would have caught what actually went wrong this season -
// `AAA #9` never minted when two owners went in by RPC on 2026-09-03 and
// found only by hand, and `Lou Direnzo #1`-`#2` marked gifted with no address
// on 2026-09-04, which took two live entries off Nick DiVirgilio's request and
// put them on nobody's.
//
// Five questions, and it answers none of them:
//
//   - the addresses derived live this run against the count every whole-roster
//     message gates on;
//   - free entries held against FLOOR(recruited / 10);
//   - a live entry with no Lynne number, and a Lynne number on two of them;
//   - a gifted entry with no address, which goes on NOBODY's pick request;
//   - two live entries whose names are the same once case and spacing are set
//     aside.
//
// EVERY LINE IS A QUESTION FOR ANTHONY, never a correction. Nothing here
// writes, sends, mints, renames, numbers, marks Paid or resolves anything:
// the mint is the `mint_free_entries` trigger's and an app-layer mint is the
// thing CLAUDE.md forbids reintroducing; names are stored verbatim and never
// normalised by the app; and an entry Lynne may already hold a number against
// is his to take back, never a job's.
//
// It reads none of her rows. Her sheet is the authority on elimination in her
// pool and says nothing about whether this roster is internally consistent -
// and her list is partial, so silence from her is never a finding here.

import { freeEntitlement } from "@/lib/free-entries";
import { collisionKind } from "@/lib/names";
import type { Report, ReportItem } from "../lib/report";
import { deadlineFor, etLabel, openWeek, type EntrySnapshot, type OpsSnapshot } from "./types";

const JOB = "roster-integrity";

// Said once above the items rather than repeated on every line - section 1d
// wants the question, not the same sentence five times. It survives a
// collapse: renderReport keeps the head and folds only the items.
const PREAMBLE =
  "every line is a question for Anthony - this run corrects nothing, mints nothing, renames nothing and numbers nothing.";

function entryWord(n: number): string {
  return n === 1 ? "entry" : "entries";
}

/**
 * The open week's late boundary, as a suffix.
 *
 * Four of the five checks below are tied to it and say so. His picks go to her
 * at the lock, and she matches what he sends BY NUMBER and imports results BY
 * NAME - so an entry with no number, a number on two entries, a name that is
 * another name once case is set aside, and a gifted entry nobody is being
 * asked for are all questions that have to be settled before the week locks.
 *
 * The free-entry lines deliberately take no deadline: an entry that has not
 * been minted is not on the roster, so nobody's pick is missing on its
 * account, and naming a pick deadline there would invent a tie the entitlement
 * does not have.
 */
function lockSuffix(s: OpsSnapshot): string {
  const week = openWeek(s);
  if (week === null) return "";
  // deadlineFor with NO team is the week's late boundary - the Friday noon
  // that locks the whole week, which is the one these are tied to.
  const iso = deadlineFor(s, week, null);
  return iso === null ? "" : ` - Week ${week} locks ${etLabel(iso)}`;
}

/**
 * The recipient count gate: what this run derived against what the constant
 * says, and this is the most valuable line in the file.
 *
 * `npm run remind` and `npm run chase` derive their recipients live on every
 * run and STOP unless the count equals `expectedRosterAddresses` exactly - so
 * a mismatch is not a warning, it is every whole-roster message failing to go
 * out at all until somebody looks. Deriving live is itself the fix for the
 * older failure: a stale saved list is what once sent a message to 27
 * addresses instead of 39. A range would let a wrong count through, which is
 * why the gate is exact and why changing the number is a reviewed change to
 * the constant and never a flag (CLAUDE.md, Local commands).
 *
 * WHICH addresses moved cannot be told from a bare count - the other side of
 * the comparison is a number, not a list - so the line says so and prints
 * every address this run derived rather than guessing at a difference. That is
 * also what CLAUDE.md asks the stopped run itself to print: the list and the
 * delta.
 */
function recipientCountItems(s: OpsSnapshot, lock: string): ReportItem[] {
  const have = s.recipientAddresses.length;
  const want = s.expectedRosterAddresses;
  if (have === want) return [];
  const delta = have - want;
  const direction = delta > 0 ? `${delta} more than expected` : `${-delta} fewer than expected`;
  const list = s.recipientAddresses.length > 0 ? s.recipientAddresses.join(", ") : "none";
  return [
    {
      text:
        `Whole-roster messages stop on this: ${have} ${have === 1 ? "address" : "addresses"} derived from the live roster,` +
        ` ${want} expected - ${direction} - the count must equal it exactly or the run stops, and the constant is a reviewed change, never a flag` +
        ` - a bare count cannot say which address moved, so here are all ${have} derived: ${list}${lock}`,
      names: [...s.recipientAddresses],
    },
  ];
}

/**
 * Free entries held against the entitlement.
 *
 * The entitlement comes from `freeEntitlement` in src/lib/free-entries.ts,
 * which is the number /admin displays, so this line and that screen cannot
 * disagree. The MINT is the `mint_free_entries` trigger's, in the same
 * transaction as whatever write earned it; this reporter is read-only on it,
 * exactly as that module is.
 *
 * Both directions are an item and they are different questions:
 *
 *   - BELOW entitlement means a write got past the trigger. That is not a
 *     thing to fix here by minting one - on 2026-09-03 the rule still lived in
 *     the app and `AAA #9` silently never appeared, which is why it moved into
 *     the database. The question is why the trigger did not fire.
 *   - ABOVE entitlement is a surplus, and it is Anthony's call and never a
 *     trigger's: the mint never un-mints, because voiding recruits lowers the
 *     entitlement and taking back an entry Lynne may already hold a number
 *     against is a decision, not a rule.
 */
function freeEntryItems(s: OpsSnapshot): ReportItem[] {
  const held = s.freeEntryCount;
  const owed = freeEntitlement(s.recruitedCount);
  if (held === owed) return [];
  const both = `${held} free ${entryWord(held)} held, ${owed} earned on ${s.recruitedCount} recruited (FLOOR(recruited / 10))`;
  if (held < owed) {
    return [
      {
        text:
          `${both} - ${owed - held} short - the mint is the mint_free_entries trigger's, in the same transaction as the write that earned it,` +
          ` so a shortfall means a write got past it - do not mint in the app: why did the trigger not fire?`,
      },
    ];
  }
  return [
    {
      text:
        `${both} - a surplus of ${held - owed} - the mint never un-mints, so voiding recruits leaves the extra standing` +
        ` - taking one back from an entry Lynne may already hold a number against is Anthony's call and never a trigger's: leave it or void it?`,
    },
  ];
}

/** `Entry name (Owner Name)` - the FULL owner name, never a first name: there are three Tropeas and they are three people. */
function label(e: EntrySnapshot): string {
  return `${e.entryName} (${e.ownerName})`;
}

/**
 * Lynne numbers: a live entry without one, and a number on more than one.
 *
 * She matches on the NUMBER - that is the whole reason the 2026-09-08 renumber
 * nulled all 121 first, because `entries_lynne_number_key` is unique and a +1
 * shift collides. That unique index is also why the second half of this check
 * should never fire; it is here because if the index ever goes, nothing else
 * in the app would notice, and the failure it hides is one entry taking
 * another's result on her sheet.
 *
 * Entries are matched to each other by number here and by nothing else. Names
 * are not identifiers: hers carry her own casing and double spaces
 * (`Adriana Flacco ` with its trailing space, `Amy  3`), and ours are stored
 * verbatim.
 */
function lynneNumberItems(s: OpsSnapshot, lock: string): ReportItem[] {
  const out: ReportItem[] = [];

  // Free entries are counted in too: they still get Lynne numbers and still
  // appear in the roster export, they just do not bill (CLAUDE.md).
  const missing = s.entries.filter(() => true);
  if (missing.length > 0) {
    const names = missing.map(label);
    out.push({
      text:
        `${missing.length} live ${entryWord(missing.length)} with no Lynne number: ${names.join(", ")}` +
        ` - she matches on the number, so ${missing.length === 1 ? "it is" : "they are"} not findable on her sheet - ask her for` +
        ` ${missing.length === 1 ? "it" : "them"}${lock}`,
      names,
    });
  }

  const byNumber = new Map<number, EntrySnapshot[]>();
  for (const e of s.entries) {
    if (e.lynneNumber === null) continue;
    const held = byNumber.get(e.lynneNumber);
    if (held) held.push(e);
    else byNumber.set(e.lynneNumber, [e]);
  }
  const clashes = [...byNumber.entries()].filter(([, es]) => es.length > 1).sort((a, b) => a[0] - b[0]);
  for (const [no, es] of clashes) {
    const names = es.map(label);
    out.push({
      text:
        `Lynne number ${no} is held by ${es.length} live entries: ${names.join(", ")}` +
        ` - she matches on the number, so one of them takes the other's result - which entry is ${no}?${lock}`,
      names,
    });
  }
  return out;
}

/**
 * Gifted with no address: `is_gifted` true and no `player_email`.
 *
 * It is a REAL STATE and not an error - "somebody else plays this and I do not
 * have their address yet" - which is exactly why it is worth a line. Such an
 * entry goes on NOBODY's pick request, not the buyer's: falling through to him
 * would ask him to choose a team for an entry whose pick belongs to somebody
 * else. The cost is that it sits unasked, so CLAUDE.md says chase the address
 * before the week's late deadline, and that is the deadline this line names.
 *
 * And the other half of the question, because the app got this wrong once:
 * before putting an entry in this state, check there is a PERSON behind the
 * name. `Lou Direnzo #1`-`#2` are Nick DiVirgilio's own entries, named after a
 * friend to tell them apart; there is no Lou to contact and there never will
 * be. An alias is simply `is_gifted = false`, like any entry its owner plays.
 */
function giftedWithoutAddressItems(s: OpsSnapshot, lock: string): ReportItem[] {
  const gap = s.entries.filter((e) => e.isGifted && e.playerEmail === null);
  if (gap.length === 0) return [];
  const names = gap.map((e) => `${e.entryName} (bought by ${e.ownerName})`);
  const it = gap.length === 1 ? "it" : "them";
  return [
    {
      text:
        `${gap.length} gifted ${entryWord(gap.length)} with no address on file: ${names.join(", ")}` +
        ` - ${gap.length === 1 ? "it goes" : "they go"} on NOBODY's pick request, not the buyer's, so nobody is being asked for ${it}` +
        ` - chase the address, or is this an alias like Lou Direnzo #1-#2, which are Nick DiVirgilio's own and carry no gift at all?${lock}`,
      names,
    },
  ];
}

/**
 * Two live entries whose names are the same once case and spacing are set
 * aside.
 *
 * The fold rule is `collisionKind` in src/lib/names.ts and is not copied here:
 * that is the one place entry-name collision detection lives, and a second
 * copy would drift against the detector on /admin/entries. Only its `exact`
 * and `case` kinds are a daily line. `edit1` - one insertion, deletion,
 * substitution or transposition apart - is deliberately left to that screen:
 * `Tommybrads #1` and `tommybrads #2` are an edit apart and stay flagged
 * there, but they are the numbering convention's own neighbours and would put
 * a line in every day's twelve forever.
 *
 * `exact` and `case` together are a genuine equivalence - both mean the two
 * names fold to one string - so clustering against each cluster's first member
 * is exact, and three spellings of one name give ONE line rather than three
 * pairs.
 *
 * Both spellings are quoted VERBATIM, in quotes so edge whitespace is visible.
 * Names are stored verbatim and never normalised by the app; when Anthony
 * standardises one himself the override goes in the owner's notes, so it is
 * clear the app did not do it silently. This line asks; it never renames.
 */
function nameCollisionItems(s: OpsSnapshot, lock: string): ReportItem[] {
  const clusters: EntrySnapshot[][] = [];
  for (const e of s.entries) {
    // No `sameOwner` option: it only excuses a deliberate numbered set, and
    // that excuse applies to `edit1` alone - a kind neither kept below.
    const found = clusters.find((c) => {
      const kind = collisionKind(c[0].entryName, e.entryName);
      return kind === "exact" || kind === "case";
    });
    if (found) found.push(e);
    else clusters.push([e]);
  }

  return clusters
    .filter((c) => c.length > 1)
    .map((c) => {
      const names = c.map((e) => `"${e.entryName}" (${e.ownerName})`);
      return {
        text:
          `${c.length} live entries share one name once case and spacing are set aside: ${names.join(", ")}` +
          ` - her weekly import matches by name, so a pick can land on the wrong one - two entries, or one typed twice?${lock}`,
        names,
      };
    });
}

export function reportRosterIntegrity(s: OpsSnapshot): Report {
  // s.entries IS the live roster - the gatherer has already dropped voided
  // rows and entries whose owner is not confirmed - so every row here is one
  // somebody is playing, being billed for, or owes Lynne a number.
  const lock = lockSuffix(s);
  const items: ReportItem[] = [
    // The count gate leads: a mismatch means no whole-roster message goes out
    // at all, so every other line below would be chased by hand anyway.
    ...recipientCountItems(s, lock),
    ...freeEntryItems(s),
    ...lynneNumberItems(s, lock),
    ...giftedWithoutAddressItems(s, lock),
    ...nameCollisionItems(s, lock),
  ];

  // Empty items is NO ACTION, printed by renderReport. Never a "nothing to
  // report" item: that is a line of the twelve saying nothing.
  return items.length === 0 ? { job: JOB, items } : { job: JOB, items, preamble: PREAMBLE };
}
