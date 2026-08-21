"use client";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 text-center">
      <div>
        <h1 className="text-xl">Something broke</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The page hit an error while loading. The data is safe — this is a
          display problem, not a scoring one.
        </p>
        {error.digest ? (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            ref {error.digest}
          </p>
        ) : null}
      </div>
      <Button size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
