import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gameWindow, WINDOW_LABEL, WINDOW_ORDER, WINDOW_TOKEN } from "../../src/lib/game-window";
import { WindowLegend } from "../../src/components/schedule/window-legend";

// The season grid's colours (Anthony, 2026-09-09): TNF amber, SNF, MNF,
// Wed/Fri/Sat, Sunday daytime plain. The counts were verified against the
// live nfl_games table and are asserted here against the checked-in seed.

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("the window of a game", () => {
  it("follows the day, and on Sunday the ET kickoff hour", () => {
    expect(gameWindow({ dayOfWeek: "Thursday", kickoffAt: "2026-09-11T00:35:00Z" })).toBe("tnf");
    expect(gameWindow({ dayOfWeek: "Monday", kickoffAt: "2026-09-15T00:15:00Z" })).toBe("mnf");
    expect(gameWindow({ dayOfWeek: "Wednesday", kickoffAt: "2026-09-10T00:20:00Z" })).toBe("wfs");
    expect(gameWindow({ dayOfWeek: "Friday", kickoffAt: "2026-11-27T20:00:00Z" })).toBe("wfs");
    expect(gameWindow({ dayOfWeek: "Saturday", kickoffAt: "2026-12-19T21:30:00Z" })).toBe("wfs");
    // Sunday 1 PM EDT is 17:00Z; 4:25 PM is 20:25Z; 8:20 PM is 00:20Z next day.
    expect(gameWindow({ dayOfWeek: "Sunday", kickoffAt: "2026-09-13T17:00:00Z" })).toBeNull();
    expect(gameWindow({ dayOfWeek: "Sunday", kickoffAt: "2026-09-13T20:25:00Z" })).toBeNull();
    expect(gameWindow({ dayOfWeek: "Sunday", kickoffAt: "2026-09-14T00:20:00Z" })).toBe("snf");
    // 7:00 PM exactly counts; 6:59 does not. In November ET is UTC-5.
    expect(gameWindow({ dayOfWeek: "Sunday", kickoffAt: "2026-09-13T23:00:00Z" })).toBe("snf");
    expect(gameWindow({ dayOfWeek: "Sunday", kickoffAt: "2026-09-13T22:59:00Z" })).toBeNull();
    expect(gameWindow({ dayOfWeek: "Sunday", kickoffAt: "2026-11-16T00:00:00Z" })).toBe("snf"); // 7 PM EST
    expect(gameWindow({ dayOfWeek: "Sunday", kickoffAt: "2026-11-15T23:59:00Z" })).toBeNull(); // 6:59 PM EST
  });

  it("counts 19 TNF, 17 SNF, 17 MNF, 8 Wed/Fri/Sat and 211 plain across the 272-game seed", () => {
    const sql = read("supabase/migrations/20260822000014_nfl_schedule.sql");
    const rows = [...sql.matchAll(/\('2026_\d\d_[A-Z]+_[A-Z]+', (\d+), '([^']+)', '(\w+)', '([A-Z]+)', '([A-Z]+)'\)/g)];
    expect(rows).toHaveLength(272);
    const counts = { tnf: 0, snf: 0, mnf: 0, wfs: 0, plain: 0 };
    for (const r of rows) {
      // The seed writes Postgres' short offset ("+00"); the API serves the
      // full one ("+00:00"). Date() takes only the full form.
      const w = gameWindow({ dayOfWeek: r[3] as "Sunday", kickoffAt: r[2].replace(/\+00$/, "+00:00") });
      if (w === null) counts.plain += 1;
      else counts[w] += 1;
    }
    expect(counts).toEqual({ tnf: 19, snf: 17, mnf: 17, wfs: 8, plain: 211 });
    expect(counts.tnf + counts.snf + counts.mnf + counts.wfs + counts.plain).toBe(272);
  });
});

// ---------------------------------------------------------------- colours
type Rgb = [number, number, number];
const hex = (s: string): Rgb => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The token values of one theme block, with var() and color-mix() resolved the way the browser does (sRGB, linear). */
function tokensOf(block: string): Record<string, Rgb> {
  const raw = new Map<string, string>();
  for (const m of block.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)) raw.set(m[1], m[2].trim());
  const resolve = (name: string, depth = 0): Rgb => {
    if (depth > 5) throw new Error(`token ${name}: too deep`);
    const v = raw.get(name);
    if (!v) throw new Error(`token ${name}: missing`);
    if (/^#[0-9a-f]{6}$/i.test(v)) return hex(v);
    const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
    if (ref) return resolve(ref[1], depth + 1);
    const mix = /^color-mix\(in srgb, var\(--([a-z0-9-]+)\) (\d+)%, var\(--([a-z0-9-]+)\) (\d+)%\)$/.exec(v);
    if (mix) {
      const a = resolve(mix[1], depth + 1);
      const b = resolve(mix[3], depth + 1);
      const pa = Number(mix[2]) / 100;
      const pb = Number(mix[4]) / 100;
      expect(pa + pb).toBe(1);
      return [0, 1, 2].map((i) => Math.round(a[i] * pa + b[i] * pb)) as Rgb;
    }
    throw new Error(`token ${name}: cannot read "${v}"`);
  };
  const out: Record<string, Rgb> = {};
  for (const n of ["win", "loss", "tie", "bye", "primary", "snf", "mnf", "wfs"]) out[n] = resolve(n);
  return out;
}

describe("the window colours", () => {
  const css = read("src/app/globals.css");
  // The dark tokens are the default block; the light ones live under .light.
  const lightStart = css.indexOf(".light {");
  const dark = css.slice(0, lightStart);
  const light = css.slice(lightStart);

  it("are mapped for Tailwind and defined in both themes from existing tokens", () => {
    for (const t of ["snf", "mnf", "wfs"]) {
      expect(css).toContain(`--color-${t}: var(--${t});`);
      expect((css.match(new RegExp(`^\\s*--${t}:`, "gm")) ?? []).length).toBe(2);
    }
    expect(WINDOW_TOKEN).toEqual({ tnf: "tie", snf: "snf", mnf: "mnf", wfs: "wfs" });
  });

  it("collide with none of win, loss, bye or tie, nor with each other, in dark or light", () => {
    // 50 in RGB distance is a clearly different colour; the closest legitimate
    // pair on the site (win vs the teal Wed/Fri/Sat mix) sits above it.
    const MIN = 50;
    for (const [theme, block] of [["dark", dark], ["light", light]] as const) {
      const t = tokensOf(block);
      const windows: Record<string, Rgb> = { tnf: t.tie, snf: t.snf, mnf: t.mnf, wfs: t.wfs };
      const results: Record<string, Rgb> = { win: t.win, loss: t.loss, bye: t.bye };
      for (const [w, c] of Object.entries(windows)) {
        for (const [r, rc] of Object.entries(results)) {
          expect({ theme, window: w, result: r, far: dist(c, rc) >= MIN }).toEqual({ theme, window: w, result: r, far: true });
        }
        // TNF is the tie amber by design; the other three must differ from it.
        if (w !== "tnf") expect({ theme, window: w, vsTie: dist(c, t.tie) >= MIN }).toEqual({ theme, window: w, vsTie: true });
      }
      const names = Object.keys(windows);
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          expect({ theme, a: names[i], b: names[j], far: dist(windows[names[i]], windows[names[j]]) >= MIN }).toEqual({ theme, a: names[i], b: names[j], far: true });
        }
      }
    }
  });
});

