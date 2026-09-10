-- Every column the daily snapshot reads, asserted to exist.
--
-- scripts/ops/snapshot.ts is the one read behind `npm run ops -- daily`, and
-- it runs unattended in a Routine where nobody sees it fail. A column name
-- that is wrong there is not a type error and not a lint error: PostgREST
-- answers 400 at run time and the whole daily report is a stack trace.
--
-- Three were wrong when this file was written, and none of them could have
-- been caught by tsc:
--   * `owners!inner(...)` embedded in the entries select - a PostgREST query
--     shape used nowhere else in this repo;
--   * first_name, last_name and email selected from v_owner_finance, which
--     carries owner_id and money and nothing else (20260821000002);
--   * payments.paid_at, which does not exist. The column is paid_on, and it
--     is a DATE.
--
-- The list below is the contract. tests/unit/ops-snapshot-reads.test.ts holds
-- it to what snapshot.ts actually selects, so the two cannot drift: this file
-- says the columns exist, that one says these are the columns being read.

begin;
do $$
declare
  v_missing text;
begin
  with want(rel, col) as (values
    ('nfl_games','week'),('nfl_games','day_of_week'),('nfl_games','home_team'),
    ('nfl_games','away_team'),('nfl_games','kickoff_at'),
    ('entries','id'),('entries','owner_id'),('entries','entry_name'),
    ('entries','lynne_number'),('entries','is_free_entry'),('entries','is_gifted'),
    ('entries','player_email'),('entries','submitted_to_lynne_at'),('entries','submitted_as_name'),
    ('picks','entry_id'),('picks','week'),('picks','team'),('picks','submitted_at'),
    ('picks','late'),('picks','source'),
    ('lynne_roster','row_no'),('lynne_roster','names'),('lynne_roster','cells'),
    ('lynne_roster','cell_sources'),('lynne_roster','sheet_sha256'),
    ('lynne_roster','source_file'),('lynne_roster','gmail_message_id'),('lynne_roster','loaded_at'),
    ('v_owner_finance','owner_id'),('v_owner_finance','entry_count'),
    ('v_owner_finance','amount_due_cents'),('v_owner_finance','amount_paid_cents'),
    ('payments','owner_id'),('payments','amount_cents'),('payments','venmo_txn_id'),
    ('payments','paid_on'),('payments','note'),
    ('config','lynne_rate_cents'),
    ('owners','id'),('owners','first_name'),('owners','last_name'),('owners','email'),
    ('owners','participation_status'),
    ('weeks','week'),('weeks','early_deadline_at'),('weeks','late_deadline_at')
  )
  select string_agg(w.rel || '.' || w.col, ', ' order by w.rel, w.col) into v_missing
    from want w
    left join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = w.rel and c.column_name = w.col
   where c.column_name is null;

  if v_missing is not null then
    raise exception 'the daily snapshot reads column(s) that do not exist: %', v_missing;
  end if;
end $$;

-- And the one that was actually wrong, named on its own so a regression says
-- which mistake it is repeating.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'payments'
                and column_name = 'paid_at') then
    raise exception 'payments.paid_at exists again; the snapshot reads paid_on and the two would drift';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'v_owner_finance'
                and column_name in ('first_name', 'last_name', 'email')) then
    raise exception 'v_owner_finance carries a name or an address again; the snapshot joins owners for those';
  end if;
end $$;
rollback;
