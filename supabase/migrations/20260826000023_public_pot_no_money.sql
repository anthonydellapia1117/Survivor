-- No money from THIS group on any public surface. The public pot card used
-- to serve collected/due dollars — that is the runner's collection status,
-- not pool information, and no player should see it. The money columns are
-- removed from v_pot outright (structurally absent, the same treatment email
-- and phone get in v_public_owners) rather than merely hidden by the UI.
--
-- What replaces them: the recruited entry count (entries people actually pay
-- for; the runner's free AAA entries are excluded) and the POOL-WIDE pot from
-- Lynne's full pool, which is the number a player would care about and is
-- deliberately public. Both pool fields stay null until the runner enters the
-- numbers Lynne sends, so the card shows an honest "pending" until then.

-- ----------------------------------------------------------------- config
alter table config add column pool_entry_count int
  check (pool_entry_count is null or pool_entry_count >= 0);
alter table config add column pool_pot_cents bigint
  check (pool_pot_cents is null or pool_pot_cents >= 0);
alter table config add column pool_updated_at timestamptz;

comment on column config.pool_entry_count is
  'Master entry count for Lynne''s whole pool (~1,250 in 2026). Admin-entered.';
comment on column config.pool_pot_cents is
  'Prize pot for Lynne''s whole pool, entered directly — never derived from an
   unconfirmed per-entry formula. Public by design; this is pool information,
   not the runner''s collection status.';

-- ------------------------------------------------------------------ v_pot
-- Dropped and recreated: the column set changes, which CREATE OR REPLACE
-- cannot do. due_cents and paid_cents do not come back.
drop view if exists v_pot;

create view v_pot as
select
  -- Entries people actually buy. Free entries belong to the runner and
  -- nobody pays for them, so they are not part of this count.
  (select count(*)
     from entries e
     join owners o on o.id = e.owner_id
    where o.participation_status = 'confirmed'
      and o.deleted_at is null
      and e.voided_at is null
      and not e.is_free_entry)::int as recruited_entry_count,
  (select count(*)
     from entries e
     join owners o on o.id = e.owner_id
    where o.participation_status = 'confirmed'
      and o.deleted_at is null
      and e.voided_at is null)::int as entry_count,
  c.pool_entry_count,
  c.pool_pot_cents
from config c;

grant select on v_pot to anon, authenticated;

-- -------------------------------------------------------------------- RPC
-- Set (or clear) the pool-wide numbers. Invoker rights: the admin_all_config
-- RLS policy is the guard, and a zero row count means the caller was not the
-- admin — raise rather than report a silent success.
create or replace function admin_set_pool_pot(
  p_entry_count int,
  p_pot_cents bigint,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  n int;
begin
  if p_entry_count is not null and p_entry_count < 0 then
    raise exception 'pool entry count cannot be negative';
  end if;
  if p_pot_cents is not null and p_pot_cents < 0 then
    raise exception 'pool pot cannot be negative';
  end if;

  select jsonb_build_object('pool_entry_count', pool_entry_count,
                            'pool_pot_cents', pool_pot_cents)
    into v_before
    from config where id = 1;

  update config
     set pool_entry_count = p_entry_count,
         pool_pot_cents = p_pot_cents,
         pool_updated_at = case
           when p_entry_count is null and p_pot_cents is null then null
           else now()
         end
   where id = 1;

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'config not updated — admin privileges required';
  end if;

  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'set_pool_pot', 'config', '1', v_before,
          jsonb_build_object('pool_entry_count', p_entry_count,
                             'pool_pot_cents', p_pot_cents));
end $$;

revoke execute on function admin_set_pool_pot(int,bigint,text) from public;

do $$
begin
  revoke execute on function admin_set_pool_pot(int,bigint,text) from anon;
  grant execute on function admin_set_pool_pot(int,bigint,text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