describe("the legend", () => {
  it("is four grid-styled cells, TNF SNF MNF Wed/Fri/Sat, each in its own colour, above both schedule views", () => {
    const html = renderToStaticMarkup(React.createElement(WindowLegend));
    const labels = [...html.matchAll(/>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(WINDOW_ORDER.map((w) => WINDOW_LABEL[w]));
    expect(html).toContain("bg-tie/25");
    expect(html).toContain("bg-snf/25");
    expect(html).toContain("bg-mnf/25");
    expect(html).toContain("bg-wfs/25");
    const page = read("src/app/schedule/page.tsx");
    // Rendered once, before the season/games switch, so both views carry it.
    expect(page.indexOf("<WindowLegend />")).toBeGreaterThan(0);
    expect(page.indexOf("<WindowLegend />")).toBeLessThan(page.indexOf("{season ? ("));
    // The Games / Season grid toggle is a very small chip pair (Anthony,
    // 2026-09-09): 11px text, half-unit padding, never the body size.
    const toggle = page.slice(page.indexOf('href={`/schedule?week=${week}`}') - 400, page.indexOf("<WindowLegend />"));
    expect(toggle).toContain("text-[11px]");
    expect(toggle).toContain("px-2 py-0.5");
    expect(toggle).not.toContain("text-sm");
    expect(toggle).not.toContain("py-1.5");
    const grid = read("src/components/schedule/schedule-grid.tsx");
    expect(grid).toContain("WINDOW_CELL_CLASS[win]");
    // The frozen header and the scroll container are untouched.
    expect(grid).toContain('className="relative max-h-[75dvh] overflow-auto rounded-lg border border-border"');
    expect(grid).toContain('"sticky left-0 top-0 z-30');
  });
});
