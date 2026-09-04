-- The held count goes back to the runner's own rows; the NUMBERING stays
-- pool-wide; and the merge transient that pool-wide counting was papering over
-- is closed at its source. Codex's finding, reproduced against a real database.
--
-- 20260904000048 made both reads pool-wide to stop a runner-source merge
-- re-minting. Half of that was right and half of it was worse than the bug.
--
-- WHAT WAS WRONG: the held count
--
-- The entitlement is ANTHONY'S. CLAUDE.md: the free entries are "Anthony's
-- only", "Nobody else ever gets one". A free entry that has ended up under
-- somebody else is therefore not part of what he holds, and counting it as if
-- it were suppresses a mint he is owed.
--
-- Not hypothetical: the admin UI puts a "free" checkbox on the add and edit
-- dialogs for ANY owner (owner-dialogs.tsx, bulk-add-dialog.tsx,
-- entry-edit-dialog.tsx). One tick of it, then a threshold crossing:
--
--   recruited | anthony_is_owed | anthony_holds | pool_free_shown_on_admin
--          60 |               6 |             5 |                        6
--
-- Silently one short, and no warning anywhere -- /admin counted pool-wide too,
-- so it compared 6 against 6 and saw nothing. That is worse than the merge bug
-- it was introduced to fix, because it takes no unusual operation at all, just
-- a checkbox. (This migration ships with the /admin side corrected too: the
-- entitlement is compared against the runner's rows, and a free entry under
-- anyone else is surfaced on its own.)
--
-- WHAT WAS RIGHT: the numbering
--
-- v_max stays pool-wide, on its own merits: a number Lynne holds must never
-- come back, and which owner row carries it today has nothing to do with that.
-- Scoping it to the runner is what let the merge restart at AAA #1.
--
-- THE MERGE, CLOSED AT ITS SOURCE
--
-- admin_merge_owner moves the source's entries to the target and then archives
-- the source; with the runner as source the trigger fires in the gap and sees
-- an empty entitlement. Rather than teach the counting to tolerate that
-- transient -- which only worked by making an ordinary checkbox dangerous --
-- the operation itself is refused. Merging the runner INTO someone else would
-- hand Anthony's free entries to another person and leave the pool with no
-- runner row for the rule to key on. Merging a duplicate INTO the runner is
-- untouched: that is the direction that makes sense and the one he would use.

create or replace function mint_free_entries()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Mirrors FREE_ENTRY_OWNER_EMAIL in src/lib/free-entries.ts. A trigger
  -- cannot import from TypeScript, so this literal is the drift risk: change
  -- it on one side and the app keeps flagging the right owner while the
  -- trigger quietly mints for nobody. tests/unit/free-entry-enforcement.test.ts
  -- reads this file and asserts the two still match.
  v_email  constant text := 'anthonydellapia@gmail.com';
  v_owner  uuid;
  v_ratio  int;
  v_target int;
  v_have   int;
  v_max    int;
  v_idx    int;
  v_i      int;
  v_names  text[] := '{}';
begin
  -- The mint below writes to `entries`, which re-enters this trigger. One
  -- level is all the rule needs: by the time it re-fires the entitlement is
  -- already satisfied, but returning early is cheaper and states the intent.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- BEFORE ANY READ. Every count below is taken under this lock, so a
  -- transaction can never decide from a snapshot that predates a concurrent
  -- roster change -- it waits for that transaction to commit and then sees it.
  -- Skipping this for writes that look like they owe nothing is what silently
  -- under-minted; see the header.
  --
  -- pg_advisory_xact_lock specifically: transaction-scoped, so it releases on
  -- commit or rollback with no unlock path to forget, and it is safe behind
  -- PgBouncer's transaction pooling, which a session-level pg_advisory_lock
  -- would leak straight through. Keyed off the rule's own name so it cannot
  -- collide with an unrelated advisory lock added later; it is the only one in
  -- this schema, so there is no second lock to deadlock against by ordering.
  -- Re-acquiring it within the same transaction is free, which is what makes
  -- an RPC that writes owners and then entries in a loop cheap.
  perform pg_advisory_xact_lock(hashtext('mint_free_entries')::bigint);

  select o.id into v_owner
    from owners o
   where lower(o.email) = v_email
     and o.participation_status = 'confirmed'
     and o.deleted_at is null
   limit 1;
  -- No runner row yet (a fresh database mid-seed): nothing to earn against.
  -- Once one appears, the trigger on `owners` settles the backlog at once.
  if v_owner is null then
    return null;
  end if;

  select c.free_entry_ratio into v_ratio from config c limit 1;
  v_ratio := greatest(coalesce(v_ratio, 10), 1);

  -- Recruited = live, non-free entries. Free entries never earn more free
  -- entries, and an archived owner's entries were reassigned before archiving
  -- (admin_merge_owner), so excluding them cannot drop a live entry.
  select floor(count(*) / v_ratio) into v_target
    from entries e
    join owners o on o.id = e.owner_id
   where e.voided_at is null
     and not e.is_free_entry
     and o.deleted_at is null;

  -- THE RUNNER'S OWN ROWS. The entitlement is his: CLAUDE.md says the free
  -- entries are "Anthony's only" and "Nobody else ever gets one", so a free
  -- entry sitting under somebody else is not part of what he has earned, and
  -- counting it as if it were suppresses a mint he is owed.
  --
  -- 20260904000048 counted these pool-wide to stop a runner-source merge
  -- re-minting, and that was the wrong lever. The merge transient is closed at
  -- its source below instead.
  select count(*) filter (where e.voided_at is null) into v_have
    from entries e
   where e.owner_id = v_owner and e.is_free_entry;

  if v_have >= v_target then
    return null;
  end if;

  -- The highest number that has EVER existed: any owner, voided or not,
  -- archived or not. A number Lynne holds must never come back, and which
  -- owner row happens to carry it today has nothing to do with that -- scoping
  -- this to the runner is what let a merge restart the numbering at 1. Both
  -- separator forms are parsed: the pre-2026-09-01 names were "AAA 1".."AAA 7"
  -- and a reader that understood only "AAA #n" would also restart at 1.
  select coalesce(max((regexp_match(e.entry_name, '^AAA #?(\d+)$'))[1]::int), 0)
    into v_max
    from entries e
   where e.is_free_entry;

  select coalesce(max(e.entry_index), 0) into v_idx
    from entries e where e.owner_id = v_owner;

  for v_i in 1..(v_target - v_have) loop
    v_idx := v_idx + 1;
    v_max := v_max + 1;
    insert into entries (owner_id, entry_index, entry_name,
                         name_is_default, is_free_entry)
    values (v_owner, v_idx, 'AAA #' || v_max, false, true);
    v_names := v_names || ('AAA #' || v_max);
  end loop;

  -- Audited in the same transaction as the write, like every other mutation
  -- here: the entries row and its audit row commit together or neither does.
  insert into audit_log (actor, action, target_table, target_id, after)
  values ('system (free-entry rule)', 'mint_free_entries', 'entries',
          v_owner::text,
          jsonb_build_object('minted', v_names, 'entitlement', v_target,
                             'held_before', v_have));
  return null;
end $$;

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
