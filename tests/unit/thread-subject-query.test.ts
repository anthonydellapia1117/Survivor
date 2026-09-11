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
import type { gmail_v1 } from "googleapis";
import { findThreadBySubject, normalizeSubject, subjectQuery, subjectSearchTerms } from "../../scripts/lib/gmail";
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

describe("each word is quoted, because a bare one can be an operator", () => {
  it("quotes every term, so a subject carrying OR stays an AND", () => {
    // subject:(a OR b) is an OR. The prefilter relies on AND, and a wider set
    // against a page cap is how the real thread falls off the end.
    expect(subjectQuery("Picks OR else")).toBe('subject:("Picks" "OR" "else")');
    expect(subjectQuery(ENTRY_LIST_SUBJECT)).toBe(
      'subject:("Survivor" "DellaPia" "2026" "Entry" "List")',
    );
  });

  it("gives an empty query for a subject with no words", () => {
    expect(subjectQuery("---")).toBe("");
  });
});

// ------------------------------------------------------- the lookup, behaving
//
// Everything above reads a string. These drive findThreadBySubject with a fake
// Gmail and watch what it asks for - which is the only way to see that the
// empty-subject guard stops the call, and that a second page is fetched.

interface FakeThread { id: string; subject: string }

function fakeGmail(pages: FakeThread[][]) {
  const listCalls: { q?: string; pageToken?: string }[] = [];
  const all = pages.flat();
  const gmail = {
    users: {
      threads: {
        list: async (p: { q?: string; pageToken?: string }) => {
          listCalls.push({ q: p.q, pageToken: p.pageToken });
          const i = p.pageToken ? Number(p.pageToken) : 0;
          return {
            data: {
              threads: (pages[i] ?? []).map((t) => ({ id: t.id })),
              nextPageToken: i + 1 < pages.length ? String(i + 1) : undefined,
            },
          };
        },
        get: async (p: { id: string }) => {
          const t = all.find((x) => x.id === p.id)!;
          return {
            data: {
              messages: [
                { id: `${t.id}-m1`, payload: { headers: [{ name: "Subject", value: t.subject }] } },
              ],
            },
          };
        },
      },
    },
  } as unknown as gmail_v1.Gmail;
  return { gmail, listCalls };
}

describe("the lookup itself", () => {
  it("asks Gmail NOTHING when the subject has no words", async () => {
    // The guard the source-only test could not see: without it this would send
    // `subject:()`, a syntax error that comes back looking like "no thread".
    const { gmail, listCalls } = fakeGmail([[{ id: "t1", subject: "---" }]]);
    await expect(findThreadBySubject(gmail, "---")).resolves.toBeNull();
    expect(listCalls, "no call was made at all").toHaveLength(0);
  });

  it("finds the thread on the FIRST page and stops there", async () => {
    const { gmail, listCalls } = fakeGmail([
      [{ id: "t1", subject: "something else" }, { id: "t2", subject: ENTRY_LIST_SUBJECT }],
      [{ id: "t3", subject: ENTRY_LIST_SUBJECT }],
    ]);
    const got = await findThreadBySubject(gmail, ENTRY_LIST_SUBJECT);
    expect(got?.threadId).toBe("t2");
    expect(listCalls).toHaveLength(1);
  });

  it("PAGES ON when the exact subject is not on the first page", async () => {
    // A busy mailbox pushes the real thread past 20 candidates. Stopping at
    // one page reported it missing - the same wrong answer the quoted query
    // gave, reached another way.
    const filler = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, subject: "Survivor DellaPia 2026 Entry List extra" }));
    const { gmail, listCalls } = fakeGmail([filler, [{ id: "real", subject: `Re: ${ENTRY_LIST_SUBJECT}` }]]);
    const got = await findThreadBySubject(gmail, ENTRY_LIST_SUBJECT);
    expect(got?.threadId).toBe("real");
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1].pageToken, "it followed nextPageToken").toBe("1");
  });

  it("gives up rather than walking the mailbox forever", async () => {
    const page = [{ id: "x", subject: "not it" }];
    const { gmail, listCalls } = fakeGmail(Array.from({ length: 50 }, () => page));
    await expect(findThreadBySubject(gmail, ENTRY_LIST_SUBJECT)).resolves.toBeNull();
    expect(listCalls.length).toBeLessThanOrEqual(10);
  });
});

describe("the query the lookup actually builds", () => {
  const src = () => readFileSync("scripts/lib/gmail.ts", "utf8");

  it("is the quoted-word query, and the quoted SUBJECT is gone", () => {
    expect(src()).toContain("const q = subjectQuery(subject);");
    expect(src(), "the quoted subject is what returned zero").not.toContain('subject:"${subject}"');
  });

  it("still verifies the subject exactly after the prefilter", () => {
    expect(src()).toContain("if (first !== normalizeSubject(subject)) continue;");
  });
});
