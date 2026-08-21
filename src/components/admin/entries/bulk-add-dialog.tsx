"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminOwner } from "@/lib/data/admin-types";
import { addEntriesAction } from "@/app/admin/actions";
import { defaultEntryNames } from "@/lib/pool";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

/**
 * Parse one entry name per line. Names are VERBATIM: only a trailing newline
 * is stripped and fully empty lines are dropped — no trimming, no casing.
 */
function parseEntryNames(text: string): string[] {
  return text
    .replace(/\n$/, "")
    .split("\n")
    .filter((line) => line !== "");
}

export function BulkAddDialog({ owners }: { owners: AdminOwner[] }) {
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [useDefault, setUseDefault] = useState(false);
  const [count, setCount] = useState("1");
  const [namesText, setNamesText] = useState("");
  const [isFree, setIsFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const confirmed = useMemo(
    () => owners.filter((o) => o.participationStatus === "confirmed"),
    [owners],
  );
  const owner = confirmed.find((o) => o.id === ownerId) ?? null;

  const parsedCount = Number.parseInt(count, 10);
  const entryNames = useMemo(() => {
    if (useDefault) {
      if (!owner || !Number.isFinite(parsedCount) || parsedCount < 1) return [];
      return defaultEntryNames(
        `${owner.firstName} ${owner.lastName}`,
        parsedCount,
      );
    }
    return parseEntryNames(namesText);
  }, [useDefault, owner, parsedCount, namesText]);

  function handleOpenChange(next: boolean) {
    if (next) {
      setOwnerId("");
      setUseDefault(false);
      setCount("1");
      setNamesText("");
      setIsFree(false);
      setError(null);
    }
    setOpen(next);
  }

  async function submit() {
    if (!owner || entryNames.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await addEntriesAction({
      ownerId: owner.id,
      entryNames,
      nameIsDefault: useDefault,
      isFree,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Add failed");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Bulk add
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk add entries</DialogTitle>
          <DialogDescription>
            Add entries to a confirmed owner — named lines or the default
            naming convention.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-add-owner">Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger id="bulk-add-owner" className="w-full">
                <SelectValue placeholder="Select an owner…" />
              </SelectTrigger>
              <SelectContent>
                {confirmed.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.firstName} {o.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Label htmlFor="bulk-add-default" className="font-normal">
            <Checkbox
              id="bulk-add-default"
              checked={useDefault}
              onCheckedChange={(v) => setUseDefault(v === true)}
            />
            Use default naming ({owner ? `${owner.firstName} ${owner.lastName}` : "Full Name"} 1, 2, …)
          </Label>

          {useDefault ? (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-add-count">How many entries</Label>
              <Input
                id="bulk-add-count"
                type="number"
                min={1}
                step={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="w-24"
              />
              {entryNames.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Will create: {entryNames.join(", ")}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-add-names">Entry names, one per line</Label>
              <textarea
                id="bulk-add-names"
                value={namesText}
                onChange={(e) => setNamesText(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder={"tommybrads2\nBig Kahuna"}
                className="min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
              <p className="text-xs text-muted-foreground">
                Names are saved exactly as typed — never trimmed or re-cased.
              </p>
            </div>
          )}

          <Label htmlFor="bulk-add-free" className="font-normal">
            <Checkbox
              id="bulk-add-free"
              checked={isFree}
              onCheckedChange={(v) => setIsFree(v === true)}
            />
            Free entries
          </Label>

          {error ? <p className="text-sm text-loss">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !owner || entryNames.length === 0}
            onClick={submit}
          >
            {busy
              ? "Adding…"
              : entryNames.length > 0
                ? `Add ${entryNames.length} ${entryNames.length === 1 ? "entry" : "entries"}`
                : "Add entries"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
