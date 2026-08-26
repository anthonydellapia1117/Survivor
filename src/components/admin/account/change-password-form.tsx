"use client";

// Change-password form. The requirements are on screen from the moment the
// page loads and tick over live as you type — you never submit into a
// surprise rejection. The same rules run again on the server.

import { useState } from "react";
import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { changePasswordAction } from "@/app/admin/(protected)/account/actions";
import { passwordRules } from "@/lib/password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function RuleRow({ met, label }: { met: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {met ? (
        <Check className="size-3.5 shrink-0 text-win" aria-hidden />
      ) : (
        <Circle
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      <span
        className={cn("text-sm", met ? "text-win" : "text-muted-foreground")}
      >
        {label}
      </span>
      <span className="sr-only">{met ? "requirement met" : "not yet met"}</span>
    </li>
  );
}

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const rules = passwordRules(next);
  const rulesMet = rules.every((r) => r.met);
  const matches = confirm.length > 0 && next === confirm;
  const ready = current.length > 0 && rulesMet && matches && !busy;
  const type = show ? "text" : "password";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await changePasswordAction({
      currentPassword: current,
      newPassword: next,
      confirmPassword: confirm,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Password was not changed.");
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setShow(false);
    setDone(true);
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pw-current">Current password</Label>
        <Input
          id="pw-current"
          type={type}
          autoComplete="current-password"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            setDone(false);
            setError(null);
          }}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw-new">New password</Label>
        <Input
          id="pw-new"
          type={type}
          autoComplete="new-password"
          aria-describedby="pw-rules"
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
            setDone(false);
            setError(null);
          }}
          required
        />
      </div>

      <ul id="pw-rules" className="space-y-1.5">
        {rules.map((r) => (
          <RuleRow key={r.id} met={r.met} label={r.label} />
        ))}
        <RuleRow met={matches} label="Confirmation matches" />
      </ul>

      <div className="space-y-1.5">
        <Label htmlFor="pw-confirm">Confirm new password</Label>
        <Input
          id="pw-confirm"
          type={type}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setDone(false);
            setError(null);
          }}
          required
        />
      </div>

      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        {show ? "Hide passwords" : "Show passwords"}
      </button>

      {error ? <p className="text-sm text-loss">{error}</p> : null}
      {done ? (
        <p className="rounded-md border border-win/40 bg-win/10 px-3 py-2 text-sm text-win">
          Password changed. It is live now — use it the next time you sign in.
        </p>
      ) : null}

      <Button type="submit" disabled={!ready} className="w-full">
        {busy ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
