// One RECIPIENT's pick request for one week.
//
// The point of sending these per person rather than one group mail: a
// four-entry owner should not have to remember their own entry names to reply.
// Each entry is named, with a line to write the pick on, so a reply is
// unambiguous about which entry took which team.
//
// The unit is the recipient, not the owner — see recipients.ts. A giftee gets
// their own message listing only the entries they play, so nobody reads a list
// of four and works out which half is theirs, and replies come back one to
// one instead of two people answering on the same thread.
//
// Deadlines are listed as the tiers the week ACTUALLY has, derived from the
// schedule — not a fixed three. Week 1 has three (Wednesday, Thursday,
// Sat-Mon); week 12 has four, because of the Black Friday game. Hard-coding
// three would be wrong twice a season and is exactly the class of drift the
// deadline work removed.

import type { GameDay, GameRow, WeekRow } from "@/lib/data/types";
import {
  recipientsForPicks,
  type Recipient,
  type RecipientOwner,
  type RecipientSplit,
} from "./recipients";
import {
  deadlineTier,
  pickDeadlineIso,
  type DeadlineTier,
} from "@/lib/deadlines";
import {
  renderEmailHtml,
  renderEmailText,
  type EmailDoc,
  type EmailRow,
} from "./template";

/**
 * Deadlines for a player carry the weekday first — "Tue Sep 8" is what someone
 * acts on; "Sep 8" makes them go and look at a calendar. The shared
 * formatEtDateTime drops the weekday, and other screens depend on that shape,
 * so this formats locally rather than changing it underneath them.
 */
const DEADLINE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDeadlineForPlayer(iso: string): string {
  const p = Object.fromEntries(
    DEADLINE_FMT.formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod} ET`;
}

/** Anthony's cell, on every message so a player can always reach him. */
export const CONTACT_PHONE = "215-384-8335";
const FROM = "— Anthony";

/** A representative game day per tier, to drive the shared derivation. */
const TIER_DAY: Record<DeadlineTier, GameDay> = {
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  late: "Sunday",
};

/** How each tier is described to a player, in their terms not the schema's. */
const TIER_DESCRIPTION: Record<DeadlineTier, string> = {
  wed: "If your team plays Wednesday",
  thu: "If your team plays Thursday",
  fri: "If your team plays Friday",
  late: "If your team plays Sat, Sun or Mon",
};

export interface BuiltEmail {
  /** Stable id for this MESSAGE. One owner can now produce several. */
  key: string;
  ownerId: string;
  /** Who pays for the entries listed. Shown so the admin can see at a glance
   *  that Chas's message hangs off Kris's row. */
  ownerName: string;
  kind: "owner" | "player";
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * The deadline tiers in play for a week, earliest first, as display rows.
 * Exported because a recap or standings mail wants the same list.
 */
export function deadlineRows(
  week: WeekRow,
  games: Pick<GameRow, "week" | "dayOfWeek">[],
): EmailRow[] {
  const present = new Set(
    games
      .filter((g) => g.week === week.week)
      .map((g) => deadlineTier(g.dayOfWeek)),
  );
  // Sat-Mon is always offered: it is the week's full lock, and it governs an
  // entry that has not picked at all.
  present.add("late");
  return (["wed", "thu", "fri", "late"] as const)
    .filter((t) => present.has(t))
    .map((t) => ({
      label: TIER_DESCRIPTION[t],
      value: formatDeadlineForPlayer(
        pickDeadlineIso(TIER_DAY[t], week.earlyDeadlineAt, week.lateDeadlineAt),
      ),
      accent: undefined,
    }));
}

export function buildPickRequest(
  recipient: Recipient,
  week: WeekRow,
  games: Pick<GameRow, "week" | "dayOfWeek">[],
): BuiltEmail {
  const names = recipient.entries.map((e) => e.entryName);
  const n = names.length;
  const gifted = recipient.kind === "player";
  const doc: EmailDoc = {
    subject: `Week ${week.week} pick${n === 1 ? "" : "s"} — ${recipient.greetingName} (${n} ${
      n === 1 ? "entry" : "entries"
    })`,
    eyebrow: "AD Survivor Pool",
    title: `Week ${week.week} picks`,
    greeting: `${recipient.greetingName} —`,
    blocks: [
      {
        kind: "lead",
        text:
          n === 1
            ? `Reply to this email with your team for Week ${week.week}. One team, and you cannot use it again all season.`
            : `Reply to this email with a team for each of your ${n} entries. Each entry is separate — same team on more than one is fine, but no entry can reuse a team it has already played.`,
      },
      {
        kind: "fill",
        caption: n === 1 ? "Your entry" : `Your entries (${n})`,
        items: names,
      },
      {
        kind: "rows",
        caption: "Deadlines",
        note: "Your deadline is the one for the day YOUR team plays.",
        rows: deadlineRows(week, games),
      },
      {
        kind: "signoff",
        from: FROM,
        phoneLabel: "Questions or a late change — text me:",
        phone: CONTACT_PHONE,
      },
    ],
    // A giftee is told whose entries these are, because otherwise a mail
    // listing two names they recognise arrives from someone they may not have
    // heard from about this pool. The owner's own message keeps the original
    // wording — nothing about their experience changed.
    footer: gifted
      ? `You are getting this because ${recipient.ownerName} put ${
          n === 1 ? "an entry" : "these entries"
        } in your name in Anthony's group — ${
          n === 1 ? "the pick is" : "the picks are"
        } yours to make. Reply to this address; picks are not accepted anywhere else.`
      : "You are getting this because you have an entry in Anthony's group. Reply to this address — picks are not accepted anywhere else.",
  };

  return {
    key: recipient.key,
    ownerId: recipient.ownerId,
    ownerName: recipient.ownerName,
    kind: recipient.kind,
    to: recipient.email,
    subject: doc.subject,
    html: renderEmailHtml(doc),
    text: renderEmailText(doc),
  };
}

export interface PickRequestBatch {
  built: BuiltEmail[];
  /** Owners who play entries themselves but have no address. */
  skippedNoEmail: RecipientSplit["ownersWithoutEmail"];
  /** Gifted entries with no player address — somebody else plays them and
   *  the roster cannot reach them. The gap to chase. */
  giftedWithoutEmail: RecipientSplit["giftedWithoutEmail"];
}

/**
 * Build the whole run, one message per RECIPIENT.
 *
 * Nothing here guesses at an address: an owner with none is reported, and a
 * gifted entry with none is reported separately, because the person to go and
 * ask is a different person.
 */
export function buildPickRequests(
  owners: RecipientOwner[],
  week: WeekRow,
  games: Pick<GameRow, "week" | "dayOfWeek">[],
): PickRequestBatch {
  const split = recipientsForPicks(owners);
  return {
    built: split.recipients.map((r) => buildPickRequest(r, week, games)),
    skippedNoEmail: split.ownersWithoutEmail,
    giftedWithoutEmail: split.giftedWithoutEmail,
  };
}
