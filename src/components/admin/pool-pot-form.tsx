"use client";

// The pool-wide figures behind the public pot card and the Master List
// strip: Lynne's whole pool, not this group. All four are typed in from
// what she sends and stored exactly as entered: Total in Pool, Free, Total
// (paying) and the pot. Nothing is derived. The three counts have to agree
// with each other; when they do not, the RPC refuses and the sheet is what
// needs a look. The implied per-entry figure below is an admin-only sanity
// check on the numbers, division shown once here and printed nowhere public.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPoolPotAction } from "@/app/admin/actions";
import { formatCents } from "@/lib/pool";
import { checkFigures, parseCount } from "@/lib/pool-figures";
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
  freeCount,
  paidCount,
  potCents,
}: {
  entryCount: number | null;
  freeCount: number | null;
  paidCount: number | null;
  potCents: number | null;
}) {
  const router = useRouter();
  const [count, setCount] = useState(entryCount === null ? "" : String(entryCount));
  const [free, setFree] = useState(freeCount === null ? "" : String(freeCount));
  const [paid, setPaid] = useState(paidCount === null ? "" : String(paidCount));
  const [pot, setPot] = useState(potCents === null ? "" : String(potCents / 100));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const countN = parseCount(count);
  const freeN = parseCount(free);
  const paidN = parseCount(paid);
  const potN = pot.trim() === "" ? null : parseDollars(pot);
  // One verdict for the helper text and the save path: an invalid count is
  // invalid and nothing else is judged from it; three counts must agree.
  const check = checkFigures(count, free, paid, potN);

  function touch<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setSaved(false);
    };
  }

  function save(clear = false) {
    setError(null);
    setSaved(false);
    if (!clear) {
      if (check.kind === "invalid") {
        setError("Counts must be whole numbers.");
        return;
      }
      if (pot.trim() !== "" && potN === null) {
        setError("Pot must be dollars, like 28620 or 28,620.00.");
        return;
      }
      if (check.kind === "mismatch") {
        setError(
          `Her figures do not add up: ${check.free} free + ${check.paid} paid is not ${check.total} in pool. Enter them as she published them and check the sheet.`,
        );
        return;
      }
    }
    const args = clear
      ? { entryCount: null, freeCount: null, paidCount: null, potCents: null }
      : {
          entryCount: countN as number | null,
          freeCount: freeN as number | null,
          paidCount: paidN as number | null,
          potCents: potN,
        };
    startTransition(async () => {
      const res = await setPoolPotAction(args);
      if (!res.ok) {
        setError(res.error ?? "Not saved.");
        return;
      }
      if (clear) {
        setCount("");
        setFree("");
        setPaid("");
        setPot("");
      }
      setSaved(true);
      router.refresh();
    });
  }

  const anySet = entryCount !== null || freeCount !== null || paidCount !== null || potCents !== null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="pool-count">Total in Pool</Label>
          <Input
            id="pool-count"
            inputMode="numeric"
            placeholder="e.g. 1318"
            value={count}
            onChange={(e) => touch(setCount)(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pool-free">Free (her line)</Label>
          <Input
            id="pool-free"
            inputMode="numeric"
            placeholder="e.g. 46"
            value={free}
            onChange={(e) => touch(setFree)(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pool-paid">Total, paying (her line)</Label>
          <Input
            id="pool-paid"
            inputMode="numeric"
            placeholder="e.g. 1272"
            value={paid}
            onChange={(e) => touch(setPaid)(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pool-pot">Total Pay Out ($)</Label>
          <Input
            id="pool-pot"
            inputMode="decimal"
            placeholder="e.g. 28620"
            value={pot}
            onChange={(e) => touch(setPot)(e.target.value)}
            className="tabular-nums"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {check.kind === "invalid" ? (
          <span className="text-tie">Counts must be whole numbers.</span>
        ) : check.kind === "mismatch" ? (
          <span className="text-tie">
            These do not add up: {check.free} free + {check.paid} paid is not {check.total} in pool.
          </span>
        ) : check.perEntryCents !== null ? (
          <>
            Implied {formatCents(Math.round(check.perEntryCents))} per {check.per} - an admin-only
            check on the numbers, printed nowhere public.
          </>
        ) : (
          <>
            Each figure is stored exactly as you enter it. Leave all four blank and the public card reads
            &quot;Pending&quot;.
          </>
        )}
      </p>

      {error ? <p className="text-sm text-loss">{error}</p> : null}
      {saved && !error ? <p className="text-sm text-win">Saved - the public card and the Master List are updated.</p> : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => save(false)} disabled={pending}>
          {pending ? "Saving..." : "Save pool figures"}
        </Button>
        {anySet ? (
          <Button size="sm" variant="outline" onClick={() => save(true)} disabled={pending}>
            Clear (back to pending)
          </Button>
        ) : null}
      </div>
    </div>
  );
}
