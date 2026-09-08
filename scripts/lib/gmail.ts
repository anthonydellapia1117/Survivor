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

/** Every unread message from any of the addresses, whatever its subject or label. */
export async function listUnreadFrom(gmail: gmail_v1.Gmail, addresses: string[]): Promise<InboundMessage[]> {
  const unique = Array.from(new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean)));
  const ids = new Set<string>();
  for (let i = 0; i < unique.length; i += 15) {
    const chunk = unique.slice(i, i + 15);
    const q = `is:unread -in:draft (${chunk.map((a) => `from:${a}`).join(" OR ")})`;
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
  bcc?: string[];
  subject: string;
  body: string;
  /** Reply headers, when the message continues a thread. */
  inReplyTo?: string;
  references?: string;
}

/** RFC 822 text, base64url, the shape drafts.create and messages.send take. */
export function encodeRaw(m: OutboundMessage): string {
  const lines = [
    m.to && m.to.length ? `To: ${m.to.join(", ")}` : "",
    m.bcc && m.bcc.length ? `Bcc: ${m.bcc.join(", ")}` : "",
    `Subject: ${m.subject}`,
    m.inReplyTo ? `In-Reply-To: ${m.inReplyTo}` : "",
    m.references ? `References: ${m.references}` : "",
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
  ].filter((l) => l !== "");
  return Buffer.from([...lines, "", m.body].join("\r\n"), "utf8")
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

function normalizeSubject(s: string): string {
  return s.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim().toLowerCase();
}

/** The thread whose subject is exactly `subject`, and its latest message. */
export async function findThreadBySubject(gmail: gmail_v1.Gmail, subject: string): Promise<ThreadTail | null> {
  const list = await gmail.users.threads.list({ userId: "me", q: `subject:"${subject}"`, maxResults: 20 });
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
