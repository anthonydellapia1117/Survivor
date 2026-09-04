"use client";

// A6: every address on the roster, one COPY ALL producing a BCC-ready
// comma-separated string. Filters: all / paid / unpaid / missing email.
//
// "Every address" includes cc_email contacts. An owner's second contact is a
// person on the roster who is meant to see the same messages; building the
// list from o.email alone drops them from every group send and no filter here
// can reveal it, because the owner they hang off does have an address. Who is
// on the list is decided in groupSendList, not here.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { groupSendList } from "@/lib/emails/group-send";
import { normalizeAddress } from "@/lib/emails/address";

type Filter = "all" | "paid" | "unpaid" | "missing";

interface Row {
  id: string;
  name: string;
  email: string | null;
  ccEmail: string | null;
  status: string;
  paid: boolean;
}

export function EmailsClient({ owners }: { owners: Row[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);

  const confirmed = useMemo(
    () => owners.filter((o) => o.status === "confirmed"),
    [owners],
  );
  // One definition of "has no address", shared with groupSendList — the
  // banner and the Missing-email view contradicted each other when the filter
  // used !o.email and the list used trim().
  const hasEmail = (o: Row) => normalizeAddress(o.email) !== "";
  const filtered = useMemo(() => {
    switch (filter) {
      case "paid":
        return confirmed.filter((o) => o.paid);
      case "unpaid":
        return confirmed.filter((o) => !o.paid);
      case "missing":
        return confirmed.filter((o) => !hasEmail(o));
      default:
        return confirmed;
    }
  }, [confirmed, filter]);

  // The filter chooses the ROWS; groupSendList chooses the addresses those
  // rows contribute.
  //
  // Second contacts ride along on ALL, which is the announcement view. They
  // are deliberately OFF for the money filters and for Missing email: a CC is
  // on the roster to see announcements, not to be BCC'd on a note about the
  // balance of the owner who pays for their entries, and "who can I not
  // reach" is a diagnostic that should not hand back a live address list of
  // different people.
  const includeCcContacts = filter === "all";
  const list = useMemo(
    () => groupSendList(filtered, { includeCcContacts }),
    [filtered, includeCcContacts],
  );
  const missing = useMemo(
    () => groupSendList(confirmed).missingEmail,
    [confirmed],
  );
  const emails = list.addresses;
  const bcc = emails.join(", ");

  async function copyAll() {
    await navigator.clipboard.writeText(bcc);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "paid", label: "Paid" },
    { key: "unpaid", label: "Unpaid" },
    { key: "missing", label: "Missing email" },
  ];

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl">Emails</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          BCC-ready address list for group sends. <strong>All</strong> includes
          second contacts, so somebody who plays entries another owner pays for
          is on it too; the money filters are owners only.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "h-9 rounded-md px-3 text-xs font-semibold transition-colors duration-150",
                filter === f.key
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {emails.length} {emails.length === 1 ? "address" : "addresses"}
          {list.ccContacts.length > 0
            ? ` · ${list.ccContacts.length} second contact${
                list.ccContacts.length === 1 ? "" : "s"
              }`
            : ""}
        </span>
        <Button size="sm" onClick={copyAll} disabled={emails.length === 0}>
          {copied ? "Copied" : "COPY ALL"}
        </Button>
      </div>

      {missing.length > 0 && filter !== "missing" ? (
        <p className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2 text-xs text-tie">
          {missing.length} confirmed{" "}
          {missing.length === 1 ? "owner has" : "owners have"} no email:{" "}
          {missing.map((o) => o.name).join(", ")} — they miss every group send.
        </p>
      ) : null}

      {list.duplicates.length > 0 ? (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
          Sent once each, though{" "}
          {list.duplicates.length === 1 ? "it appears" : "they appear"} on more
          than one row:{" "}
          {list.duplicates
            .map((d) => `${d.address} (repeated on ${d.ownerName})`)
            .join(", ")}
        </p>
      ) : null}

      {bcc ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 font-mono text-xs leading-relaxed">
          {bcc}
        </pre>
      ) : null}

      <ul className="divide-y divide-border/60 rounded-lg border border-border text-sm">
        {filtered.map((o) => (
          <li key={o.id} className="flex items-center gap-3 px-3 py-2">
            <span className="w-44 shrink-0 truncate font-medium">{o.name}</span>
            {o.email ? (
              <span className="truncate text-muted-foreground">{o.email}</span>
            ) : (
              <span className="font-semibold text-tie">NO EMAIL ON FILE</span>
            )}
            {includeCcContacts && o.ccEmail ? (
              <span className="truncate text-xs text-muted-foreground">
                + {o.ccEmail}
              </span>
            ) : null}
            <span
              className={cn(
                "ml-auto text-xs font-medium",
                o.paid ? "text-win" : "text-loss",
              )}
            >
              {o.paid ? "PAID" : "OWES"}
            </span>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nobody matches this filter.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
