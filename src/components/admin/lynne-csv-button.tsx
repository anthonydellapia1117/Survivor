"use client";

// One-click weekly CSV for Lynne: NO. | NAMES | Week [n], her vocabulary,
// sorted by her number. Same data and the same precondition as the copy
// block — no download while any entry in the block lacks its number.

import { buildSubmissionCsv, type SubmitRow } from "@/lib/lynne/submit";
import { Button } from "@/components/ui/button";

export function LynneCsvButton({
  week,
  ready,
  missingNumberCount,
}: {
  week: number;
  ready: SubmitRow[];
  missingNumberCount: number;
}) {
  function download() {
    const csv = buildSubmissionCsv(week, ready);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DellaPia_Week${week}_Picks.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={download}
      disabled={ready.length === 0 || missingNumberCount > 0}
      title={
        missingNumberCount > 0
          ? "Blocked: entries in this block have no Lynne number — she matches on NO."
          : undefined
      }
    >
      Download CSV
    </Button>
  );
}
