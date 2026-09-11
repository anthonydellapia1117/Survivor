import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { SiteHeader } from "../../src/components/site-header";

describe("site header, signed out", () => {
  it("never names the master pool's runner", () => {
    const html = renderToStaticMarkup(React.createElement(SiteHeader));
    expect(html).not.toMatch(/lynne/i);
    expect(html).not.toContain("Official Results");
    // Assert-first, so the rule above cannot be passing on an empty nav: the
    // header really does render its tabs.
    expect(html).toContain('href="/grid"');
  });

  it("has no Master List tab: the list and the grid are one table", () => {
    // Merged 2026-09-11. The tab named a second page that no longer exists;
    // the address still redirects (tests/unit/nav-and-routes.test.ts).
    const html = renderToStaticMarkup(React.createElement(SiteHeader));
    expect(html).not.toContain("Master List");
    expect(html).not.toContain('href="/master-list"');
  });
});
