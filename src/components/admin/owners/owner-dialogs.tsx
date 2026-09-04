"use client";

// Add / edit owner and add-entries dialogs. All writes go through the server
// actions in src/app/admin/actions.ts; errors surface inline next to the
// control that failed and nothing closes until the action succeeds.

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addEntriesAction,
  createOwnerAction,
  updateOwnerAction,
} from "@/app/admin/actions";
import type { AdminOwner } from "@/lib/data/admin-types";
import { defaultEntryNames, ownerFullName } from "@/lib/pool";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

export const SOURCE_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "text", label: "Text" },
  { value: "in_person", label: "In person" },
  { value: "import", label: "Import" },
] as const;

const STATUS_OPTIONS = [
  { value: "confirmed", label: "Confirmed" },
  { value: "declined", label: "Declined" },
  { value: "pending", label: "Pending" },
] as const;

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

function InlineError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-sm text-loss">{error}</p>;
}

// ---------------------------------------------------------------------------
// Entry-name mechanics, shared by "Add owner" and "Add entries".
// ---------------------------------------------------------------------------

interface EntryNamesValue {
  useDefault: boolean;
  countText: string;
  text: string;
}

const EMPTY_ENTRY_NAMES: EntryNamesValue = {
  useDefault: false,
  countText: "1",
  text: "",
};

/**
 * Parse the textarea verbatim: strip one trailing newline, split on newlines,
 * drop only completely empty lines. Never trim or case what was typed.
 */
function parseTypedNames(text: string): string[] {
  const stripped = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (stripped === "") return [];
  return stripped.split("\n").filter((line) => line !== "");
}

function resolveEntryNames(
  fullName: string,
  value: EntryNamesValue,
  /** First number to use. Topping up an owner who already has entries
   *  continues their numbering instead of restarting at #1 and colliding
   *  with what they already hold. */
  startAt = 1,
):
  | { ok: true; names: string[]; nameIsDefault: boolean }
  | { ok: false; error: string } {
  if (value.useDefault) {
    const count = Number(value.countText);
    if (!Number.isInteger(count) || count < 1 || count > 8) {
      return { ok: false, error: "Entry count must be between 1 and 8." };
    }
    return {
      ok: true,
      names: defaultEntryNames(fullName, count, startAt),
      nameIsDefault: true,
    };
  }
  return { ok: true, names: parseTypedNames(value.text), nameIsDefault: false };
}

