import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getData } from "@/lib/data";
import {
  NFL_TEAMS,
  RESULT_LABEL,
  SKIP_WEEK,
  STATUS_LABEL,
} from "@/lib/standing";
import { StatusDot } from "@/components/status-dot";
import { cn } from "@/lib/utils";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await props.params;
  const detail = await getData().getEntry(id);
  return { title: detail ? `${detail.entry.entryName} — card` : "Entry card" };
}

const RESULT_TEXT: Record<string, string> = {
  win: "text-win",
  loss: "text-loss",
  tie_loss: "text-tie",
  bye: "text-muted-foreground",
  pending: "text-muted-foreground",
  missed: "text-loss",
};

export default async function EntryExportPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const detail = await getData().getEntry(id);
  if (!detail) notFound();
  const { entry, picks } = detail;
  const used = new Set(
    picks.filter((p) => p.team !== SKIP_WEEK && p.team !== "MISSED").map((p) => p.team),
  );

  return (
    <div className="mx-auto max-w-sm space-y-4 print:max-w-full">
      <div className="no-print flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          One-page card — print or save as PDF to share.
        </p>
        <PrintButton />
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl">{entry.entryName}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {entry.ownerName} · 2026 NFL Survivor Pool
            </p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium">
            <StatusDot status={entry.status} />
            {STATUS_LABEL[entry.status]}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-surface-2 py-2">
            <div className="text-lg tabular-nums">
              {entry.wins}–{entry.losses}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Record
            </div>
          </div>
          <div className="rounded-md bg-surface-2 py-2">
            <div className="text-lg tabular-nums">{entry.livesRemaining}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Lives
            </div>
          </div>
          <div className="rounded-md bg-surface-2 py-2">
            <div className="text-lg tabular-nums">{used.size}/32</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Teams used
            </div>
          </div>
        </div>

        {picks.length > 0 ? (
          <ol className="mt-4 space-y-1">
            {picks.map((p) => (
              <li key={p.week} className="flex items-center gap-2 text-sm">
                <span className="w-8 text-xs tabular-nums text-muted-foreground">
                  W{p.week}
                </span>
                <span className="flex-1 font-medium">
                  {p.team === SKIP_WEEK ? "Bye" : p.team}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium",
                    RESULT_TEXT[p.result ?? "pending"],
                  )}
                >
                  {p.result ? RESULT_LABEL[p.result] : "Pending"}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No picks yet.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-1">
          {NFL_TEAMS.map((t) => (
            <span
              key={t.abbr}
              className={cn(
                "rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium",
                used.has(t.abbr)
                  ? "bg-surface-2 text-muted-foreground line-through opacity-60"
                  : "",
              )}
            >
              {t.abbr}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
