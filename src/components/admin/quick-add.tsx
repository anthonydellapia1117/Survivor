"use client";

// Phone-first collection flow. Everything is one column, big targets, and
// prefilled: entry names default to "Full Name N", payment amounts default
// to the owner's outstanding balance, dates default to today.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminOwner } from "@/lib/data/admin-types";
import {
  addEntriesAction,
  createOwnerAction,
  recordPaymentAction,
} from "@/app/admin/actions";
import { amountDueCents, defaultEntryNames, formatCents } from "@/lib/pool";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronDown, Plus } from "lucide-react";

type Panel = "entries" | "payment" | null;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDollars(s: string): number | null {
  const n = Number(s.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function QuickAdd({ owners }: { owners: AdminOwner[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [openOwner, setOpenOwner] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [showNewOwner, setShowNewOwner] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const confirmed = useMemo(
    () =>
      owners
        .filter((o) => o.participationStatus === "confirmed")
        .sort((a, b) => a.lastName.localeCompare(b.lastName)),
    [owners],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return confirmed;
    return confirmed.filter((o) =>
      `${o.firstName} ${o.lastName}`.toLowerCase().includes(q),
    );
  }, [confirmed, search]);

  function done(msg: string) {
    setFlash(msg);
    setPanel(null);
    setOpenOwner(null);
    setShowNewOwner(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {flash ? (
        <p className="rounded-md border border-win/40 bg-win/10 px-3 py-2 text-sm text-win">
          {flash}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setFlash(null);
          }}
          placeholder="Search owners…"
          className="h-11 flex-1 text-base"
        />
        <Button
          className="h-11"
          variant={showNewOwner ? "secondary" : "default"}
          onClick={() => {
            setShowNewOwner((v) => !v);
            setOpenOwner(null);
            setFlash(null);
          }}
        >
          <Plus className="size-4" /> Owner
        </Button>
      </div>

      {showNewOwner ? <NewOwnerForm onDone={done} /> : null}

      <ul className="space-y-1.5">
        {filtered.map((o) => {
          const open = openOwner === o.id;
          const bal = o.dueCents - o.paidCents;
          return (
            <li
              key={o.id}
              className="rounded-lg border border-border bg-surface"
            >
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left"
                onClick={() => {
                  setOpenOwner(open ? null : o.id);
                  setPanel(null);
                  setFlash(null);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {o.firstName} {o.lastName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {o.entryCount} {o.entryCount === 1 ? "entry" : "entries"}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    bal <= 0 ? "text-win" : o.paidCents > 0 ? "text-tie" : "text-loss",
                  )}
                >
                  {bal <= 0 ? "PAID" : `${formatCents(bal)} due`}
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground transition-transform duration-150",
                    open && "rotate-180",
                  )}
                />
              </button>

              {open ? (
                <div className="space-y-3 border-t border-border/60 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant={panel === "entries" ? "secondary" : "outline"}
                      className="h-11"
                      onClick={() => setPanel(panel === "entries" ? null : "entries")}
                    >
                      Add entries
                    </Button>
                    <Button
                      variant={panel === "payment" ? "secondary" : "outline"}
                      className="h-11"
                      onClick={() => setPanel(panel === "payment" ? null : "payment")}
                    >
                      Record payment
                    </Button>
                  </div>
                  {panel === "entries" ? (
                    <AddEntriesForm owner={o} onDone={done} />
                  ) : null}
                  {panel === "payment" ? (
                    <PaymentForm owner={o} onDone={done} />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No owner matches — add them with + Owner.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function EntryCountPicker({
  count,
  setCount,
}: {
  count: number;
  setCount: (n: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {[0, 1, 2, 3, 4].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => setCount(n)}
          className={cn(
            "h-11 rounded-md border text-sm font-semibold tabular-nums transition-colors duration-150",
            count === n
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-surface",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function NewOwnerForm({ onDone }: { onDone: (msg: string) => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [count, setCount] = useState(1);
  const [customNames, setCustomNames] = useState("");
  const [useDefault, setUseDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fullName = `${first.trim()} ${last.trim()}`.trim();
  const preview = useDefault ? defaultEntryNames(fullName || "…", count) : [];

  async function submit() {
    const names = useDefault
      ? defaultEntryNames(fullName, count)
      : customNames.split("\n").filter((l) => l.trim().length > 0);
    if (!first.trim() || !last.trim()) {
      setError("First and last name required");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createOwnerAction({
      firstName: first.trim(),
      lastName: last.trim(),
      email: "",
      phone: phone.trim(),
      source: "text",
      notes: "",
      entryNames: names,
      nameIsDefault: useDefault,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Failed");
      return;
    }
    onDone(
      `${fullName} added with ${names.length} ${names.length === 1 ? "entry" : "entries"} — due ${formatCents(amountDueCents(names.length))}.`,
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-surface p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="First name">
          <Input value={first} onChange={(e) => setFirst(e.target.value)} className="h-11" />
        </Field>
        <Field label="Last name">
          <Input value={last} onChange={(e) => setLast(e.target.value)} className="h-11" />
        </Field>
      </div>
      <Field label="Phone (optional)">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          className="h-11"
        />
      </Field>
      <Field label="Entries">
        <EntryCountPicker count={count} setCount={setCount} />
      </Field>
      {count > 0 ? (
        <>
          <button
            type="button"
            className="text-xs font-medium text-primary"
            onClick={() => setUseDefault((v) => !v)}
          >
            {useDefault ? "Type custom entry names instead" : "Use default names"}
          </button>
          {useDefault ? (
            <p className="text-xs text-muted-foreground">
              {preview.join(" · ")}
            </p>
          ) : (
            <textarea
              value={customNames}
              onChange={(e) => setCustomNames(e.target.value)}
              rows={Math.max(2, count)}
              placeholder={"One entry name per line — stored exactly as typed"}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
          )}
        </>
      ) : null}
      {count > 0 ? (
        <p className="text-sm text-muted-foreground">
          Due at signup:{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatCents(amountDueCents(count))}
          </span>
        </p>
      ) : null}
      {error ? <p className="text-sm text-loss">{error}</p> : null}
      <Button className="h-11 w-full" onClick={submit} disabled={busy}>
        {busy ? "Adding…" : "Add owner"}
      </Button>
    </div>
  );
}

function AddEntriesForm({
  owner,
  onDone,
}: {
  owner: AdminOwner;
  onDone: (msg: string) => void;
}) {
  const [count, setCount] = useState(1);
  const [useDefault, setUseDefault] = useState(true);
  const [customNames, setCustomNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fullName = `${owner.firstName} ${owner.lastName}`;
  const newTotal = owner.entryCount + count;

  async function submit() {
    const names = useDefault
      ? Array.from(
          { length: count },
          (_, i) => `${fullName} ${owner.entryCount + i + 1}`,
        )
      : customNames.split("\n").filter((l) => l.trim().length > 0);
    if (names.length === 0) {
      setError("Add at least one entry name");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await addEntriesAction({
      ownerId: owner.id,
      entryNames: names,
      nameIsDefault: useDefault,
      isFree: false,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Failed");
      return;
    }
    onDone(
      `${names.length} ${names.length === 1 ? "entry" : "entries"} added for ${fullName} — now ${newTotal}, due ${formatCents(amountDueCents(newTotal))} total.`,
    );
  }

  return (
    <div className="space-y-3">
      <EntryCountPicker count={count} setCount={setCount} />
      <button
        type="button"
        className="text-xs font-medium text-primary"
        onClick={() => setUseDefault((v) => !v)}
      >
        {useDefault ? "Type custom entry names instead" : "Use default names"}
      </button>
      {!useDefault ? (
        <textarea
          value={customNames}
          onChange={(e) => setCustomNames(e.target.value)}
          rows={Math.max(2, count)}
          placeholder="One entry name per line — stored exactly as typed"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {Array.from(
            { length: count },
            (_, i) => `${fullName} ${owner.entryCount + i + 1}`,
          ).join(" · ")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        New total: {newTotal} entries · owner due{" "}
        <span className="tabular-nums">{formatCents(amountDueCents(newTotal))}</span>
      </p>
      {error ? <p className="text-sm text-loss">{error}</p> : null}
      <Button className="h-11 w-full" onClick={submit} disabled={busy || count === 0}>
        {busy ? "Adding…" : `Add ${count} ${count === 1 ? "entry" : "entries"}`}
      </Button>
    </div>
  );
}

function PaymentForm({
  owner,
  onDone,
}: {
  owner: AdminOwner;
  onDone: (msg: string) => void;
}) {
  const outstanding = Math.max(0, owner.dueCents - owner.paidCents);
  const [amount, setAmount] = useState(
    outstanding > 0 ? String(outstanding / 100) : "",
  );
  const [method, setMethod] = useState("venmo");
  const [txn, setTxn] = useState("");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cents = parseDollars(amount);
    if (cents === null || cents === 0) {
      setError("Enter an amount");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await recordPaymentAction({
      ownerId: owner.id,
      amountCents: cents,
      method,
      paidOn: date,
      venmoTxnId: method === "venmo" ? txn.trim() : "",
      note: "",
      corrects: null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Failed");
      return;
    }
    onDone(
      `${formatCents(cents)} ${method} recorded for ${owner.firstName} ${owner.lastName}.`,
    );
  }

  return (
    <div className="space-y-3">
      <Field label="Amount ($)">
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="h-11 text-base tabular-nums"
        />
      </Field>
      <div className="grid grid-cols-3 gap-1.5">
        {["venmo", "cash", "check"].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={cn(
              "h-11 rounded-md border text-sm font-medium capitalize transition-colors duration-150",
              method === m
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface",
            )}
          >
            {m}
          </button>
        ))}
      </div>
      {method === "venmo" ? (
        <Field label="Venmo transaction ID (the dedupe key)">
          <Input
            value={txn}
            onChange={(e) => setTxn(e.target.value)}
            className="h-11 font-mono text-sm"
          />
        </Field>
      ) : null}
      <Field label="Date">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
        />
      </Field>
      {outstanding > 0 ? (
        <p className="text-xs text-muted-foreground">
          Outstanding: <span className="tabular-nums">{formatCents(outstanding)}</span>{" "}
          (prefilled)
        </p>
      ) : (
        <p className="text-xs text-win">This owner is fully paid.</p>
      )}
      {error ? <p className="text-sm text-loss">{error}</p> : null}
      <Button className="h-11 w-full" onClick={submit} disabled={busy}>
        {busy ? "Recording…" : "Record payment"}
      </Button>
    </div>
  );
}
