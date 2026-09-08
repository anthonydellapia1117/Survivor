// One-line push notifications for the local commands.
//
// If NTFY_TOPIC is set (in the environment or .env.local) the line is POSTed
// to https://ntfy.sh/<topic>; otherwise it is printed. Anthony chooses the
// topic; nothing here invents one, and a missing topic is never an error.
// ntfy being unreachable is not an error either: the command's own work is
// done by the time this is called, so the line is printed and the run goes
// on. Nothing in a notification is secret: it is a summary line, never a
// pick, an amount or an address.

import { loadEnv } from "./env";

export type NotifyOutcome = "posted" | "printed";

export interface NotifyOptions {
  /** ntfy Title header. Defaults to "Survivor". */
  title?: string;
  /** ntfy Tags header, comma separated, e.g. "warning". */
  tags?: string;
}

export function ntfyTopic(): string | null {
  loadEnv();
  const t = process.env.NTFY_TOPIC?.trim();
  return t ? t : null;
}

/** Post one line to ntfy when a topic is set; print it otherwise. */
export async function notify(line: string, opts: NotifyOptions = {}): Promise<NotifyOutcome> {
  const text = line.replace(/\s+/g, " ").trim();
  const topic = ntfyTopic();
  if (!topic) {
    console.log(`[notify] ${text}`);
    return "printed";
  }
  try {
    const headers: Record<string, string> = { Title: opts.title ?? "Survivor" };
    if (opts.tags) headers.Tags = opts.tags;
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      body: text,
      headers,
    });
    if (!res.ok) {
      console.log(`[notify] ntfy answered ${res.status}; printing instead: ${text}`);
      return "printed";
    }
    return "posted";
  } catch (e: unknown) {
    const why = e instanceof Error ? e.message : String(e);
    console.log(`[notify] ntfy unreachable (${why}); printing instead: ${text}`);
    return "printed";
  }
}

/** A NEEDS ANTHONY line: something a command staged for him to decide. */
export function needsAnthonyLine(command: string, kind: string, detail: string): string {
  return `NEEDS ANTHONY - ${command} staged ${kind}: ${detail}`;
}

/** The line a command posts when its run finishes. */
export function finishedLine(command: string, summary: string): string {
  return `${command} finished - ${summary}`;
}
