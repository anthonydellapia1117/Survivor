// Finding the thread a draft replies into.
//
// The entry list to Lynne is a reply on her "Survivor - DellaPia | 2026 Entry
// List" thread. On 2026-09-11 the command reported that thread "not found"
// while it sat in the mailbox with exactly that subject: the query was the
// subject IN QUOTES, and Gmail treats `|` as an operator even inside a quoted
// phrase, so it matched nothing. Probed against the live mailbox: 0 threads for
// the quoted form, 2 for the words.
//
// A subject is free text Anthony writes. Any punctuation he uses has to
// survive, so the query carries WORDS and the exactness comes from comparing
// the thread's own subject afterwards.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeSubject, subjectSearchTerms } from "../../scripts/lib/gmail";
import { ENTRY_LIST_SUBJECT } from "../../scripts/lib/constants";

describe("the search terms are words, never a quoted phrase", () => {
  it("drops the pipe that made the real subject unmatchable", () => {
    expect(ENTRY_LIST_SUBJECT, "the subject really does carry a pipe").toContain("|");
    const terms = subjectSearchTerms(ENTRY_LIST_SUBJECT);
    expect(terms).toBe("Survivor DellaPia 2026 Entry List");
    // The three characters Gmail chokes on, or that mean something to it.
    for (const c of ["|", '"', "-"]) expect(terms).not.toContain(c);
  });

  it("keeps every word, so the prefilter cannot match a different thread's subject", () => {
    // Dropping a word widens the net; the exact check still guards it, but a
    // 20-result cap means a wider net can push the real thread off the page.
    for (const w of ["Survivor", "DellaPia", "2026", "Entry", "List"]) {
      expect(subjectSearchTerms(ENTRY_LIST_SUBJECT).split(" ")).toContain(w);
    }
  });

  it("handles the punctuation a person actually types", () => {
    expect(subjectSearchTerms("Re: Picks — week 1 (final)")).toBe("Re Picks week 1 final");
    expect(subjectSearchTerms("A/B: c+d & e")).toBe("A B c d e");
    expect(subjectSearchTerms("  padded  ")).toBe("padded");
  });

  it("gives nothing back for a subject with no words at all", () => {
    // The caller returns null rather than asking Gmail for `subject:()`, which
    // is a syntax error that would read as "no such thread".
    expect(subjectSearchTerms("---")).toBe("");
    expect(subjectSearchTerms("")).toBe("");
  });

  it("still normalises Re: and Fwd: when the subject is compared", () => {
    // The prefilter is not the match. This is.
    const s = ENTRY_LIST_SUBJECT;
    expect(normalizeSubject(`Re: ${s}`)).toBe(normalizeSubject(s));
    expect(normalizeSubject(`RE: Fwd: ${s}`)).toBe(normalizeSubject(s));
    expect(normalizeSubject(s)).not.toBe(normalizeSubject("Survivor - DellaPia | 2026 Entry"));
  });
});

describe("the query the lookup actually builds", () => {
  const src = () => readFileSync("scripts/lib/gmail.ts", "utf8");

  it("is subject:(terms), and the quoted form is gone", () => {
    expect(src()).toContain("q: `subject:(${terms})`");
    expect(src(), "the quoted subject is what returned zero").not.toContain('q: `subject:"${subject}"`');
  });

  it("still verifies the subject exactly after the prefilter", () => {
    expect(src()).toContain("if (first !== normalizeSubject(subject)) continue;");
  });
});
