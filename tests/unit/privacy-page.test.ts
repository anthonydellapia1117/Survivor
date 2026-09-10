import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// /privacy exists for Google's OAuth consent screen (the Gmail client cannot
// leave Testing without a privacy policy URL). It has to be fetchable without
// signing in, and players do not need it, so nothing in the app links to it.

const root = process.cwd();
const page = path.join(root, "src/app/privacy/page.tsx");

describe("the privacy page", () => {
  it("exists at /privacy, outside /admin, with no session check", () => {
    expect(existsSync(page)).toBe(true);
    const src = readFileSync(page, "utf8");
    expect(src).not.toMatch(/requireAdmin|getAdminSession/);
  });

  it("is not in the site header's tabs", () => {
    const header = readFileSync(path.join(root, "src/components/site-header.tsx"), "utf8");
    expect(header).not.toContain('"/privacy"');
  });

  it("gives the removal address", () => {
    expect(readFileSync(page, "utf8")).toContain("anthonydellapia@gmail.com");
  });
});
