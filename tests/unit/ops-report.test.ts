import { describe, expect, it } from "vitest";
import { MAX_LINES, renderReport, reportSummary } from "../../scripts/ops/lib/report";

// Each item names itself in its own text, so "every name survives" is one
// assertion whether the item is shown whole or folded into the collapsed line.
const item = (n: number) => ({ text: `name${n} has no pick for week 1`, names: [`name${n}`] });

describe("the output contract the six Routines kept", () => {
  it("is the two words NO ACTION alone when there is nothing", () => {
    expect(renderReport({ job: "x", items: [] })).toEqual(["NO ACTION"]);
  });

  it("does not carry a preamble when there is nothing to say", () => {
    expect(renderReport({ job: "x", items: [], preamble: "check /admin/audit first" })).toEqual(["NO ACTION"]);
  });

  it("heads a report with NEEDS ANTHONY and prints each item once", () => {
    expect(renderReport({ job: "x", items: [item(1), item(2)] })).toEqual(["NEEDS ANTHONY", item(1).text, item(2).text]);
  });

  it("never passes twelve lines", () => {
    const out = renderReport({ job: "x", items: Array.from({ length: 40 }, (_, i) => item(i)) });
    expect(out.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it("keeps every name when it collapses - the cap yields to completeness", () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i));
    const out = renderReport({ job: "x", items });
    const joined = out.join("\n");
    for (let i = 0; i < 40; i++) {
      expect(joined, `name${i} was dropped to fit the cap`).toContain(`name${i}`);
    }
  });

  it("leads the collapsed line with the count", () => {
    const out = renderReport({ job: "x", items: Array.from({ length: 40 }, (_, i) => item(i)) });
    expect(out.at(-1)).toMatch(/^\d+ more: /);
  });

  it("still shows one item whole when the preamble eats the cap", () => {
    const out = renderReport({
      job: "x",
      preamble: "check /admin/audit for a payment_sweep_exclude row before acting",
      items: Array.from({ length: 40 }, (_, i) => item(i)),
    });
    expect(out[0]).toBe("NEEDS ANTHONY");
    expect(out[2]).toBe(item(0).text);
    expect(out.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it("says so plainly when a collapsed item carried no name", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ text: `item ${i}` }));
    expect(renderReport({ job: "x", items }).at(-1)).toMatch(/^\d+ more, see the run output$/);
  });
});

describe("reportSummary", () => {
  it("is NO ACTION when nothing is due", () => {
    expect(reportSummary({ job: "pick-gap", items: [] })).toBe("pick-gap: NO ACTION");
  });
  it("counts what is for Anthony", () => {
    expect(reportSummary({ job: "pick-gap", items: [item(1), item(2)] })).toBe("pick-gap: 2 for Anthony");
  });
});
