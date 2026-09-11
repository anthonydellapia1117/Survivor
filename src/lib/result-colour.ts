// What a result looks like, in one place.
//
// Set by Anthony on 2026-09-10, once game results were being stored:
//
//   won            subtle green
//   lost           yellow, and yellow on the entry name
//   two losses     the whole row red and struck through
//   no result      no fill at all
//
// So RED means OUT and YELLOW means damaged-but-alive. That is a shift from
// the older scheme, where a single loss was already red and there was nothing
// left to say "this entry is finished". The CSS tokens keep their names
// (--win, --tie, --loss) because they are colours; the meaning each carries
// lives here.
//
// This is the RESULT vocabulary. The broadcast-window vocabulary is
// src/lib/game-window.ts and the two must not collide on one screen -
// tests/unit/colour-systems.test.ts holds them apart.

import type { EntrySummary, PickResult } from "@/lib/data/types";
import type { TeamResult } from "@/lib/master-list";

/** What a single cell shows. "none" is a game with no stored result: no fill. */
export type ResultTone = "won" | "lost" | "bye" | "none";

/**
 * A pick's tone. A tie is a LOSS in this pool and so is a missed week - both
 * count in `losses` in v_entry_public - so all three read yellow. `pending`
 * and a null result are a game with nothing stored yet and get no fill.
 */
export function toneOfResult(result: PickResult | null | undefined): ResultTone {
  switch (result) {
    case "win":
      return "won";
    case "loss":
    case "tie_loss":
    case "missed":
      return "lost";
    case "bye":
      return "bye";
    default:
      return "none";
  }
}

/**
 * A team's own tone in a week, for a surface with no pick row behind it (the
 * Teams heatmap). Undefined is a game that is not final: no fill, never a
 * loss - `teamResults` leaves both teams of an unplayed game absent.
 */
export function toneOfTeamResult(result: TeamResult | undefined): ResultTone {
  if (result === "win") return "won";
  if (result === "loss" || result === "tie") return "lost";
  return "none";
}

/** Cell fill, text and border per tone. Written out in full so Tailwind sees every class. */
export const TONE_CELL_CLASS: Record<ResultTone, string> = {
  won: "bg-win/15 text-win border-win/30",
  lost: "bg-tie/20 text-tie border-tie/40",
  bye: "bg-bye/25 text-foreground/70 border-bye/40",
  none: "bg-transparent text-muted-foreground border-border",
};

/** The same tones as a background only, for a cell that carries its own text colour. */
export const TONE_FILL_CLASS: Record<ResultTone, string> = {
  won: "bg-win/15",
  lost: "bg-tie/20",
  bye: "bg-bye/25",
  none: "",
};

/** The legend's swatch per tone. Same colours, as a solid chip. */
/**
 * The tone as TEXT, for a surface that fills a cell but writes its own
 * content into it - the Teams table's counts. The fills are 1.1:1 apart
 * against the page, so on their own they are not a difference a phone in
 * daylight can show; the Grid gets away with it because TONE_CELL_CLASS
 * colours the team code too. This is that half, for the surfaces that need it
 * without the border and the background.
 */
export const TONE_TEXT_CLASS: Record<ResultTone, string> = {
  won: "text-win",
  lost: "text-tie",
  bye: "text-bye",
  none: "",
};

export const TONE_SWATCH_CLASS: Record<ResultTone, string> = {
  won: "bg-win/70",
  lost: "bg-tie/70",
  bye: "bg-bye/70",
  none: "border border-border",
};

/** The legend's swatch for a row that is out. */
export const OUT_SWATCH_CLASS = "bg-loss/70";

/**
 * A row's tone. "out" is the entry finished - two losses is the ordinary way
 * there, and it is always the way there in code: poolBucketOf returns Out at
 * `losses >= 2`, as does v_entry_standing. A published OUT and a repeated
 * team (an ELIMINATION in this pool, not a caution) reach it with fewer.
 */
export type RowTone = "out" | "lost" | "clean";

export function rowTone(e: Pick<EntrySummary, "status" | "losses">): RowTone {
  if (e.status === "eliminated") return "out";
  return e.losses > 0 ? "lost" : "clean";
}

/**
 * The whole row when the entry is out: red and struck through. Its cells take
 * no tone of their own, so the row reads as one finished thing rather than as
 * a run of wins with a loss somewhere in it.
 */
export const ROW_CLASS: Record<RowTone, string> = {
  out: "bg-loss/10 text-loss/90 line-through",
  lost: "",
  clean: "",
};

/** The entry name: yellow once the entry has a loss, red and struck once it is out. */
export const ROW_NAME_CLASS: Record<RowTone, string> = {
  out: "text-loss line-through",
  lost: "text-tie",
  clean: "",
};

/** Whether a cell on this row paints its own result tone. An out row does not. */
export function cellPaints(row: RowTone): boolean {
  return row !== "out";
}
