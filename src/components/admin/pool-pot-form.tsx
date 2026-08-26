"use client";

// The pool-wide numbers behind the public "Pool pot" card — Lynne's whole
// pool, not this group. Both values are typed in from what she sends: the
// POT IS ENTERED DIRECTLY rather than derived, because the per-entry figure
// behind it has never been confirmed. (2025 finished near 1,245 entries and
// ~$27,200, but that ratio is history, not a rule.) When both are filled the
// implied per-entry figure is shown as a sanity check on the two numbers —
// it is division, not an assumed formula.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPoolPotAction } from "@/app/admin/actions";
import { formatCents } from "@/lib/pool";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function parseDollars(s: string): number | null {
  const n = Number(s.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function PoolPotForm({
  entryCount,
  potCents,
}: {
  entryCount: number | null;
  potCents: number | null;
}) {
  const router = useRouter();
  const [count, setCount] = useState(
    entryCount === null ? "" : String(entryCount),
  );
  const [pot, setPot] = useState(
    potCents === null ? "" : String(potCents / 100),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const countN = count.trim() === "" ? null : Number(count.trim());
  const potN = pot.trim() === "" ? null : parseDollars(pot);
  const perEntry =
    countN !== null && countN > 0 && potN !== null ? potN / countN : null;

  function save(clear = false) {
    setError(null);
    setSaved(false);
    const c = clear ? null : countN;
    const p = clear ? null : potN;
    if (!clear) {
      if (count.trim() !== "" && (!Number.isInteger(c) || (c ?? 0) < 0)) {
        setError("Pool entries must be a whole number.");
        return;
      }
      if (pot.trim() !== "" && p === null) {
        setError("Pot must be dollars, like 27200 or 27,200.00.");
        return;
      }
    }
    startTransition(async () => {
      const res = await setPoolPotAction({ entryCount: c, potCents: p });
      if (!res.ok) {
        setError(res.error ?? "Not saved.");
        return;
      }
      if (clear) {
        setCount("");
        setPot("");
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pool-count">
            Pool entries (Lynne&apos;s whole pool)
          </Label>
          <Input
            id="pool-count"
            inputMode="numeric"
            placeholder="e.g. 1250"
            value={count}
            onChange={(e) => {
              setCount(e.target.value);
              setSaved(false);
            }}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pool-pot">Prize pot ($)</Label>
          <Input
            id="pool-pot"
            inputMode="decimal"
            placeholder="e.g. 27200"
            value={pot}
            onChange={(e) => {
              setPot(e.target.value);
              setSaved(false);
            }}
            className="tabular-nums"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {perEntry !== null ? (
          <>
            Implied {formatCents(Math.round(perEntry))} per entry — a check on
            the two numbers, not a formula the app applies.
          </>
        ) : (
          <>
            The pot is stored exactly as you enter it. Leave both blank and the
            public card reads &quot;Pending&quot;.
          </>
        )}
      </p>

      {error ? <p className="text-sm text-loss">{error}</p> : null}
      {saved && !error ? (
        <p className="text-sm text-win">Saved — the public card is updated.</p>
      ) : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => save(false)} disabled={pending}>
          {pending ? "Saving…" : "Save pool numbers"}
        </Button>
        {entryCount !== null || potCents !== null ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => save(true)}
            disabled={pending}
          >
            Clear (back to pending)
          </Button>
        ) : null}
      </div>
    </div>
  );
}
