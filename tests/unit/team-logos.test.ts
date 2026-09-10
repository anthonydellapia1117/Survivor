import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NFL_TEAMS } from "../../src/lib/standing";
import { ESPN_CODE, logoPath } from "../../src/lib/team-logos";
import { TeamLabel } from "../../src/components/team-label";

// 32 logos, fetched once and committed. Every one of our codes must resolve
// to a real file; the one code ESPN spells differently is mapped by hand.

describe("team logos", () => {
  it("maps WAS to WSH and every other code to itself", () => {
    expect(ESPN_CODE.WAS).toBe("WSH");
    for (const t of NFL_TEAMS) if (t.abbr !== "WAS") expect(ESPN_CODE[t.abbr]).toBe(t.abbr);
    expect(Object.keys(ESPN_CODE)).toHaveLength(32);
  });

  it("resolves all 32 of our codes to a committed PNG, 96px square", () => {
    const missing: string[] = [];
    for (const t of NFL_TEAMS) {
      const p = logoPath(t.abbr);
      if (!p) {
        missing.push(`${t.abbr}: no path`);
        continue;
      }
      const file = path.join(process.cwd(), "public", p);
      if (!existsSync(file) || statSync(file).size < 500) {
        missing.push(`${t.abbr}: ${p} missing or empty`);
        continue;
      }
      const head = readFileSync(file).subarray(0, 24);
      // PNG magic, then IHDR width and height.
      expect(head.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect([head.readUInt32BE(16), head.readUInt32BE(20)]).toEqual([96, 96]);
    }
    expect(missing).toEqual([]);
    expect(logoPath("WAS")).toBe("/logos/wsh.png");
    expect(readdirSync(path.join(process.cwd(), "public", "logos")).filter((f) => f.endsWith(".png"))).toHaveLength(32);
  });

  it("never calls ESPN at runtime for a logo", () => {
    // espn.com and the CDN behind it, a.espncdn.com. Comments are stripped
    // first, but not the "//" of a URL, or a fetch in a string would hide.
    // The one ESPN call in src is the admin scores prefill, which reads her
    // scoreboard and predates the logos; it is named here so a second caller
    // anywhere, or a logo fetch inside it, fails this.
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const full = path.join(dir, n);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const code = (f: string) => readFileSync(f, "utf8").replace(/(?<!:)\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const files = walk(path.join(process.cwd(), "src"));
    const espn = files.filter((f) => /espn[a-z]*\.com/i.test(code(f))).map((f) => path.relative(process.cwd(), f));
    // EXACTLY ONE file may name the feed's domain, and it is not a logo
    // fetch: src/lib/nfl/espn.ts builds the scoreboard URL and parses the
    // reply, and fetches nothing itself. The admin scores prefill used to
    // carry the URL too and now calls that module, so the domain is written
    // down once. The assertion below is the one that has always mattered and
    // is unchanged: nothing anywhere reaches the logo CDN.
    expect(espn).toEqual(["src/lib/nfl/espn.ts"]);
    expect(files.filter((f) => /espncdn|teamlogos/i.test(code(f)))).toEqual([]);
  });

  it("renders the logo beside the code, and the code alone for a code with no asset", () => {
    const html = renderToStaticMarkup(React.createElement(TeamLabel, { abbr: "WAS" }));
    expect(html).toContain('src="/logos/wsh.png"');
    expect(html).toContain(">WAS<");
    const none = renderToStaticMarkup(React.createElement(TeamLabel, { abbr: "XXX" }));
    expect(none).not.toContain("<img");
    expect(none).toContain(">XXX<");
  });

  it("is what the Teams page renders each team with", () => {
    // One place, not two: the per-entry availability grid was removed on
    // 2026-09-10 with the entry filter, so the week table's row label is the
    // only team name the page renders.
    const src = readFileSync(path.join(process.cwd(), "src/components/teams/teams-client.tsx"), "utf8");
    expect(src).toContain('from "@/components/team-label"');
    expect((src.match(/<TeamLabel abbr=\{t\.abbr\}/g) ?? []).length).toBe(1);
  });
});
