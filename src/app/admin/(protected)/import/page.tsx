import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { LynneImport } from "@/components/admin/lynne-import";

export const metadata: Metadata = { title: "Lynne import" };

export default async function ImportPage() {
  const weeks = await getData().getWeeks();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">Lynne import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop her weekly file (.xlsx or .csv). Her NO./NAMES grid is read
          natively — status from the fill colors, BYE and OUT as she types
          them, and entries she has deleted (eliminated) are expected, not
          errors. You&apos;ll see exactly what matched, what didn&apos;t, and
          every disagreement before anything is written. Re-importing the
          same file is a no-op. Variances are recorded for review — never
          auto-resolved.
        </p>
      </div>
      <LynneImport weeks={weeks} />
    </div>
  );
}
