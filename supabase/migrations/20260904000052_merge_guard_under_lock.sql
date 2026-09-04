-- Take the rule's advisory lock before admin_merge_owner reads anything.
-- Codex's finding, reproduced against a real database.
--
-- 20260904000049 added a guard refusing the pool runner as a merge source. The
-- guard itself ran unlocked, and it is the first thing the function does -- so
-- it decided from a snapshot that a concurrent transaction could invalidate
-- before the merge took the lock at its first write.
--
-- With no runner yet: the merge reads the source's old email and passes; a
-- concurrent admin_update_owner sets that email to the runner's and commits,
-- and the owners trigger mints the whole backlog under the source; the merge
-- then proceeds on its stale answer. Observed -- the sole runner archived,
-- carrying free entries that had existed for milliseconds, with four of them
-- moved to the target:
--
--   owner            email                      archived  free_entries
--   Brian Yost                                  f         4
--   Marc Massimino   anthonydellapia@gmail.com  t         4
--
-- Precisely the merge the guard exists to reject.
--
-- The lock moves to the top of the function. Now either order is correct: if
-- the update goes first, the guard reads the runner email and refuses; if the
-- merge goes first, the update waits on the lock and finds the source already
-- archived. And taking it before any row lock keeps the ordering the BEFORE
-- triggers establish -- this lock first, row locks second.

create or replace function admin_merge_owner(
  p_source uuid,
  p_target uuid,
  p_actor text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_source owners%rowtype;
  v_target owners%rowtype;
  v_entries int;
  v_pay record;
  v_moved_cents bigint := 0;
  v_moved_count int := 0;
begin
  -- BEFORE the guard below reads anything. That check decides whether this
  -- merge is allowed at all, and it was making that decision unlocked: with no
  -- runner yet, it could read the source's old email, a concurrent
  -- admin_update_owner could set that email to the runner's and commit
  -- (minting the backlog under the source), and this merge would then proceed
  -- on the stale answer -- archiving the sole runner and moving the entries it
  -- had just been given. Reproduced.
  --
  -- Taking the lock here also keeps the ordering the BEFORE triggers
  -- establish: this lock first, row locks second.
  perform pg_advisory_xact_lock(hashtext('mint_free_entries')::bigint);

  if p_source = p_target then
    raise exception 'cannot merge an owner into itself';
  end if;
  -- The runner may be a merge TARGET but never a SOURCE. Merging their row
  -- away would hand their free entries to another person, which "Nobody else
  -- ever gets one" forbids outright, and would leave no owner row for the
  -- free-entry rule to key on. It is also what let that rule re-mint: this RPC
  -- moves the source's entries and then archives it, and the trigger fires in
  -- the gap, when the runner is still live but holds nothing.
  if lower((select o.email from owners o where o.id = p_source))
     = 'anthonydellapia@gmail.com' then
    raise exception
      'refusing to merge the pool runner away: their free entries are theirs alone, and the free-entry rule keys on this owner row'
      using errcode = 'check_violation';
  end if;
  select * into v_source from owners where id = p_source;
  if v_source.id is null then raise exception 'source owner not found'; end if;
  select * into v_target from owners where id = p_target;
  if v_target.id is null then raise exception 'target owner not found'; end if;
  if v_source.deleted_at is not null then
    raise exception 'source owner is already archived';
  end if;
  if v_target.deleted_at is not null then
    raise exception 'target owner is archived — pick a live target';
  end if;
  if exists (select 1 from owners where merged_into_owner_id = p_source) then
    raise exception 'owner has already absorbed a merge and cannot be merged away';
  end if;

  select count(*) into v_entries from entries where owner_id = p_source;

  -- Genuine typo case: nothing held, hard delete.
  if v_entries = 0
     and not exists (select 1 from payments where owner_id = p_source) then
    insert into audit_log (actor, action, target_table, target_id, before, note)
    values (p_actor, 'merge_owner', 'owners', p_source::text, to_jsonb(v_source),
            format('empty owner deleted during merge into %s', p_target));
    delete from owners where id = p_source;
    return jsonb_build_object('deleted', true, 'entries_moved', 0, 'payments_moved', 0);
  end if;

  -- Append-only payment move: reversal on the source, repost on the target.
  for v_pay in
    select * from payments where owner_id = p_source order by created_at
  loop
    insert into payments (owner_id, amount_cents, method, paid_on,
                          venmo_txn_id, note, corrects_payment_id)
    values (p_source, -v_pay.amount_cents, 'correction', v_pay.paid_on,
            v_pay.venmo_txn_id,
            format('merge reversal → %s %s', v_target.first_name, v_target.last_name),
            v_pay.id);
    insert into payments (owner_id, amount_cents, method, paid_on,
                          venmo_txn_id, note, corrects_payment_id)
    values (p_target, v_pay.amount_cents, v_pay.method, v_pay.paid_on,
            v_pay.venmo_txn_id,
            format('merge repost ← %s %s', v_source.first_name, v_source.last_name),
            v_pay.id);
    v_moved_cents := v_moved_cents + v_pay.amount_cents;
    v_moved_count := v_moved_count + 1;
  end loop;

  -- Reassign entries, renumbering after the target's last index so the
  -- (owner_id, entry_index) uniqueness holds; relative order is kept.
  with base as (
    select coalesce(max(entry_index), 0) as m from entries where owner_id = p_target
  ), ordered as (
    select e.id, row_number() over (order by e.entry_index, e.created_at) as rn
    from entries e where e.owner_id = p_source
  )
  update entries e
     set owner_id = p_target,
         entry_index = base.m + ordered.rn
    from ordered, base
   where e.id = ordered.id;

  update owners
     set deleted_at = now(),
         merged_into_owner_id = p_target
   where id = p_source;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'merge_owner', 'owners', p_source::text,
          to_jsonb(v_source), to_jsonb(v_target),
          format('%s entries and %s payments (%s cents) moved to %s %s',
                 v_entries, v_moved_count, v_moved_cents,
                 v_target.first_name, v_target.last_name));

  return jsonb_build_object('deleted', false, 'entries_moved', v_entries,
                            'payments_moved', v_moved_count,
                            'cents_moved', v_moved_cents);
end $$;
