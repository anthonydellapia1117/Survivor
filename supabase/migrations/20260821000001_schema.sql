-- Survivor Pool 2026 — core schema
-- Principle (spec 2.1): nothing derived is ever stored. Money, counts, lives,
-- and status are computed from the ledger and picks at read time.

-- OWNERS
create table owners (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text unique,                  -- nullable: text/in-person signups are legitimate
  phone text,
  source text not null default 'email', -- email | text | in_person | import
  source_ref text,                    -- gmail message id, or free text
  participation_status text not null default 'confirmed'
    check (participation_status in ('confirmed','declined','pending')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ENTRIES
create table entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete restrict,
  entry_index int not null,
  entry_name text not null,           -- VERBATIM. Never normalized, cased, or trimmed for display.
  name_is_default boolean not null default false, -- true when auto-generated "Full Name 1"
  lynne_label text,                   -- what Lynne's file calls it, if different
  is_free_entry boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, entry_index)
);
create index entries_lower_name on entries (lower(entry_name));  -- matching only; display uses entry_name raw

-- PAYMENTS: append-only ledger. Corrections are new rows, never edits or deletes.
create table payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references owners(id),  -- null = unmatched, quarantined
  amount_cents int not null,            -- negative allowed for corrections
  method text not null check (method in ('venmo','cash','check','correction','comp')),
  paid_on date not null,
  venmo_txn_id text unique,             -- unique constraint IS the dedupe
  source_ref text,
  note text,
  corrects_payment_id uuid references payments(id),
  created_at timestamptz not null default now()
);

-- WEEKS
create table weeks (
  week int primary key check (week between 1 and 18),
  window_label text not null,          -- 'thu_fri' | 'sat_mon'
  deadline_at timestamptz not null,
  results_final boolean not null default false
);

-- PICKS: append-only with supersession. Never UPDATE a pick row's team.
create table picks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  week int not null references weeks(week),
  team text not null,                  -- NFL abbreviation, or 'SKIP_WEEK' for a bye
  submitted_at timestamptz not null default now(),
  source text not null default 'admin' check (source in ('admin','lynne_import','player','override')),
  source_ref text,
  supersedes_id uuid references picks(id),
  is_current boolean not null default true,
  late boolean not null default false, -- submitted_at > week deadline
  result text check (result in ('win','loss','tie_loss','bye','pending','missed')),
  result_source text,                  -- 'lynne' | 'manual'
  created_at timestamptz not null default now()
);
create unique index picks_one_current on picks (entry_id, week) where is_current;

-- AUDIT: every write, no exceptions
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target_table text not null,
  target_id text,
  before jsonb,
  after jsonb,
  note text
);

-- LYNNE IMPORTS: idempotent by file hash
create table lynne_imports (
  id uuid primary key default gen_random_uuid(),
  week int references weeks(week),
  filename text not null,
  file_sha256 text not null unique,    -- re-importing the same file is a no-op
  imported_at timestamptz not null default now(),
  row_count int,
  matched_count int,
  unmatched jsonb,                     -- rows that could not be matched, for review
  variances jsonb                      -- where Lynne disagrees with local state
);

-- CONFIG: single row, editable in admin
create table config (
  id int primary key default 1 check (id = 1),
  tier_1_3_cents int not null default 3000,
  tier_4plus_cents int not null default 2500,
  lynne_rate_cents int not null default 2500,
  free_entry_ratio int not null default 10,
  double_elim_through_week int not null default 7,
  season_status text not null default 'open',
  timezone text not null default 'America/New_York'
);
