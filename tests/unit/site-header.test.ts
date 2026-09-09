import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { SiteHeader } from "../../src/components/site-header";

describe("site header, signed out", () => {
  it("never names the master pool's runner", () => {
    const html = renderToStaticMarkup(React.createElement(SiteHeader));
    expect(html).not.toMatch(/lynne/i);
    expect(html).toContain("Master List");
    expect(html).toContain('href="/master-list"');
    expect(html).not.toContain("Official Results");
  });
});
