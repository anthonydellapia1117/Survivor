import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import nextConfig from "../../next.config";
import { RECORDS_PAGES } from "../../src/components/records-nav";

// Five top-level tabs, Records a parent of two subpages, and every old path
// redirecting rather than 404ing.
//
// Six until 2026-09-11, when the Master List and the Grid became one table at
// /grid. The tab went; the ADDRESS did not - it is in emails, in Anthony's
// messages and in people's history, and a 404 would strand every one of them.

const app = (p: string) => path.join(process.cwd(), "src/app", p);

describe("the top-level tabs", () => {
  it("are Dashboard, Grid, Schedule, Teams, Records, in that order, with no Master List tab", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/site-header.tsx"), "utf8");
    const block = src.slice(src.indexOf("const links = ["), src.indexOf("];", src.indexOf("const links = [")));
    const hrefs = [...block.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/", "/grid", "/schedule", "/teams", "/records/roster"]);
    expect(block).not.toContain('"/master-list"');
    expect(block).toContain('label: "Records"');
    expect(block).toContain('prefix: "/records"');
    expect(block).not.toContain('"/entries"');
    expect(block).not.toContain('"/2025"');
  });

  it("puts Roster and 2025 under Records, each with a page", () => {
    expect(RECORDS_PAGES.map((p) => p.label)).toEqual(["Roster", "2025"]);
    for (const p of RECORDS_PAGES) expect({ href: p.href, page: existsSync(app(`${p.href}/page.tsx`)) }).toEqual({ href: p.href, page: true });
    const html = renderToStaticMarkup(React.createElement(RecordsNavForTest));
    expect(html).toContain('href="/records/roster"');
    expect(html).toContain('href="/records/2025"');
  });
});

// usePathname needs the app router; a static render of the nav goes through
// a thin stand-in that renders the same links.
function RecordsNavForTest() {
  return React.createElement(
    "nav",
    null,
    RECORDS_PAGES.map((p) => React.createElement("a", { key: p.href, href: p.href }, p.label)),
  );
}

describe("the old paths", () => {
  it("redirect permanently to their new homes, and the old pages are gone so nothing shadows the redirect", async () => {
    const redirects = await nextConfig.redirects!();
    const byPath = new Map(redirects.map((r) => [r.source, r]));
    expect(byPath.get("/entries")).toMatchObject({ destination: "/records/roster", permanent: true });
    expect(byPath.get("/2025")).toMatchObject({ destination: "/records/2025", permanent: true });
    expect(byPath.get("/records")).toMatchObject({ destination: "/records/roster" });
    // The merge, 2026-09-11. /master-list REDIRECTS and never 404s, and so do
    // the two older names for it - one hop each, straight to the table.
    expect(byPath.get("/master-list")).toMatchObject({ destination: "/grid", permanent: true });
    expect(byPath.get("/lynne")).toMatchObject({ destination: "/grid", permanent: true });
    expect(byPath.get("/official")).toMatchObject({ destination: "/grid", permanent: true });
    // And the page is gone, so nothing shadows the redirect with a 404 or a
    // second copy of a table.
    expect(existsSync(app("master-list/page.tsx"))).toBe(false);
    for (const r of ["/entries", "/2025", "/records", "/master-list", "/lynne", "/official"]) {
      const dest = byPath.get(r)!.destination;
      // A destination with no page would 404 after the redirect.
      expect({ from: r, to: dest, page: existsSync(app(`${dest}/page.tsx`)) }).toEqual({ from: r, to: dest, page: true });
    }
    expect(existsSync(app("entries/page.tsx"))).toBe(false);
    expect(existsSync(app("2025/page.tsx"))).toBe(false);
  });
});
