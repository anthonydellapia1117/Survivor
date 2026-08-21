"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatEtDateTime } from "@/lib/format";

interface Result {
  ok?: boolean;
  error?: string;
  publicUrl?: string;
  privateUrl?: string | null;
  rowCounts?: Record<string, number>;
}

export function SheetsExportButton({
  lastExportAt,
}: {
  lastExportAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/export/sheets", { method: "POST" });
      const json = (await res.json()) as Result;
      setResult(json);
      if (json.ok) router.refresh();
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>
          {busy ? "Exporting…" : "Export to Sheets"}
        </Button>
        <span
          className="text-xs text-muted-foreground"
          suppressHydrationWarning
        >
          {lastExportAt
            ? `last generated ${formatEtDateTime(lastExportAt)} ET`
            : "never generated"}
        </span>
      </div>
      {result?.error ? (
        <p className="max-w-md text-xs text-loss">{result.error}</p>
      ) : null}
      {result?.ok ? (
        <p className="text-xs text-win">
          Regenerated —{" "}
          <a
            href={result.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            open sheet
          </a>
          {result.privateUrl ? (
            <>
              {" · "}
              <a
                href={result.privateUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                private sheet
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
