"use client";

import { useMemo, useState } from "react";
import type { EntrySummary } from "@/lib/data/types";
import { NFL_TEAMS, SKIP_WEEK } from "@/lib/standing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ClipboardPaste } from "lucide-react";

interface ParsedLine {
  raw: string;
  entryId?: string;
  entryName?: string;
  team?: string;
  used?: boolean;
  error?: string;
}

/** Split one line into name + team parts: TAB, comma, or 2+ spaces. */
function splitLine(line: string): { name: string; teamRaw: string } | null {
  const tab = line.indexOf("\t");
  if (tab !== -1) {
    return { name: line.slice(0, tab), teamRaw: line.slice(tab + 1).trim() };
  }
  const comma = line.lastIndexOf(",");
  if (comma !== -1) {
    return {
      name: line.slice(0, comma),
      teamRaw: line.slice(comma + 1).trim(),
    };
  }
  const m = line.match(/^(.+?) {2,}(.+)$/);
  if (m) return { name: m[1], teamRaw: m[2].trim() };
  return null;
}

/** Abbreviation (any case), full team name (any case), or BYE/SKIP. */
function resolveTeam(raw: string): string | null {
  const u = raw.trim().toUpperCase();
  if (u === "") return null;
  if (u === "BYE" || u === "SKIP" || u === "SKIP WEEK" || u === "SKIP_WEEK") {
    return SKIP_WEEK;
  }
  const byAbbr = NFL_TEAMS.find((t) => t.abbr === u);
  if (byAbbr) return byAbbr.abbr;
  const byName = NFL_TEAMS.find((t) => t.name.toUpperCase() === u);
  return byName ? byName.abbr : null;
}

/**
 * Exact entryName first (verbatim, then trimmed), then case-insensitive.
 * Lowercasing happens only inside match logic — never for storage/display.
 */
function resolveEntry(
  name: string,
  entries: EntrySummary[],
): EntrySummary | "ambiguous" | null {
  const exact = entries.find((e) => e.entryName === name);
  if (exact) return exact;
  const trimmed = name.trim();
  const trimmedExact = entries.find((e) => e.entryName === trimmed);
  if (trimmedExact) return trimmedExact;
  const lower = trimmed.toLowerCase();
  const ci = entries.filter((e) => e.entryName.toLowerCase() === lower);
  if (ci.length === 1) return ci[0];
  return ci.length > 1 ? "ambiguous" : null;
}

export function BulkPasteDialog({
  entries,
  week,
  onStage,
}: {
  entries: EntrySummary[];
  week: number;
  onStage: (picks: { entryId: string; team: string }[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const parsed = useMemo<ParsedLine[]>(() => {
    const lines = text
      .replace(/\n$/, "")
      .split("\n")
      .filter((l) => l.trim() !== "");
    return lines.map((line) => {
      const parts = splitLine(line);
      if (!parts) {
        return {
          raw: line,
          error: "No separator — use TAB, a comma, or two or more spaces",
        };
      }
      const team = resolveTeam(parts.teamRaw);
      if (!team) {
        return { raw: line, error: `Unknown team "${parts.teamRaw}"` };
      }
      const entry = resolveEntry(parts.name, entries);
      if (entry === null) {
        return { raw: line, error: `No entry named "${parts.name}"` };
      }
      if (entry === "ambiguous") {
        return {
          raw: line,
          error: `"${parts.name}" matches several entries — paste the exact name`,
        };
      }
      return {
        raw: line,
        entryId: entry.id,
        entryName: entry.entryName,
        team,
        used: team !== SKIP_WEEK && entry.teamsUsed.includes(team),
      };
    });
  }, [text, entries]);

  const matched = parsed.filter((p) => p.entryId !== undefined);
  const unmatched = parsed.filter((p) => p.error !== undefined);

  function handleOpenChange(next: boolean) {
    if (next) setText("");
    setOpen(next);
  }

  function stageMatched() {
    // Later lines win when the same entry appears twice.
    const map = new Map<string, string>();
    for (const p of matched) map.set(p.entryId as string, p.team as string);
    onStage(
      [...map.entries()].map(([entryId, team]) => ({ entryId, team })),
    );
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ClipboardPaste data-icon="inline-start" />
          Bulk paste
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk paste week {week} picks</DialogTitle>
          <DialogDescription>
            One pick per line: entry name, then the team — separated by a TAB,
            a comma, or two or more spaces. Team by abbreviation or full name;
            BYE or SKIP for a skip week. Staging never submits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            spellCheck={false}
            placeholder={"tommybrads2\tPHI\nBig Kahuna, Kansas City Chiefs\nAnthony DellaPia 2  BYE"}
            className="min-h-32 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />

          {parsed.length > 0 ? (
            <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
              {matched.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {matched.length} matched
                  </p>
                  <ul className="space-y-0.5 text-sm">
                    {matched.map((p, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {p.entryName}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="tabular-nums">
                          {p.team === SKIP_WEEK ? "BYE" : p.team}
                        </span>
                        {p.used ? (
                          <span className="text-xs text-tie">
                            already used
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {unmatched.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-loss">
                    {unmatched.length} unmatched
                  </p>
                  <ul className="space-y-0.5 text-sm text-loss">
                    {unmatched.map((p, i) => (
                      <li key={i}>
                        <span className="font-mono">{p.raw}</span>
                        <span className="text-loss/80"> — {p.error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={matched.length === 0}
            onClick={stageMatched}
          >
            Stage {matched.length > 0 ? matched.length : ""} matched
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
