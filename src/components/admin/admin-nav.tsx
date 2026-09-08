"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Five groups, one row, and only the active group's pages underneath. Every
// route is where it was; this is the map, not the territory. The Now group
// carries the open queue count so it is visible from any admin page.

interface NavLink {
  href: string;
  label: string;
  /** Match the exact path only; /admin must not claim every admin page. */
  exact?: boolean;
}

export interface NavGroup {
  key: "now" | "picks" | "people" | "season" | "system";
  label: string;
  links: NavLink[];
}

export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    key: "now",
    label: "Now",
    links: [
      { href: "/admin", label: "Overview", exact: true },
      { href: "/admin/queue", label: "Queue" },
      { href: "/admin/deadline", label: "Deadline" },
    ],
  },
  {
    key: "picks",
    label: "Picks",
    links: [
      { href: "/admin/picks", label: "Picks" },
      { href: "/admin/lynne-submit", label: "Send to master pool" },
      { href: "/admin/emails/picks", label: "Pick emails" },
    ],
  },
  {
    key: "people",
    label: "People",
    links: [
      { href: "/admin/entries", label: "Entries" },
      { href: "/admin/owners", label: "Owners" },
      { href: "/admin/payments", label: "Payments" },
      { href: "/admin/quick", label: "Quick add" },
    ],
  },
  {
    key: "season",
    label: "Season",
    links: [
      { href: "/admin/weeks", label: "Weeks" },
      { href: "/admin/games", label: "Games" },
      { href: "/admin/scores", label: "Scores" },
      { href: "/admin/recap", label: "Recap" },
      { href: "/admin/import", label: "Import" },
    ],
  },
  {
    key: "system",
    label: "System",
    links: [
      { href: "/admin/emails", label: "Emails" },
      { href: "/admin/audit", label: "Audit" },
      { href: "/admin/account", label: "Account" },
    ],
  },
];

function linkMatches(link: NavLink, pathname: string): boolean {
  if (link.exact) return pathname === link.href;
  return pathname === link.href || pathname.startsWith(link.href + "/");
}

/** The group owning the pathname: the longest matching link wins, so
 *  /admin/emails/picks is Picks and not System. Unknown admin pages (the
 *  week cockpit) fall to Now. */
export function activeGroup(pathname: string): NavGroup {
  let best: { group: NavGroup; len: number } | null = null;
  for (const group of ADMIN_NAV_GROUPS) {
    for (const link of group.links) {
      if (linkMatches(link, pathname) && (!best || link.href.length > best.len)) {
        best = { group, len: link.href.length };
      }
    }
  }
  return best?.group ?? ADMIN_NAV_GROUPS[0];
}

function Badge({ n }: { n: number }) {
  return (
    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground tabular-nums">
      {n}
    </span>
  );
}

export function AdminNav({ queueCount = 0 }: { queueCount?: number }) {
  const pathname = usePathname();
  const active = activeGroup(pathname);
  return (
    <div className="space-y-2">
      <nav
        aria-label="Admin sections"
        className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1"
      >
        {ADMIN_NAV_GROUPS.map((g) => (
          <Link
            key={g.key}
            href={g.links[0].href}
            aria-current={g.key === active.key ? "true" : undefined}
            className={cn(
              "flex items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground",
              g.key === active.key && "bg-surface-2 text-foreground",
            )}
          >
            {g.label}
            {g.key === "now" && queueCount > 0 ? <Badge n={queueCount} /> : null}
          </Link>
        ))}
      </nav>
      <nav aria-label={`${active.label} pages`} className="flex flex-wrap gap-1 px-1">
        {active.links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={linkMatches(l, pathname) ? "page" : undefined}
            className={cn(
              "flex items-center whitespace-nowrap rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground",
              linkMatches(l, pathname) && "bg-surface-2 font-medium text-foreground",
            )}
          >
            {l.label}
            {l.href === "/admin/queue" && queueCount > 0 ? <Badge n={queueCount} /> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
