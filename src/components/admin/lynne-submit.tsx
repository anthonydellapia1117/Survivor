"use client";

// C1: the weekly three-column block for Lynne, exactly her accepted format,
// with a copy button. Alive entries with a current pick, sorted by her
// entry number. Anything missing a number is a loud blocker, not a footnote.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildSubmissionBlock, type SubmitRow } from "@/lib/lynne/submit";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LynneSubmit({
  week,
  weeks,
  ready,
  missingNumber,
  missingPick,
  aliveCount,
}: {
  week: number;
  weeks: number[];
  ready: SubmitRow[];
  missingNumber: string[];
  missingPick: string[];
  aliveCount: number;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const block = useMemo(() => buildSubmissionBlock(week, ready), [week, ready]);

  async function copy() {
    await navigator.clipboard.writeText(block);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl">Lynne submission</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Her exact three-column format — NO., NAMES, the week&apos;s pick in
          her team names — sorted by her entry number. Nothing else is
          accepted.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={String(week)}
          onValueChange={(v) => router.push(`/admin/lynne-submit?week=${v}`)}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {weeks.map((w) => (
              <SelectItem key={w} value={String(w)}>
                Week {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs tabular-nums text-muted-foreground">
          {ready.length} of {aliveCount} alive entries in the block
        </span>
        <Button size="sm" onClick={copy} disabled={ready.length === 0}>
          {copied ? "Copied" : "Copy block"}
        </Button>
      </div>

      {missingNumber.length > 0 ? (
        <div className="rounded-md border border-loss/50 bg-loss/10 px-3 py-2.5 text-sm text-loss">
          <p className="font-semibold">
            {missingNumber.length}{" "}
            {missingNumber.length === 1 ? "entry has" : "entries have"} no
            Lynne number — they CANNOT be submitted:
          </p>
          <p className="mt-1 text-xs">{missingNumber.join(" · ")}</p>
          <p className="mt-1 text-xs opacity-80">
            Set each number on the Entries screen (Edit → Lynne number).
          </p>
        </div>
      ) : null}
      {missingPick.length > 0 ? (
        <div className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2.5 text-sm text-tie">
          <p className="font-semibold">
            No week-{week} pick yet ({missingPick.length}):
          </p>
          <p className="mt-1 text-xs">{missingPick.join(" · ")}</p>
        </div>
      ) : null}

      <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-sm leading-relaxed">
        {ready.length > 0
          ? block
          : `No submittable picks for week ${week} yet.`}
      </pre>
    </div>
  );
}
