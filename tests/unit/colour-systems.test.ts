import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WINDOW_CELL_CLASS, WINDOW_TEXT_CLASS, WINDOW_TOKEN } from "../../src/lib/game-window";

// TWO COLOUR VOCABULARIES SHARE THIS APP AND MUST NOT BE CONFUSED.
//
//   the WINDOW vocabulary - tnf, snf, mnf, wfs - says which broadcast window a
//   game sits in. It is a fact about the television schedule and says nothing
//   about who won.
//
//   the RESULT vocabulary - win, loss, tie, bye, pending - says what happened
//   and what it cost.
//
// They were one token apart until 2026-09-11: TNF was literally `--tie`, so
// the amber on a Thursday cell of the season grid and the amber on "TIE - a
// loss in this pool" in the game board were the same value. The legend sits
// above BOTH schedule views, so a reader could meet an amber chip labelled TNF
// and an amber tie banner on one screen and reasonably conclude that amber
// means a loss - then misread all nineteen Thursday cells.
//
// The fix is structural, not a hue: each window owns its token, and no
// component mixes the two vocabularies. This proves the second half, which is
// the half a colour-distance test cannot see.

const ROOT = path.join(__dirname, "../..");
const read = (p: string): string => readFileSync(path.join(ROOT, p), "utf8");

const WINDOW_TOKENS = ["tnf", "snf", "mnf", "wfs"];
const RESULT_TOKENS = ["win", "loss", "tie", "bye", "pending"];

/** Source with comments removed, so prose ABOUT a class is not a use of it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Every Tailwind class in a file that colours from one of `tokens`. */
function tokenClasses(raw: string, tokens: string[]): string[] {
  const src = code(raw);
  const hits: string[] = [];
  for (const t of tokens) {
    // bg-tie, text-tie/70, border-tie/40, from-win ... but never bg-window or
    // a longer word that merely starts with the token.
    const re = new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|from|to|via|decoration|outline)-${t}(?![a-z0-9-])(?:\\/\\d+)?`, "g");
    hits.push(...(src.match(re) ?? []));
  }
  return [...new Set(hits)].sort();
}

describe("the window vocabulary and the result vocabulary", () => {
  it("share no token", () => {
    const used = new Set(Object.values(WINDOW_TOKEN));
    for (const t of RESULT_TOKENS) {
      expect({ token: t, usedAsAWindow: used.has(t as never) }).toEqual({ token: t, usedAsAWindow: false });
    }
    expect([...used].sort()).toEqual(WINDOW_TOKENS.slice().sort());
  });

  it("are each defined for Tailwind and in both themes", () => {
    const css = read("src/app/globals.css");
    for (const t of [...WINDOW_TOKENS, ...RESULT_TOKENS]) {
      expect(css, `--color-${t} is not mapped for Tailwind`).toContain(`--color-${t}: var(--${t});`);
      expect((css.match(new RegExp(`^\\s*--${t}:`, "gm")) ?? []).length, `--${t} is not defined in exactly two themes`).toBe(2);
    }
  });

  it("keeps the WINDOW classes to the season grid and the legend, with no result colour in either", () => {
    // The class STRINGS live in game-window.ts so Tailwind can see them whole;
    // the two components reach them through the map. So the check is that each
    // component speaks the window vocabulary and colours no result.
    for (const file of ["src/components/schedule/schedule-grid.tsx", "src/components/schedule/window-legend.tsx"]) {
      const src = read(file);
      expect(src, `${file} does not use the window classes`).toMatch(/WINDOW_(CELL|TEXT)_CLASS/);
      expect(tokenClasses(src, RESULT_TOKENS), `${file} must not colour a RESULT - it is showing a broadcast window`).toEqual([]);
    }
    // And the map itself is the only place a window class is written out.
    const src = read("src/lib/game-window.ts");
    expect(tokenClasses(src, WINDOW_TOKENS).sort()).toEqual(
      [...WINDOW_TOKENS.map((t) => `bg-${t}/25`), ...WINDOW_TOKENS.map((t) => `text-${t}`)].sort(),
    );
    expect(tokenClasses(src, RESULT_TOKENS), "game-window.ts must not name a result colour").toEqual([]);
  });

  it("keeps the RESULT classes to the game board, with no window colour in it", () => {
    const src = read("src/components/schedule/game-board.tsx");
    expect(tokenClasses(src, RESULT_TOKENS).length, "the game board colours no result").toBeGreaterThan(0);
    expect(tokenClasses(src, WINDOW_TOKENS), "the game board must not colour a broadcast window - it is showing results").toEqual([]);
  });

  it("keeps the RESULT classes to the three result surfaces, with no window colour in any of them", () => {
    // The Grid, the Master List and the Teams table all colour results now
    // (Anthony, 2026-09-10). None of them shows a broadcast window, so none
    // may name one - amber on a Thursday cell and amber on a losing pick
    // would be the same collision one page further along.
    for (const file of [
      "src/components/grid/grid-view.tsx",
      "src/components/master-list/master-list-table.tsx",
      "src/components/teams/teams-client.tsx",
    ]) {
      const src = read(file);
      expect(src, `${file} must take its result colours from the module`).toContain('from "@/lib/result-colour"');
      expect(tokenClasses(src, WINDOW_TOKENS), `${file} must not colour a broadcast window - it is showing results`).toEqual([]);
    }
    // And the result module names no window colour either.
    const src = read("src/lib/result-colour.ts");
    expect(tokenClasses(src, RESULT_TOKENS).length, "result-colour.ts is where the result classes live").toBeGreaterThan(0);
    expect(tokenClasses(src, WINDOW_TOKENS), "result-colour.ts must not name a window colour").toEqual([]);
  });

  it("names the window classes from the tokens, so a class cannot drift from its token", () => {
    for (const [w, token] of Object.entries(WINDOW_TOKEN)) {
      expect(WINDOW_CELL_CLASS[w as keyof typeof WINDOW_CELL_CLASS]).toBe(`bg-${token}/25`);
      expect(WINDOW_TEXT_CLASS[w as keyof typeof WINDOW_TEXT_CLASS]).toBe(`text-${token}`);
    }
  });
});
