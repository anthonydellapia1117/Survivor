import { describe, expect, it, vi } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

/** The rows only: the legend's swatches use the same tokens and are not cells. */
const rowsOf = (html: string) => html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));

// THE ONE TABLE at /grid: every row of the master pool's newest sheet, her
// NO. and her NAMES as two columns, the week cells drawn the way the Grid
// draws them. It must never name the runner, never show an uploaded filename,
// never print a per-entry rate, and NEVER reveal a pick the public view still
// masks.
//
// This file was master-list-page.test.ts until 2026-09-11. The page merged
// into the Grid; every rule it held moved with it, translated to the markup
// the merged table renders. Nothing was dropped.
//
// Her published total is switchable so the match sentence can be exercised
// in both directions: null is a supported state (a sheet loaded before her
// figures are entered) and must not read as a match.
const potState = vi.hoisted(() => ({ poolEntryCount: 1318 as number | null }));

vi.mock("../../src/lib/data", () => ({
  getData: () => ({
    getMasterList: async () => ({
      loadedAt: "2026-09-08T21:53:00Z",
      rows: [
        { no: 1, names: "Lynne P", cells: { "Week 1": "Dallas" }, entryId: null },
        { no: 983, names: "Adriana Flacco ", cells: { "Week 1": "Dallas" }, entryId: "e-983" },
        { no: 1005, names: "E.A.T.", cells: {}, entryId: "e-1005" },
        { no: 1089, names: "Andrew Dicicco #1", cells: {}, entryId: "e-1089" },
        // Published, revealed, and its game has NOT been played. It must show
        // her team with NO fill at all - the case that catches a colour
        // painted from her text instead of from a stored result.
        { no: 1200, names: "Unscored Row", cells: { "Week 2": "Buffalo" }, entryId: null },
        // Her words where the cell is not a team. 1300 is hers alone; 1301 is
        // one of OURS and we hold a Week 2 pick for it, which is the case
        // that used to read "she has published nothing" while she had in fact
        // published OUT. Her double space is hers and is kept verbatim.
        { no: 1300, names: "Amy  3", cells: { "Week 1": "OUT" }, entryId: null },
        { no: 1301, names: "Ours With Her Note", cells: { "Week 2": "OUT" }, entryId: "e-1301" },
      ],
    }),
    getPot: async () => ({
      entryCount: 121,
      poolEntryCount: potState.poolEntryCount,
      poolFreeCount: 46,
      poolPaidCount: 1272,
      poolPotCents: 2862000,
    }),
    getGridCells: async () => [
      { entryId: "e-983", week: 1, team: "PHI", result: null, late: false, submittedAt: "2026-09-08T00:00:00Z", source: "text", resultSource: null },
      { entryId: "e-1005", week: 1, team: "LOCKED", result: null, late: true, submittedAt: "2026-09-08T00:00:00Z", source: "email", resultSource: null },
      { entryId: "e-1089", week: 2, team: "BUF", result: null, late: false, submittedAt: "2026-09-08T00:00:00Z", source: "text", resultSource: null },
      { entryId: "e-1301", week: 2, team: "NYJ", result: null, late: false, submittedAt: "2026-09-08T00:00:00Z", source: "text", resultSource: null },
      { entryId: "someone-else", week: 7, team: "KC", result: null, late: false, submittedAt: "2026-09-08T00:00:00Z", source: "text", resultSource: null },
    ],
    // Week 1 is final and Dallas lost it; Week 2 has not been played. Both
    // shapes matter: the first is what a colour is allowed to come from, the
    // second is what must stay unfilled.
    getSchedule: async () => [
      { id: "g1", week: 1, kickoffAt: "2026-09-13T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "DAL", homeTeam: "PHI", homeScore: 24, awayScore: 17, status: "final", revealOverride: null, network: "FOX" },
      { id: "g2", week: 2, kickoffAt: "2026-09-20T17:00:00Z", dayOfWeek: "Sunday", awayTeam: "BUF", homeTeam: "NYJ", homeScore: null, awayScore: null, status: "scheduled", revealOverride: null, network: "CBS" },
    ],
    // The merged page renders the whole table, so it loads our roster and the
    // weeks as well. Only 983, 1005 and 1089 are ours.
    getEntries: async () => [
      { id: "e-983", entryName: "Adriana Flacco #1", nameIsDefault: false, ownerId: "o1", ownerName: "Adriana Flacco", wins: 0, losses: 0, livesRemaining: 2, status: "active", byeUsed: false, teamsUsed: ["PHI"], lastScoredWeek: null, isAdminEntry: false },
      { id: "e-1005", entryName: "E.A.T.", nameIsDefault: false, ownerId: "o2", ownerName: "Ed", wins: 0, losses: 0, livesRemaining: 2, status: "active", byeUsed: false, teamsUsed: [], lastScoredWeek: null, isAdminEntry: false },
      { id: "e-1089", entryName: "Andrew DiCicco #1", nameIsDefault: false, ownerId: "o3", ownerName: "Andrew DiCicco", wins: 0, losses: 0, livesRemaining: 2, status: "active", byeUsed: false, teamsUsed: ["BUF"], lastScoredWeek: null, isAdminEntry: false },
      { id: "e-1301", entryName: "Ours With Her Note", nameIsDefault: false, ownerId: "o4", ownerName: "Owner Four", wins: 0, losses: 0, livesRemaining: 2, status: "active", byeUsed: false, teamsUsed: ["NYJ"], lastScoredWeek: null, isAdminEntry: false },
    ],
    getWeeks: async () => [1, 2].map((week) => ({
      week,
      windowLabel: "thu_fri",
      deadlineAt: "2026-09-11T18:00:00Z",
      earlyDeadlineAt: "2026-09-09T18:00:00Z",
      lateDeadlineAt: "2026-09-11T18:00:00Z",
      resultsFinal: false,
      confirmed: true,
    })),
    getLynneImports: async () => [
      {
        id: "im-2",
        week: 2,
        filename: "Lynne Week 2 results.xlsx",
        fileSha256: "b",
        importedAt: "2026-09-22T16:00:00Z",
        rowCount: 2,
        matchedCount: 2,
        unmatched: [],
        variances: [
          {
            type: "result_mismatch",
            entryName: "E.A.T.",
            lynne: { team: "Seattle", result: "L" },
            local: { team: "SEA", result: "W" },
          },
        ],
        rows: [{ entry: "1005 E.A.T.", team: "Seattle", result: "L" }],
      },
      {
        id: "im-1",
        week: 1,
        filename: "lynne_week1.csv",
        fileSha256: "a",
        importedAt: "2026-09-15T16:00:00Z",
        rowCount: 1,
        matchedCount: 1,
        unmatched: [],
        variances: [],
        rows: [],
      },
    ],
  }),
}));

import GridPage from "../../src/app/grid/page";

const render = async () => renderToStaticMarkup(await GridPage());

describe("the one table, signed out", () => {
  it("no longer carries her four figures - they open the dashboard now - and still never a rate", async () => {
    // The figures moved to the dashboard so the site opens on them; this page
    // keeps the one thing only it can say, how her published total sits
    // against the rows actually on the sheet. The rate guard stays here as
    // well as there: it must appear on no public route at all.
    const html = await render();
    expect(html).toContain("The Grid");
    expect(html).not.toContain("Total in Pool");
    expect(html).not.toContain("Total Payout");
    for (const s of ["$22.50", "22.5", "$21.71", "21.71", "2250", "2171"]) expect(html).not.toContain(s);
    // The shape of the rate, not the shape of a URL: /entry/<id> is the link
    // to one of our entry pages and always has been.
    expect(html).not.toMatch(/per (paying )?entry|apiece|each entry|\$?\d[\d.,]*\s*(?:per|\/)\s*entry\b/i);
  });

  it("reports the gap between her published total and the rows on the sheet, correcting neither", async () => {
    // 1,318 published against 4 mocked rows: both numbers, no arithmetic on
    // either (CLAUDE.md - report the variance, never auto-resolve).
    const html = await render();
    expect(html).toContain("1,318");
    expect(html).toMatch(/this sheet carries 7 rows/);
    expect(html).not.toContain("matches the rows on this sheet");
  });

  it("says her total matches the sheet only when she has published one and it does", async () => {
    try {
      // No published total: nothing to compare, so no match and no variance.
      potState.poolEntryCount = null;
      let html = await render();
      expect(html).not.toContain("matches the rows on this sheet");
      expect(html).not.toContain("this sheet carries");
      // Published and equal to the 4 mocked rows: now it is a match.
      potState.poolEntryCount = 7;
      html = await render();
      expect(html).toContain("matches the rows on this sheet");
    } finally {
      potState.poolEntryCount = 1318;
    }
  });

  it("never shows the uploaded filename or the runner's name, and keeps the weekly files", async () => {
    const html = await render();
    expect(html).not.toMatch(/lynne(?! P)/i);
    // HER uploaded filenames, which are what must never reach a reader. The
    // page's own export endpoint is ours and is named on its link.
    expect(html).not.toContain("Lynne Week 2 results.xlsx");
    expect(html).not.toContain("lynne_week1.csv");
    expect(html).not.toContain(".csv");
    expect(html).toContain("E.A.T.");
    // The weekly result files came across with the table they belong to.
    expect(html).toContain("W1");
  });

  it("colours a cell only where a result is stored, and the reveal gate still decides what is there to colour", async () => {
    // Week 1 is final and Dallas lost it; Week 2 is not played. Two rows show
    // Dallas (hers at NO. 1 and the varying cell at 983), so exactly two cells
    // may carry the losing fill and nothing may carry a winning one.
    const html = await render();
    const rows = rowsOf(html);
    expect((rows.match(/bg-tie\/20/g) ?? []).length, "one fill per revealed, scored cell").toBe(2);
    expect(rows, "nothing in this fixture won").not.toContain("bg-win/15");
    // Her Week 2 Buffalo is revealed and unscored: the team is shown and the
    // cell carries no fill. A colour here would be a claim about a game that
    // has not been played.
    // TWICE: hers on 1200, published and unscored, and ours on 1089, where
    // she has published nothing. Counting matters - one of them alone would
    // let the published cell vanish while the overlay kept the assertion
    // green, which is exactly what happened the first time this was written.
    expect((rows.match(/>BUF</g) ?? []).length, "hers on 1200 and ours on 1089").toBe(2);
    expect(rows.match(/border-dashed[^>]*>BUF</g) ?? [], "only ours is dashed").toHaveLength(1);
    expect((rows.match(/bg-(?:tie|win|bye)\/\d+/g) ?? []).length, "no fill on an unscored cell").toBe(2);
    // Week 2 is scheduled and she has published no Week 2 cell: our BUF sits
    // in the cell marked as ours, dashed and unfilled.
    expect(html).toContain("ours");
    expect(html).toMatch(/border-dashed[^>]*>BUF/);
    // 1005's pick is masked by the public view, so there is no cell to colour
    // and no colour can leak the pick. A fill would be a leak by itself: it
    // would say a scored game sits behind a cell the reader cannot see.
    expect(html).not.toContain(">SEA<");
    // One loss puts yellow on the entry name; nothing here is out, so no row
    // is red or struck.
    expect(html).toContain("text-tie");
    // Struck rows are exactly the two she wrote OUT on - her word is
    // authoritative and eliminates the row whatever we compute. Nothing else
    // in this fixture is out, and the legend's own swatch label is not a row.
    const struck = (rowsOf(html).match(/line-through/g) ?? []).length;
    expect(struck, "1300 and 1301, row class and name class each").toBe(4);
    expect((rowsOf(html).match(/bg-loss\/10/g) ?? []).length, "the two OUT rows").toBe(2);
  });

  it("lists every row verbatim in her numbering, marks ours, reports a variance and never reveals a masked pick", async () => {
    const html = await render();
    // Her NAMES verbatim, trailing space and her own spelling included, and
    // her NO. in its own column beside each.
    expect(html).toContain("Lynne P");
    expect(html).toContain("Adriana Flacco ");
    expect(html).toContain("Andrew Dicicco #1");
    for (const no of ["1", "983", "1005", "1089", "1200", "1300", "1301"]) {
      expect(html, `NO. ${no}`).toMatch(new RegExp(`tabular-nums[^>]*">${no}<`));
    }
    // NO. ASCENDING is what the page opens on: 1, 983, 1005, 1089 in that
    // order down the markup.
    const order = ["Lynne P", "Adriana Flacco ", "E.A.T.", "Andrew Dicicco #1", "Unscored Row", "Amy  3", "Ours With Her Note"].map((n) => html.indexOf(n));
    expect(order, "rows in her numbering").toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("7 of 7 entries");
    // Her Dallas against our PHI on 983: a variance. Hers stays in the cell -
    // as the team code, because the week columns are drawn the way the Grid
    // draws them - and ours is reported beside it. NEITHER is changed
    // (CLAUDE.md, Who is the authority on what).
    expect(html).toContain("ours PHI");
    expect(rowsOf(html)).toMatch(/>DAL</);
    // 1089 has our Week 2 pick and she has no Week 2 cell: ours only, marked.
    expect(html).toMatch(/border-dashed[^>]*>BUF/);
    // 1005's pick is still masked by the public view: nothing about it, and
    // no LOCKED chip either - her sheet simply carries no cell.
    expect(html).not.toContain("LOCKED");
    expect(html).not.toContain(">SEA<");
    // Someone else's cell belongs to no row here.
    expect(html).not.toContain(">KC<");
    // TWO layers hold the gate on the overlay, and dropping either alone
    // leaves the other holding - which is why removing one is invisible to a
    // rendered assertion. Both are pinned here, deliberately.
    expect(read("src/components/grid/grid-view.tsx"), "the overlay map drops a locked pick")
      .toContain("if (c.team === LOCKED_TEAM) continue;");
    expect(read("src/lib/master-list.ts"), "matchTeams treats a locked pick as absent")
      .toContain("const o = ours === LOCKED_TEAM ? undefined : ours;");
  });

  it("opens on Everyone, on her numbering", async () => {
    const html = await render();
    expect(html).toContain("Everyone");
    expect(html).toContain("Our group");
    // Her whole sheet is the default: all four rows, including the one that
    // is not ours.
    expect(html).toContain("Lynne P");
    expect(html).toMatch(/aria-sort="ascending"[^>]*>[\s\S]{0,200}?NO\./);
    expect((html.match(/aria-sort="none"/g) ?? []).length, "Name and both weeks unsorted").toBe(3);
  });

  it("shows her words where a cell is not a team, and never calls that an empty week", async () => {
    // Her OUT is authoritative and it is how a reader sees WHICH WEEK she
    // declared a row out - the row badge alone cannot say. And where we also
    // hold a pick, her words must sit beside ours: the ours-only chip says
    // "not on the published sheet yet", which would be false.
    const html = await render();
    const rows = rowsOf(html);
    expect((rows.match(/>OUT</g) ?? []).length, "hers on 1300 and 1301, plus each row badge").toBeGreaterThanOrEqual(2);
    // 1301 is ours, she published OUT for Week 2, and we hold NYJ. Both are
    // shown, in one cell, and it is NOT the dashed ours-only chip.
    expect(rows).toMatch(/OUT<[\s\S]{0,120}?ours NYJ/);
    expect(rows, "her published note must not be drawn as an unpublished week")
      .not.toMatch(/border-dashed[^>]*>NYJ</);
    // Her words carry no result colour: there is no team to have a result.
    expect(rows).not.toMatch(/bg-(?:tie|win)\/\d+[^>]*>[\s\S]{0,40}?OUT</);
  });

  it("shows her NAMES whitespace-verbatim, in the CSS and not just in the string", async () => {
    // THE FIRST VERSION OF THIS WAS FAKE. It asserted the markup CONTAINED
    // "Adriana Flacco " - and the trailing space is in React's output whatever
    // the CSS does. HTML collapses runs of whitespace by default, so the page
    // rendered `Amy  3` as `Amy 3` while the test stayed green. Her sheet
    // carries both, Lynne matches strings exactly, and names are verbatim
    // (CLAUDE.md). The class is what makes it true, so the class is asserted.
    const html = await render();
    expect(html).toContain("Amy  3");
    expect(html).toContain("Adriana Flacco ");
    const nameSpans = html.match(/<span class="[^"]*font-medium[^"]*">(?:Amy  3|Adriana Flacco )</g) ?? [];
    expect(nameSpans.length, "both of her spaced names render through a name span").toBe(2);
    for (const span of nameSpans) {
      expect(span, "whitespace-pre keeps her spacing; truncate would collapse it").toContain("whitespace-pre");
      expect(span, "truncate carries whitespace-nowrap and would collapse her runs of spaces").not.toContain("truncate");
    }
  });

  it("sorts a week by what its cell SHOWS, overlay included", async () => {
    // A cell reading "BUF / ours" is a visible team. Sorting by that week used
    // to drop it among the twelve hundred genuinely blank rows, because the
    // sort key was built from her published cells alone and our overlay is a
    // separate map. Found by running the component, not by reading it.
    const { sortRows } = await import("@/lib/grid-sort");
    // The rule lives in weekKeys, which is tested on its own including the
    // precedence; here it is only that the table really uses it.
    expect(read("src/components/grid/grid-view.tsx")).toContain("weekKeys(hers, oursByWeek)");
    const rows = [
      { no: 1089, name: "ours only", teamByWeek: new Map([[2, "BUF"]]) },
      { no: 1, name: "blank", teamByWeek: new Map<number, string>() },
      { no: 1200, name: "hers", teamByWeek: new Map([[2, "BUF"]]) },
    ];
    for (const dir of ["asc", "desc"] as const) {
      expect({ dir, nos: sortRows(rows, { week: 2 }, dir).map((r) => r.no) }).toEqual({
        dir,
        nos: [1089, 1200, 1],
      });
    }
  });

  it("makes every header sort, and really wires each one to the sort", async () => {
    // MARKUP ALONE IS NOT ENOUGH and this test found that out: deleting the
    // onClick handlers left a green run, because a header stripped of its
    // handler is still a <button> inside a <th aria-sort>. So the rendered
    // shape is checked AND the wiring is - one header button per column, each
    // calling onHeaderClick with its own key.
    const html = await render();
    const headerButtons = html.match(/<th[^>]*aria-sort[^>]*>\s*<button/g) ?? [];
    expect(headerButtons.length, "NO., Name and both weeks").toBe(4);

    const src = read("src/components/grid/grid-view.tsx");
    for (const key of ['onHeaderClick("no")', 'onHeaderClick("name")', "onHeaderClick({ week: w.week })"]) {
      expect(src, `${key} must be wired to a header`).toContain(`onClick={() => ${key}}`);
    }
    // And the handler does the one thing it is for.
    expect(src).toMatch(/function onHeaderClick[\s\S]{0,120}setSort\(\(s\) => nextSort\(s, key\)\)/);
  });
});
