import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Lynne's Board" };

export default function LynnePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Lynne&apos;s Board</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The master pool&apos;s data as received — imports, matches, and
          variances. Lynne&apos;s published results are authoritative on wins,
          losses, and eliminations.
        </p>
      </div>
      <EmptyState
        title="No imports yet"
        detail="Weekly result files from the master pool will be listed here with match counts and any variances against local state."
      />
    </div>
  );
}