function EntryNamesFields({
  idPrefix,
  fullName,
  value,
  onChange,
  startAt = 1,
}: {
  idPrefix: string;
  fullName: string;
  value: EntryNamesValue;
  onChange: (v: EntryNamesValue) => void;
  /** Matches the startAt handed to resolveEntryNames, so the preview shows
   *  the numbers that will actually be saved. */
  startAt?: number;
}) {
  const count = Number(value.countText);
  const preview =
    value.useDefault && Number.isInteger(count) && count >= 1 && count <= 8
      ? defaultEntryNames(fullName, count, startAt)
      : [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idPrefix}-default`}
          checked={value.useDefault}
          onCheckedChange={(c) =>
            onChange({ ...value, useDefault: c === true })
          }
        />
        <Label htmlFor={`${idPrefix}-default`} className="font-normal">
          Use default naming
        </Label>
      </div>
      {value.useDefault ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-count`}>Number of entries</Label>
          <Input
            id={`${idPrefix}-count`}
            type="number"
            min={1}
            max={8}
            inputMode="numeric"
            value={value.countText}
            onChange={(e) => onChange({ ...value, countText: e.target.value })}
            className="w-24 tabular-nums"
          />
          {preview.length > 0 ? (
            <p className="truncate text-xs text-muted-foreground">
              {preview.join(", ")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-names`}>Entry names</Label>
          <Textarea
            id={`${idPrefix}-names`}
            rows={4}
            placeholder="One entry name per line"
            value={value.text}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Names are stored exactly as typed — case and spacing included.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add owner
// ---------------------------------------------------------------------------

export function AddOwnerDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("email");
  const [notes, setNotes] = useState("");
  const [names, setNames] = useState<EntryNamesValue>(EMPTY_ENTRY_NAMES);

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setSource("email");
    setNotes("");
    setNames(EMPTY_ENTRY_NAMES);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (firstName.trim() === "" || lastName.trim() === "") {
      setError("First and last name are required.");
      return;
    }
    const resolved = resolveEntryNames(
      ownerFullName(firstName, lastName),
      names,
    );
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    setPending(true);
    setError(null);
    const res = await createOwnerAction({
      firstName,
      lastName,
      email,
      phone,
      source,
      notes,
      entryNames: resolved.names,
      nameIsDefault: resolved.nameIsDefault,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
    setOpen(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Add owner
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add owner</DialogTitle>
          <DialogDescription>
            Create the owner and their entries in one step.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="own-first">First name</Label>
              <Input
                id="own-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="own-last">Last name</Label>
              <Input
                id="own-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="own-email">Email</Label>
              <Input
                id="own-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="own-phone">Phone</Label>
              <Input
                id="own-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="own-notes">Notes</Label>
            <Textarea
              id="own-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <EntryNamesFields
            idPrefix="own"
            fullName={ownerFullName(firstName, lastName)}
            value={names}
            onChange={setNames}
          />
          <InlineError error={error} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Create owner"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit owner — participation status (confirmed / declined / pending) lives here
// ---------------------------------------------------------------------------

export function EditOwnerDialog({
  owner,
  onClose,
}: {
  owner: AdminOwner;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState(owner.firstName);
  const [lastName, setLastName] = useState(owner.lastName);
  const [email, setEmail] = useState(owner.email ?? "");
  const [ccEmail, setCcEmail] = useState(owner.ccEmail ?? "");
  const [phone, setPhone] = useState(owner.phone ?? "");
  const [status, setStatus] = useState<string>(owner.participationStatus);
  const [notes, setNotes] = useState(owner.notes ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (firstName.trim() === "" || lastName.trim() === "") {
      setError("First and last name are required.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await updateOwnerAction({
      ownerId: owner.id,
      firstName,
      lastName,
      email,
      ccEmail,
      phone,
      participationStatus: status,
      notes,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Edit {owner.firstName} {owner.lastName}
          </DialogTitle>
          <DialogDescription>
            Status changes are audited and always reversible.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-first">First name</Label>
              <Input
                id="edit-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-last">Last name</Label>
              <Input
                id="edit-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          {/*
            Full width, below the pair: it is not a second identity for this
            owner, it is a second person who should see the same email. The
            hint says so, because a blank field with the label "CC" invites
            someone to put an alternative address for the SAME person in it,
            and then two copies go to one inbox.
          */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-cc-email">CC email (optional)</Label>
            <Input
              id="edit-cc-email"
              type="email"
              value={ccEmail}
              onChange={(e) => setCcEmail(e.target.value)}
              placeholder="someone.else@example.com"
              aria-describedby="edit-cc-email-hint"
            />
            <p
              id="edit-cc-email-hint"
              className="text-xs text-muted-foreground"
            >
              For when someone else plays entries this owner pays for. They are
              CC&apos;d on this owner&apos;s pick email — the owner stays the
              recipient — and they are on the BCC list for group announcements.
              They are NOT on the paid/unpaid lists, which stay owners only.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Participation status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea
              id="edit-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <InlineError error={error} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add entries to an existing owner
// ---------------------------------------------------------------------------

export function AddEntriesDialog({
  owner,
  onClose,
}: {
  owner: AdminOwner;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<EntryNamesValue>(EMPTY_ENTRY_NAMES);
  const [isFree, setIsFree] = useState(false);

  const fullName = ownerFullName(owner.firstName, owner.lastName);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const resolved = resolveEntryNames(fullName, names, owner.entryCount + 1);
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    if (resolved.names.length === 0) {
      setError("Add at least one entry name.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await addEntriesAction({
      ownerId: owner.id,
      entryNames: resolved.names,
      nameIsDefault: resolved.nameIsDefault,
      isFree,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add entries for {fullName}</DialogTitle>
          <DialogDescription>
            New entries are appended after the owner&apos;s existing ones.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <EntryNamesFields
            idPrefix="addent"
            fullName={fullName}
            value={names}
            onChange={setNames}
            startAt={owner.entryCount + 1}
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="addent-free"
              checked={isFree}
              onCheckedChange={(c) => setIsFree(c === true)}
            />
            <Label htmlFor="addent-free" className="font-normal">
              Free entry (earned, not charged)
            </Label>
          </div>
          <InlineError error={error} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add entries"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
