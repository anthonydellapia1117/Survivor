# Survivor 2026

Live tracker for the 2026 NFL Survivor Pool (run under Lynne Piazza's master
pool). Players get a read-only link; the admin gets a full write surface.
Built per `SURVIVOR_APP_BUILD_SPEC.md` — that file is the authority on rules.

## Stack

Next.js 15 (App Router, TS strict) · Tailwind v4 + shadcn/ui · Supabase
(Postgres + Auth) · Recharts · TanStack Table · SheetJS · Vercel.

## Core principles

- **Nothing derived is ever stored.** Money, lives, standings, and statuses
  are computed by SQL views (`v_owner_finance`, `v_entry_standing`) at read
  time. There is no code path that writes a total.
- **Append-only money and picks.** Payments are deduped by
  `venmo_txn_id UNIQUE`; corrections are new rows. Pick overrides supersede;
  a pick row's team is never edited.
- **Every write is audited in the same transaction** via the `admin_*`
  Postgres functions. Data and audit commit together or neither does.
- **Lynne's published results are authoritative** on wins/losses/standings;
  this app is authoritative on what was submitted and when. Disagreements
  are variances — displayed, never auto-resolved.

## Setup

1. **Supabase**: create a project, then apply `supabase/migrations/*.sql` in
   filename order (SQL editor or `supabase db push`). Then run
   `supabase/seed.sql` once (it refuses to run twice).
2. **Admin account**: Authentication → Users → create the user matching
   `ADMIN_EMAIL` with a password. The RLS policies check
   `app.admin_email`, which migration `..0003_rls.sql` sets at the database
   level — keep it in sync with the env var.
3. **Env vars** (`.env.local` locally, Project → Settings → Environment
   Variables on Vercel): see `.env.example`.
4. **Vercel**: connect the repo; production deploys from `main`.

## Development

```sh
npm run dev          # against Supabase env vars
npm test             # vitest unit suite (rules, parser, matcher, dashboard)
npm run test:db      # full SQL suite against a throwaway local Postgres 16
```

For UI work without Supabase, the local backend serves the seeded test
database directly:

```sh
scripts/db/test-db.sh                       # build survivor_test locally
LOCAL_PG_URL="postgresql://postgres@localhost/survivor_test?host=/tmp/pg" \
ADMIN_DEV_BYPASS=1 npm run dev              # dev bypass never works in prod
```

`scripts/db/demo-picks.sql` fills weeks 1–5 with fabricated picks for visual
testing — never run it against production.

## Layout

- `supabase/migrations/` — schema, views, RLS, RPCs; `supabase/seed.sql`
- `src/lib/data/` — public + admin data backends (Supabase REST in prod,
  local Postgres in dev), identical shapes
- `src/lib/lynne/` — import parser / matcher / variance planner
- `src/app/admin/` — auth-gated write surfaces; every mutation goes through
  `src/app/admin/actions.ts`
- `tests/sql/` + `tests/unit/` — the locked business rules, each as a test
