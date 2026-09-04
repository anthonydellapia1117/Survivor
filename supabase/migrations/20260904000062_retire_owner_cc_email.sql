-- Retire owners.cc_email. entries.player_email covers it and covers it better,
-- and Anthony's instruction on 2026-09-04 was explicit: one mechanism, not two.
--
-- cc_email answered "who else should see this owner's mail". player_email
-- answers "who plays THIS entry", which is the question actually being asked
-- every time the shape has come up. The owner-level column could not survive
-- a second giftee on one owner -- Kris Tomasco has one, but Nick DiVirgilio's
-- two Lou Direnzo entries sit beside two of his own, and an owner with two
-- different giftees would have had to pick which one got contacted.
--
-- Leaving both would be worse than either. Two columns that mean almost the
-- same thing drift: one screen reads cc_email, another reads player_email, and
-- the day they disagree somebody does not get their pick request. That is the
-- exact failure Anthony named -- "Chas does not get his email and I would not
-- know" -- so the second mechanism goes.

-- REFUSE rather than lose a contact. A cc_email still on file that no gifted
-- entry carries is somebody the roster can currently reach and would silently
-- stop reaching. On production this passes because Kris Tomasco's CC was
-- carried onto Chas Flaster #1-#2 before this ran; on a replay there are no
-- cc_email rows at all. It exists for the third case: a database where one was
-- set and never migrated.
--
-- Case-insensitive, matching sameAddress() in src/lib/emails/address.ts --
-- mailbox case is not significant and "Chas@" carried across as "chas@" is the
-- same person, not an uncovered contact.
do $$
declare
  v_orphans text;
begin
  select string_agg(format('%s %s <%s>', o.first_name, o.last_name, o.cc_email), '; ')
    into v_orphans
    from owners o
   where o.cc_email is not null
     and trim_name_ws(o.cc_email) <> ''
     -- LIVE owners only. admin_merge_owner moves a source's entries to the
     -- target and leaves an archived shell behind, contact fields intact, so
     -- a shell can never satisfy the "an entry carries it" test below -- its
     -- entries belong to somebody else now. Scanning shells would raise on a
     -- contact that is not lost (nobody plays anything under a shell) and
     -- hand out a hint that cannot be followed. Every owner-reading view
     -- filters shells out for the same reason; this guard reads the table
     -- directly, so it has to do it itself.
     and o.merged_into_owner_id is null
     and not exists (
       select 1 from entries e
        where e.owner_id = o.id
          and e.is_gifted
          and lower(trim_name_ws(coalesce(e.player_email, '')))
              = lower(trim_name_ws(o.cc_email))
     );
  if v_orphans is not null then
    raise exception
      'cc_email would be dropped without an entry carrying it: %', v_orphans
      using hint = 'Set player_email on the gifted entries first, then re-run.';
  end if;
end $$;

-- Back to the eight-argument signature 20260904000058 replaced. Dropped, not
-- left beside the new one: an overload differing only by one trailing text
-- argument is how a caller silently keeps writing the old shape.
drop function if exists
  admin_update_owner(uuid, text, text, text, text, text, text, text, text);

create or replace function admin_update_owner(
  p_owner_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_participation_status text,
  p_notes text,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select to_jsonb(o) - 'created_at' - 'updated_at' into v_before from owners o where id = p_owner_id;
  if v_before is null then
    raise exception 'owner % not found', p_owner_id;
  end if;

  update owners
     set first_name = p_first_name,
         last_name = p_last_name,
         email = nullif(p_email, ''),
         phone = nullif(p_phone, ''),
         participation_status = p_participation_status,
         notes = nullif(p_notes, ''),
         updated_at = now()
   where id = p_owner_id;

  select to_jsonb(o) - 'created_at' - 'updated_at' into v_after from owners o where id = p_owner_id;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_owner', 'owners', p_owner_id::text, v_before, v_after);
end $$;

-- THE GRANT. Dropping a signature drops its grants with it, and this exact
-- function has now lost its grant to that mechanic twice -- 20260903000034 and
-- 20260904000058, the second of which reached production and made owner
-- editing fail with "permission denied". The app holds no service-role key by
-- design and calls this as the signed-in admin, so the grant is not optional.
revoke execute on function
  admin_update_owner(uuid,text,text,text,text,text,text,text) from public;

do $$
begin
  revoke execute on function
    admin_update_owner(uuid,text,text,text,text,text,text,text) from anon;
  grant execute on function
    admin_update_owner(uuid,text,text,text,text,text,text,text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;

-- RESTORING A BACKUP TAKEN WHILE THE COLUMN EXISTED
--
-- src/lib/backup.ts names every live column in its INSERT statements, deriving
-- them from the row keys at dump time. A backup taken while cc_email existed
-- therefore contains `insert into owners (..., cc_email, ...)`, and the restore
-- procedure says to apply every migration first -- so this drop makes that
-- insert fail with `column "cc_email" does not exist`, and because the restore
-- is one transaction the WHOLE thing rolls back.
--
-- In production that window was 2026-09-04 02:43:11 to 15:55:39 UTC. It is
-- closed: nothing taken after this migration carries the column. A backup FILE
-- from inside it can still be sitting on disk, so the remedy, which is two
-- lines and does not require editing the dump:
--
--   alter table owners add column if not exists cc_email text;
--   -- run the backup file
--   alter table owners drop column cc_email;
--
-- The failure is loud, names the column, and leaves no partial state, so this
-- is a note rather than a compatibility shim. Keeping a dead column alive to
-- make one 13-hour window restorable is the second mechanism this migration
-- exists to remove. The GENERAL case -- any future column drop breaking any
-- older backup -- is worth fixing in the dump format itself and is not this
-- PR's to widen into.
--
-- The column goes last, after the guard has cleared it and after the only
-- function that wrote it no longer exists.
alter table owners drop column if exists cc_email;
