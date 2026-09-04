// One owner's pick request for one week.
//
// The point of sending these per owner rather than one group mail: a
// four-entry owner should not have to remember their own entry names to reply.
// Each entry is named, with a line to write the pick on, so a reply is
// unambiguous about which entry took which team.
//
// Deadlines are listed as the tiers the week ACTUALLY has, derived from the
// schedule — not a fixed three. Week 1 has three (Wednesday, Thursday,
// Sat-Mon); week 12 has four, because of the Black Friday game. Hard-coding
// three would be wrong twice a season and is exactly the class of drift the
// deadline work removed.

import type { GameDay, GameRow, WeekRow } from "@/lib/data/types";
import {
  deadlineTier,
  pickDeadlineIso,
  type DeadlineTier,
} from "@/lib/deadlines";
import { normalizeAddress, sameAddress } from "./address";
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

export interface PickRequestOwner {
  id: string;
  /** How they are addressed — first name where there is one. */
  greetingName: string;
  email: string;
  /** Second address to copy, where somebody else plays entries this owner
   *  pays for. Null for nearly everyone. */
  ccEmail: string | null;
  entryNames: string[];
}

export interface BuiltEmail {
  ownerId: string;
  to: string;
  /** Empty when there is nobody to copy — the header is then omitted. */
  cc: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * The address to copy, or "" for none.
 *
 * An address equal to the recipient's is dropped rather than sent twice: the
 * owner's own address turning up here is a typo, and honouring it would put
 * two copies of the same mail in one inbox with no way to tell them apart.
 * Compared case-insensitively because mailbox case is not significant to any
 * provider this pool uses, and "Kris@" beside "kris@" is the same typo.
 */
export function ccAddress(email: string, ccEmail: string | null): string {
  const cc = normalizeAddress(ccEmail);
  return sameAddress(cc, email) ? "" : cc;
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
  owner: PickRequestOwner,
  week: WeekRow,
  games: Pick<GameRow, "week" | "dayOfWeek">[],
): BuiltEmail {
  const n = owner.entryNames.length;
  const doc: EmailDoc = {
    subject: `Week ${week.week} pick${n === 1 ? "" : "s"} — ${owner.greetingName} (${n} ${
      n === 1 ? "entry" : "entries"
    })`,
    eyebrow: "AD Survivor Pool",
    title: `Week ${week.week} picks`,
    greeting: `${owner.greetingName} —`,
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
        items: owner.entryNames,
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
    footer:
      "You are getting this because you have an entry in Anthony's group. Reply to this address — picks are not accepted anywhere else.",
  };

  return {
    ownerId: owner.id,
    to: owner.email,
    cc: ccAddress(owner.email, owner.ccEmail),
    subject: doc.subject,
    html: renderEmailHtml(doc),
    text: renderEmailText(doc),
  };
}

export interface PickRequestBatch {
  built: BuiltEmail[];
  /** Owners with entries but no address — they cannot be mailed at all. */
  skippedNoEmail: { id: string; name: string; entryCount: number }[];
  /**
   * Owners whose CC was dropped because it matched their own address.
   *
   * Reported rather than resolved in silence: the admin's only other evidence
   * would be the absence of a Cc line, and the person who was meant to be
   * copied finds out by never receiving anything. The batch already reports
   * "we could not do what you asked" for a missing owner address; a dropped
   * CC is the same kind of fact.
   */
  droppedCc: { id: string; name: string; address: string }[];
}

/**
 * Build the whole run. An owner with no email is reported, never guessed at:
 * the roster is the authority on addresses and inventing one is worse than
 * telling Anthony to go and ask.
 */
export function buildPickRequests(
  owners: (Omit<PickRequestOwner, "email" | "greetingName"> & {
    email: string | null;
    greetingName: string;
    fullName: string;
  })[],
  week: WeekRow,
  games: Pick<GameRow, "week" | "dayOfWeek">[],
): PickRequestBatch {
  const built: BuiltEmail[] = [];
  const skippedNoEmail: PickRequestBatch["skippedNoEmail"] = [];
  const droppedCc: PickRequestBatch["droppedCc"] = [];
  for (const o of owners) {
    if (o.entryNames.length === 0) continue;
    const email = o.email?.trim() ?? "";
    if (email === "") {
      skippedNoEmail.push({
        id: o.id,
        name: o.fullName,
        entryCount: o.entryNames.length,
      });
      continue;
    }
    // An address that survives trim() but not ccAddress() was dropped for
    // being the recipient's own. Recorded before the message is built so the
    // report does not depend on reading it back out of the result.
    const asked = normalizeAddress(o.ccEmail);
    if (asked !== "" && ccAddress(email, o.ccEmail) === "") {
      droppedCc.push({ id: o.id, name: o.fullName, address: asked });
    }
    built.push(
      buildPickRequest(
        {
          id: o.id,
          greetingName: o.greetingName,
          email,
          ccEmail: o.ccEmail,
          entryNames: o.entryNames,
        },
        week,
        games,
      ),
    );
  }
  return { built, skippedNoEmail, droppedCc };
}
