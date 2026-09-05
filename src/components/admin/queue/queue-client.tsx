"use client";

// One row per open pending_actions item. Each row carries its own note box
// and two buttons; a click calls the server action, which calls the RPC, then
// refreshes so the row drops off the list. Errors from the RPC (a duplicate
// transaction, a week that does not exist) are shown on the row and the row
// stays, because the database rolled the whole approve back.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approvePendingAction,
  dismissPendingAction,
} from "@/app/admin/actions";
import type { PendingAction } from "@/lib/data/admin-types";
import { appliesAutomatically, kindLabel, summarizePayload } from "@/lib/queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function formatStaged(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function QueueRow({ row }: { row: PendingAction }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const auto = appliesAutomatically(row.kind);

  function resolve(how: "approve" | "dismiss") {
    setError(null);
    startTransition(async () => {
      const res =
        how === "approve"
          ? await approvePendingAction({ id: row.id, note })
          : await dismissPendingAction({ id: row.id, note });
      if (!res.ok) {
        setError(res.error ?? "Not saved.");
        return;
      }
      if (how === "dismiss") setDone("Dismissed.");
      else if ("applied" in res && res.applied) setDone("Approved and applied.");
      else setDone("Approved. Not applied here: enter it on its own screen.");
      router.refresh();
    });
  }

  return (
    <tr className="border-t border-border/60 align-top">
      <td className="px-2 py-2">
        <Badge variant={auto ? "default" : "secondary"}>{kindLabel(row.kind)}</Badge>
      </td>
      <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">
        {formatStaged(row.stagedAt)}
      </td>
      <td className="px-2 py-2 font-mono text-xs text-muted-foreground break-all">
        {row.sourceMessageId ?? "none"}
      </td>
      <td className="px-2 py-2">
        <div>{summarizePayload(row.kind, row.payload)}</div>
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Raw payload</summary>
          <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        </details>
        {!auto ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No RPC for this kind: Approve records the decision only.
          </p>
        ) : null}
        {error ? <p className="mt-1 text-xs text-loss">{error}</p> : null}
        {done && !error ? <p className="mt-1 text-xs text-win">{done}</p> : null}
      </td>
      <td className="px-2 py-2">
        <div className="flex min-w-56 flex-col gap-1.5">
          <Input
            aria-label="Resolution note"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending || done !== null}
            className="h-7 text-xs"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              onClick={() => resolve("approve")}
              disabled={pending || done !== null}
            >
              {pending ? "Saving…" : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => resolve("dismiss")}
              disabled={pending || done !== null}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function QueueClient({ rows }: { rows: PendingAction[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing waiting. The sweep stages items here when it finds something it
        may not act on by itself.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Kind</th>
            <th className="px-2 py-1.5 text-left font-medium">Staged</th>
            <th className="px-2 py-1.5 text-left font-medium">Source message</th>
            <th className="px-2 py-1.5 text-left font-medium">What</th>
            <th className="px-2 py-1.5 text-left font-medium">Resolve</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <QueueRow key={r.id} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
