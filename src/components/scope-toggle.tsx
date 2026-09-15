// Everyone or our group, for the server-rendered public pages (Dashboard,
// Schedule, Records). Set by Anthony on 2026-09-15: every viewer KPI shows
// the whole pool, and this group's own figures appear only when this is set
// to Our group. The Grid and Teams pages keep their own client-side toggles
// with the same two words; here the choice rides in the URL (?scope=ours),
// so the page renders on the server with no client code and a link to one
// scope stays that scope.

import Link from "next/link";
import { cn } from "@/lib/utils";

export type Scope = "pool" | "ours";

/**
 * The scope a page renders. The whole pool unless the URL asks for our group,
 * and our group whenever her sheet is not loaded - there is no pool to show.
 */
export function scopeFrom(param: string | string[] | undefined, poolLoaded: boolean): Scope {
  if (!poolLoaded) return "ours";
  return param === "ours" ? "ours" : "pool";
}

/** The same page in the other scope, keeping every other parameter it had. */
export function scopeHref(path: string, scope: Scope, params: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && k !== "scope") q.set(k, v);
  if (scope === "ours") q.set("scope", "ours");
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export function ScopeToggle({
  scope,
  poolCount,
  oursCount,
  path,
  params,
  counts = true,
}: {
  scope: Scope;
  /** Rows on her newest sheet; null when none is loaded. */
  poolCount: number | null;
  oursCount: number;
  path: string;
  params?: Record<string, string | undefined>;
  /** Off where a count would mislead, as on the 2025 archive's partial sheet. */
  counts?: boolean;
}) {
  const options: { key: Scope; label: string; n: number | null }[] = [
    { key: "pool", label: "Everyone", n: poolCount },
    { key: "ours", label: "Our group", n: oursCount },
  ];
  return (
    <nav aria-label="Everyone or our group" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {options.map((o) => {
        const active = scope === o.key;
        const cls = cn(
          "flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide transition-colors duration-150",
          active ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground",
        );
        const body = (
          <>
            {o.label}
            {counts && o.n !== null ? <span className="tabular-nums opacity-70">{o.n.toLocaleString("en-US")}</span> : null}
          </>
        );
        if (o.key === "pool" && poolCount === null) {
          return (
            <span key={o.key} className={cn(cls, "opacity-50")} aria-disabled="true">
              {body}
            </span>
          );
        }
        return (
          <Link
            key={o.key}
            href={scopeHref(path, o.key, params)}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cls}
          >
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
