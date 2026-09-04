"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BuiltEmail } from "@/lib/emails/pick-request";
import { escapeHtml } from "@/lib/emails/template";

/**
 * Puts BOTH flavours on the clipboard in one write: Gmail's compose window
 * takes the text/html and pastes the message styled, while a plain-text
 * client (or a paste into a terminal) gets the readable fallback from the
 * same action. Writing only text/plain would paste the raw markup.
 */
async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    // Firefox has no ClipboardItem in some builds; the text still lands.
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function copyPlain(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The message headers, in order, as data.
 *
 * Both flavours of the whole-batch copy render these — the HTML paste and the
 * plain-text paste have to agree about what was sent, and they stop agreeing
 * the moment the list is written out twice.
 *
 * There is no Cc any more: a giftee gets their own message listing their own
 * entries, rather than riding along on the buyer's.
 */
function headerLines(b: BuiltEmail): { label: string; value: string }[] {
  return [
    { label: "To", value: b.to },
    { label: "Subject", value: b.subject },
  ];
}

type Flash = { id: string; ok: boolean } | null;

export function PickEmailsClient({
  week,
  weeks,
  built,
  skippedNoEmail,
  giftedWithoutEmail,
}: {
  week: number;
  weeks: number[];
  built: BuiltEmail[];
  skippedNoEmail: {
    id: string;
    name: string;
    entryCount: number;
    entryNames: string[];
  }[];
  giftedWithoutEmail: {
    entryId: string;
    entryName: string;
    ownerId: string;
    ownerName: string;
  }[];
}) {
  const router = useRouter();
  // Keyed on the MESSAGE, not the owner: one owner can now produce several.
  const [selected, setSelected] = useState<string | null>(
    built[0]?.key ?? null,
  );
  const [flash, setFlash] = useState<Flash>(null);

  const current = built.find((b) => b.key === selected) ?? built[0] ?? null;

  const note = (id: string, ok: boolean) => {
    setFlash({ id, ok });
    setTimeout(() => setFlash(null), 2200);
  };

  /**
   * Every message in one clipboard write, each under its own address, so a
   * Monday morning is one paste into a scratch document and a walk down it
   * rather than twenty-eight round trips through this screen.
   */
  const allHtml = useMemo(
    () =>
      built
        .map(
          (b) =>
            // escapeHtml on the header line too: the subject carries the
            // owner's name, which is owner-supplied like every other name in
            // this app. The message body is already escaped by the renderer.
            `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;padding:14px 0 6px 0;">${headerLines(
              b,
            )
              .map(
                (h) =>
                  `<div><strong>${h.label}:</strong> ${escapeHtml(h.value)}</div>`,
              )
              .join(
                "",
              )}</div>${b.html}<hr style="border:none;border-top:2px solid #262b31;margin:26px 0;">`,
        )
        .join(""),
    [built],
  );

  const allText = useMemo(
    () =>
      built
        .map(
          (b) =>
            `${headerLines(b)
              .map((h) => `${h.label}: ${h.value}`)
              .join("\n")}\n\n${b.text}\n\n${"=".repeat(60)}\n`,
        )
        .join("\n"),
    [built],
  );

  // To-addresses only. A CC belongs beside the one owner it is for; pasting
  // it into a combined address line would put a second person's address in the
  // To line of a mass mail, which is the opposite of what the CC is for.
  const addresses = useMemo(() => built.map((b) => b.to).join(", "), [built]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Pick emails</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            One message per PERSON, listing only the entries they play. A
            gifted entry goes to whoever plays it, not to the buyer, so replies
            come back one to one. Copy carries styled HTML — paste straight into
            Gmail. Nothing here sends anything.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Week
          <select
            value={week}
            onChange={(e) => router.push(`?week=${e.target.value}`)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm tabular-nums text-foreground"
            aria-label="Week to generate pick emails for"
          >
            {weeks.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
        <span className="text-sm tabular-nums text-muted-foreground">
          {built.length} {built.length === 1 ? "message" : "messages"}
          {built.some((b) => b.kind === "player")
            ? ` · ${built.filter((b) => b.kind === "player").length} to players`
            : ""}
        </span>
        <span className="text-border">·</span>
        <Button
          size="sm"
          onClick={async () => note("all", await copyRich(allHtml, allText))}
        >
          Copy all {built.length} (HTML)
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => note("all-text", await copyPlain(allText))}
        >
          Copy all (plain text)
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => note("addr", await copyPlain(addresses))}
        >
          Copy addresses
        </Button>
        {flash && ["all", "all-text", "addr"].includes(flash.id) ? (
          <span
            className={cn("text-sm", flash.ok ? "text-win" : "text-loss")}
            role="status"
          >
            {flash.ok ? "Copied" : "Copy failed — select and copy by hand"}
          </span>
        ) : null}
      </div>

      {skippedNoEmail.length > 0 ? (
        <div className="rounded-md border border-tie bg-tie/15 px-4 py-3 text-sm text-tie">
          <p className="font-semibold">
            {skippedNoEmail.length}{" "}
            {skippedNoEmail.length === 1 ? "owner has" : "owners have"} entries
            but no email on file, so nothing was generated for{" "}
            {skippedNoEmail.length === 1 ? "them" : "any of them"}:
          </p>
          <p className="mt-1 text-xs">
            {skippedNoEmail
              .map((o) => `${o.name} (${o.entryCount}: ${o.entryNames.join(", ")})`)
              .join(" · ")}
          </p>
        </div>
      ) : null}

      {giftedWithoutEmail.length > 0 ? (
        <div className="rounded-md border border-tie bg-tie/15 px-4 py-3 text-sm text-tie">
          <p className="font-semibold">
            {giftedWithoutEmail.length} gifted{" "}
            {giftedWithoutEmail.length === 1 ? "entry has" : "entries have"} no
            player address, so{" "}
            {giftedWithoutEmail.length === 1 ? "it stays" : "they stay"} on the
            buyer&apos;s message — ask for the address:
          </p>
          <p className="mt-1 text-xs">
            {giftedWithoutEmail
              .map((g) => `${g.entryName} (bought by ${g.ownerName})`)
              .join(" · ")}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface">
          {built.map((b) => {
            const active = current?.key === b.key;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => setSelected(b.key)}
                className={cn(
                  "block w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors duration-150 last:border-0",
                  active ? "bg-primary/10" : "hover:bg-surface-2",
                )}
                aria-current={active ? "true" : undefined}
              >
                <span className="block truncate text-sm font-medium">
                  {b.subject.replace(/^Week \d+ picks? — /, "")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {b.to}
                </span>
                {b.buyers.length > 0 ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {b.kind === "mixed" ? "own entries, plus some" : "plays entries"}{" "}
                    bought by {b.buyers.map((x) => x.name).join(", ")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {current ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
              <code className="text-xs text-muted-foreground">
                {current.to}
              </code>
              <span className="text-border">·</span>
              <Button
                size="sm"
                onClick={async () =>
                  note(
                    current.key,
                    await copyRich(current.html, current.text),
                  )
                }
              >
                Copy email
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () =>
                  note(`${current.key}-t`, await copyPlain(current.text))
                }
              >
                Plain text
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () =>
                  note(`${current.key}-a`, await copyPlain(current.to))
                }
              >
                To address
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () =>
                  note(`${current.key}-s`, await copyPlain(current.subject))
                }
              >
                Subject
              </Button>
              {flash && flash.id.startsWith(current.key) ? (
                <span
                  className={cn("text-sm", flash.ok ? "text-win" : "text-loss")}
                  role="status"
                >
                  {flash.ok ? "Copied" : "Copy failed"}
                </span>
              ) : null}
            </div>

            {/*
              The message drawn exactly as it will arrive. srcDoc keeps the
              email's own inline styles from being reached by the app's CSS,
              and sandbox with no allow-* keeps it inert.
            */}
            <iframe
              key={current.key}
              title={`Preview — ${current.to}`}
              srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0d0f">${current.html}</body>`}
              sandbox=""
              className="h-[70vh] w-full rounded-lg border border-border bg-[#0b0d0f]"
            />
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted-foreground">
            No owner has both a live entry and an email address, so there is
            nothing to generate.
          </p>
        )}
      </div>
    </div>
  );
}
