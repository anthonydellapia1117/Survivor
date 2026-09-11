// Gmail for the local commands, as Anthony, through OAuth on his own
// account. Reading, labelling and drafting are all this module can do;
// there is no send in it. The one send path in scripts/ is scripts/lib/send.ts,
// allowlisted by template name and gated on REMINDER_AUTOSEND=true.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { google, type gmail_v1 } from "googleapis";
import { requireEnv } from "./env";
import { SWEEP_WINDOW_DAYS } from "./constants";
import { assertNoRetiredAddresses } from "./roster";

export const TOKEN_PATH = path.join(os.homedir(), ".config", "survivor", "gmail-token.json");
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/oauth2callback`;

function oauth() {
  const id = requireEnv(
    "GMAIL_OAUTH_CLIENT_ID",
    "Create a Desktop OAuth client in Google Cloud and put its id and secret in .env.local (see docs/PICKS_INTAKE.md).",
  );
  const secret = requireEnv("GMAIL_OAUTH_CLIENT_SECRET", "See docs/PICKS_INTAKE.md.");
  return new google.auth.OAuth2(id, secret, REDIRECT_URI);
}

/** One-time browser consent; stores a refresh token under ~/.config/survivor. */
export async function authorizeInteractive(): Promise<void> {
  const auth = oauth();
  const url = auth.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", REDIRECT_URI);
      if (u.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const c = u.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(c ? "Authorized. You can close this tab." : "No code in the callback.");
      server.close();
      if (c) resolve(c);
      else reject(new Error("Google sent no authorization code."));
    });
    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      console.log("Open this URL in a browser signed in as anthonydellapia@gmail.com:\n");
      console.log(url + "\n");
    });
  });
  const { tokens } = await auth.getToken(code);
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  console.log(`Token saved to ${TOKEN_PATH}`);
}

/**
 * The stored token: GMAIL_OAUTH_TOKEN_JSON when set (a Routine container has
 * no home directory token, so the JSON that `npm run gmail:auth` wrote is
 * pasted into that environment), else the file on this machine.
 */
function storedToken(): Record<string, unknown> {
  const fromEnv = process.env.GMAIL_OAUTH_TOKEN_JSON?.trim();
  if (fromEnv) return JSON.parse(fromEnv) as Record<string, unknown>;
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`No Gmail token at ${TOKEN_PATH} and GMAIL_OAUTH_TOKEN_JSON is not set. Run: npm run gmail:auth`);
  }
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")) as Record<string, unknown>;
}

export function gmailClient(): gmail_v1.Gmail {
  const auth = oauth();
  auth.setCredentials(storedToken());
  return google.gmail({ version: "v1", auth });
}

export interface InboundMessage {
  id: string;
  threadId: string;
  from: string;
  fromAddress: string;
  subject: string;
  date: string;
  /** When Gmail received it, ISO, from internalDate; the pick's own time. */
  receivedAt: string;
  body: string;
}

export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decode(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function bodyOf(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (p.mimeType === "text/plain" && p.body?.data) plain.push(decode(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) html.push(decode(p.body.data));
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  if (plain.length) return plain.join("\n");
  if (html.length) return stripHtml(html.join("\n"));
  return "";
}

/**
 * Every unread message from any of the addresses, whatever its subject or
 * label, inside the window.
 *
 * The window is the only thing filtering this path - there is deliberately no
 * subject test on a known player, because a real reply may carry any subject
 * at all. That is why an unread newsletter from 27 April, sitting in a roster
 * player's thread, became a staged question on 2026-09-10: nothing else here
 * could have stopped it.
 */
export async function listUnreadFrom(
  gmail: gmail_v1.Gmail,
  addresses: string[],
  windowDays: number = SWEEP_WINDOW_DAYS,
): Promise<InboundMessage[]> {
  return listUnreadByQueries(gmail, unreadFromQueries(addresses, windowDays));
}

/**
 * The searches listUnreadFrom runs, as a pure function so the window can be
 * proved without Gmail. Chunked at 15 addresses because a Gmail query has a
 * length limit and the roster is 40.
 */
export function unreadFromQueries(addresses: string[], windowDays: number = SWEEP_WINDOW_DAYS): string[] {
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new Error("listUnreadFrom: windowDays must be a positive integer");
  const unique = Array.from(new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean)));
  const queries: string[] = [];
  for (let i = 0; i < unique.length; i += 15) {
    const chunk = unique.slice(i, i + 15);
    queries.push(`is:unread -in:draft newer_than:${windowDays}d (${chunk.map((a) => `from:${a}`).join(" OR ")})`);
  }
  return queries;
}

/** Every unread message a Gmail search matches, in full. The subject sweep's reader. */
export async function listUnreadMatching(gmail: gmail_v1.Gmail, q: string): Promise<InboundMessage[]> {
  return listUnreadByQueries(gmail, [q]);
}

async function listUnreadByQueries(gmail: gmail_v1.Gmail, queries: string[]): Promise<InboundMessage[]> {
  const ids = new Set<string>();
  for (const q of queries) {
    let pageToken: string | undefined;
    do {
      const res = await gmail.users.messages.list({ userId: "me", q, pageToken, maxResults: 100 });
      for (const m of res.data.messages ?? []) if (m.id) ids.add(m.id);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  const out: InboundMessage[] = [];
  for (const id of ids) {
    const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const headers = res.data.payload?.headers;
    const from = header(headers, "From");
    const internal = Number(res.data.internalDate ?? 0);
    const dateHeader = header(headers, "Date");
    const receivedAt = internal > 0 ? new Date(internal).toISOString() : new Date(dateHeader).toISOString();
    out.push({
      id,
      threadId: res.data.threadId ?? "",
      from,
      fromAddress: addressOf(from),
      subject: header(headers, "Subject"),
      date: dateHeader,
      receivedAt,
      body: bodyOf(res.data.payload),
    });
  }
  out.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
  return out;
}

/**
 * One message, in full, whatever its read state or label.
 *
 * The unread listers above are the sweep's readers and only ever see
 * `is:unread`. A message named by its id -- her pick email, quoted back by
 * Anthony or found by hand -- has usually been read already, so it needs a
 * reader of its own rather than a search that would silently return nothing.
 */
export async function getMessageFull(gmail: gmail_v1.Gmail, id: string): Promise<InboundMessage> {
  const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const headers = res.data.payload?.headers;
  const from = header(headers, "From");
  const internal = Number(res.data.internalDate ?? 0);
  const dateHeader = header(headers, "Date");
  return {
    id,
    threadId: res.data.threadId ?? "",
    from,
    fromAddress: addressOf(from),
    subject: header(headers, "Subject"),
    date: dateHeader,
    receivedAt: internal > 0 ? new Date(internal).toISOString() : new Date(dateHeader).toISOString(),
    body: bodyOf(res.data.payload),
  };
}

/**
 * Every message of a thread, in full, oldest first.
 *
 * CLAUDE.md: fetch threads in full, never rely on search previews, which
 * return only the oldest few messages with no truncation marker. Her
 * corrections arrive as replies on the same thread, so reading one message of
 * it and stopping is how a correction gets missed.
 */
export async function getThreadFull(gmail: gmail_v1.Gmail, threadId: string): Promise<InboundMessage[]> {
  const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  const out: InboundMessage[] = [];
  for (const m of res.data.messages ?? []) {
    if (!m.id) continue;
    const headers = m.payload?.headers;
    const from = header(headers, "From");
    const internal = Number(m.internalDate ?? 0);
    const dateHeader = header(headers, "Date");
    out.push({
      id: m.id,
      threadId: m.threadId ?? threadId,
      from,
      fromAddress: addressOf(from),
      subject: header(headers, "Subject"),
      date: dateHeader,
      receivedAt: internal > 0 ? new Date(internal).toISOString() : new Date(dateHeader).toISOString(),
      body: bodyOf(m.payload),
    });
  }
  out.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
  return out;
}

/** The address the token belongs to: the sender of every draft. */
export async function profileAddress(gmail: gmail_v1.Gmail): Promise<string> {
  const res = await gmail.users.getProfile({ userId: "me" });
  const a = res.data.emailAddress ?? "";
  if (!a) throw new Error("Gmail profile has no address.");
  return a;
}

export interface MessageRef {
  id: string;
  threadId: string;
}

/** Message ids for a Gmail query, newest first, every page. */
export async function searchMessages(gmail: gmail_v1.Gmail, q: string, max = 200): Promise<MessageRef[]> {
  const out: MessageRef[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({ userId: "me", q, pageToken, maxResults: Math.min(100, max - out.length) });
    for (const m of res.data.messages ?? []) if (m.id) out.push({ id: m.id, threadId: m.threadId ?? "" });
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < max);
  return out;
}

export interface AttachmentRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

export interface MessageMeta {
  id: string;
  threadId: string;
  from: string;
  fromAddress: string;
  subject: string;
  date: string;
  /** Epoch ms from Gmail's internalDate: what "newest" is measured on. */
  internalMs: number;
  attachments: AttachmentRef[];
}

/** Headers and attachment references, without downloading anything. */
export async function getMessageMeta(gmail: gmail_v1.Gmail, id: string): Promise<MessageMeta> {
  const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const headers = res.data.payload?.headers;
  const from = header(headers, "From");
  const attachments: AttachmentRef[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart | undefined) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      attachments.push({
        filename: p.filename,
        mimeType: p.mimeType ?? "application/octet-stream",
        attachmentId: p.body.attachmentId,
        size: p.body.size ?? 0,
      });
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(res.data.payload);
  return {
    id,
    threadId: res.data.threadId ?? "",
    from,
    fromAddress: addressOf(from),
    subject: header(headers, "Subject"),
    date: header(headers, "Date"),
    internalMs: Number(res.data.internalDate ?? 0),
    attachments,
  };
}

/** The bytes of one attachment. */
export async function getAttachment(gmail: gmail_v1.Gmail, messageId: string, attachmentId: string): Promise<Buffer> {
  const res = await gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
  const data = res.data.data ?? "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface OutboundMessage {
  to?: string[];
  /**
   * Visible copies. Used only by the named exceptions in
   * src/lib/emails/recipient-exceptions.ts - an owner who is deliberately
   * shown a giftee's message. CC and not Bcc on purpose: John can see that
   * Ray is reading it, which is the point of showing it to him.
   */
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /**
   * An HTML alternative for the same words. Given one, the message goes out
   * multipart/alternative: `body` stays the plain part and this is what a
   * reader actually sees, which is how a link can be an anchor rather than a
   * bare address (scripts/lib/site-link.ts). Omitted, the message is plain
   * text exactly as before - every existing caller is byte-identical.
   */
  html?: string;
  /** Reply headers, when the message continues a thread. */
  inReplyTo?: string;
  references?: string;
}

/**
 * Fixed rather than random: Math.random in an encoder makes the same message
 * encode differently every call, which a test cannot compare and a person
 * cannot diff. It only has to not appear in the body, and no body of this
 * project's carries it.
 */
const MIME_BOUNDARY = "survivor-alt-boundary-2b7f4c";

/**
 * RFC 822 text, base64url, the shape drafts.create and messages.send take.
 *
 * EVERY message this project sends and every Bcc draft it leaves is encoded
 * here, so this is the narrowest place a retired address can be stopped. The
 * named paths in send.ts check first and fail with better words; this is the
 * backstop that a NEW caller cannot forget, which is the whole shape of the
 * bug that produced the 550 5.1.1 bounce - a hand-built list that never went
 * near the derivation or its guard.
 */
export function encodeRaw(m: OutboundMessage): string {
  assertNoRetiredAddresses(
    [...(m.to ?? []), ...(m.cc ?? []), ...(m.bcc ?? [])],
    `message "${m.subject}"`,
  );
  const headers = [
    m.to && m.to.length ? `To: ${m.to.join(", ")}` : "",
    m.cc && m.cc.length ? `Cc: ${m.cc.join(", ")}` : "",
    m.bcc && m.bcc.length ? `Bcc: ${m.bcc.join(", ")}` : "",
    `Subject: ${m.subject}`,
    m.inReplyTo ? `In-Reply-To: ${m.inReplyTo}` : "",
    m.references ? `References: ${m.references}` : "",
    "MIME-Version: 1.0",
  ].filter((l) => l !== "");
  // multipart/alternative, plain part FIRST: the parts are ordered worst to
  // best and a reader takes the last one it understands, so HTML last is what
  // makes the anchor the thing people see.
  const body =
    m.html === undefined
      ? ["Content-Type: text/plain; charset=UTF-8", "", m.body]
      : [
          `Content-Type: multipart/alternative; boundary="${MIME_BOUNDARY}"`,
          "",
          `--${MIME_BOUNDARY}`,
          "Content-Type: text/plain; charset=UTF-8",
          "",
          m.body,
          `--${MIME_BOUNDARY}`,
          "Content-Type: text/html; charset=UTF-8",
          "",
          m.html,
          `--${MIME_BOUNDARY}--`,
        ];
  return Buffer.from([...headers, ...body].join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface CreatedDraft {
  draftId: string;
  messageId: string;
}

/** A new draft (not a reply). Never sent here. */
export async function createDraft(gmail: gmail_v1.Gmail, m: OutboundMessage, threadId?: string): Promise<CreatedDraft> {
  if (!(m.to && m.to.length) && !(m.bcc && m.bcc.length)) {
    throw new Error("A draft needs at least one To or Bcc address.");
  }
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: encodeRaw(m), ...(threadId ? { threadId } : {}) } },
  });
  return { draftId: res.data.id ?? "", messageId: res.data.message?.id ?? "" };
}

let labelCache: Map<string, string> | null = null;

async function labelId(gmail: gmail_v1.Gmail, name: string): Promise<string | null> {
  if (!labelCache) {
    const res = await gmail.users.labels.list({ userId: "me" });
    labelCache = new Map((res.data.labels ?? []).map((l) => [l.name ?? "", l.id ?? ""]));
  }
  return labelCache.get(name) ?? null;
}

/** Mark read and file under the sweep's label so the next run skips it. */
export async function markProcessed(gmail: gmail_v1.Gmail, id: string, label: string): Promise<boolean> {
  const lid = await labelId(gmail, label);
  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: { removeLabelIds: ["UNREAD"], addLabelIds: lid ? [lid] : [] },
  });
  return lid !== null;
}

export interface ThreadTail {
  threadId: string;
  lastMessageId: string;
  messageIdHeader: string;
  references: string;
}

export function normalizeSubject(s: string): string {
  return s.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim().toLowerCase();
}

/**
 * The Gmail SEARCH TERMS for a subject - its words, punctuation dropped.
 *
 * NOT the subject in quotes. Gmail's search treats `|` as an operator even
 * inside a quoted phrase, so `subject:"Survivor - DellaPia | 2026 Entry List"`
 * matches NOTHING - verified against the live mailbox, 0 threads, while the
 * thread sits there with exactly that subject. The entry-list draft could not
 * be created at all while the query was built that way, and the command said
 * only "not found", which reads like the thread is missing rather than like
 * the query is wrong.
 *
 * This is a PREFILTER and nothing more. Gmail ANDs the terms, so it returns a
 * superset; the caller still compares the thread's first subject to the one
 * asked for, normalised, and that comparison is what makes the match exact.
 */
export function subjectSearchTerms(subject: string): string {
  return subject.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The thread whose subject is exactly `subject`, and its latest message. */
export async function findThreadBySubject(gmail: gmail_v1.Gmail, subject: string): Promise<ThreadTail | null> {
  const terms = subjectSearchTerms(subject);
  if (terms === "") return null;
  const list = await gmail.users.threads.list({ userId: "me", q: `subject:(${terms})`, maxResults: 20 });
  for (const t of list.data.threads ?? []) {
    if (!t.id) continue;
    const full = await gmail.users.threads.get({
      userId: "me",
      id: t.id,
      format: "metadata",
      metadataHeaders: ["Subject", "Message-ID", "References", "Date"],
    });
    const msgs = full.data.messages ?? [];
    if (!msgs.length) continue;
    const first = normalizeSubject(header(msgs[0].payload?.headers, "Subject"));
    if (first !== normalizeSubject(subject)) continue;
    const last = msgs[msgs.length - 1];
    return {
      threadId: t.id,
      lastMessageId: last.id ?? "",
      messageIdHeader: header(last.payload?.headers, "Message-ID"),
      references: header(last.payload?.headers, "References"),
    };
  }
  return null;
}

/** A draft, in the thread, replying to its latest message. Never sent here. */
export async function createDraftReply(
  gmail: gmail_v1.Gmail,
  p: { tail: ThreadTail; to: string; subject: string; body: string },
): Promise<string> {
  // This one builds its own RFC 822 text and never reaches encodeRaw, so the
  // backstop there does not cover it.
  assertNoRetiredAddresses([p.to], `reply draft "${p.subject}"`);
  const refs = [p.tail.references, p.tail.messageIdHeader].filter(Boolean).join(" ");
  const lines = [
    `To: ${p.to}`,
    `Subject: ${p.subject}`,
    p.tail.messageIdHeader ? `In-Reply-To: ${p.tail.messageIdHeader}` : "",
    refs ? `References: ${refs}` : "",
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "",
    p.body,
  ].filter((l, i) => l !== "" || i >= 6);
  const raw = Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { threadId: p.tail.threadId, raw } },
  });
  return res.data.id ?? "";
}
