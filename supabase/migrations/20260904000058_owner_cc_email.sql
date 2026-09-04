-- A second contact address on an owner, for the case where one person owns
-- and pays for entries that somebody else actually plays.
--
-- Kris Tomasco owns four; two of them are Chas Flaster's. Chas could not be
-- reached, and the tempting fix was to split the four into two owners — which
-- would have dropped Kris out of the 4+ tier and invited a per-owner rate
-- field to paper over the $20. Ownership is not the problem; contact is. One
-- email still goes to the owner, listing all four entries, with the second
-- address CC'd so the player can see the two that are theirs.
--
-- Deliberately NOT added to admin_create_owner. A secondary contact is
-- something you learn later — nobody volunteers it at intake — and leaving
-- that signature alone keeps the free-entry SQL suite, which calls it a few
-- dozen times, off this change entirely.

alter table owners add column if not exists cc_email text;

comment on column owners.cc_email is
  'Optional second contact address, CC''d on that owner''s pick email. For an '
  'owner who pays for entries another person plays. Admin-only, like email: '
  'no public view selects it.';

-- admin_update_owner gains p_cc_email. The old eight-argument signature is
-- DROPPED rather than left beside the new one: two overloads differing only in
-- a trailing text would mean a caller that forgets the argument silently keeps
-- writing the old shape, and this app has exactly one caller.
drop function if exists admin_update_owner(uuid, text, text, text, text, text, text, text);

create or replace function admin_update_owner(
  p_owner_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_cc_email text,
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
         -- Same normalisation as email: empty means "none", not "".
         cc_email = nullif(p_cc_email, ''),
         phone = nullif(p_phone, ''),
         participation_status = p_participation_status,
         notes = nullif(p_notes, ''),
         updated_at = now()
   where id = p_owner_id;

  select to_jsonb(o) - 'created_at' - 'updated_at' into v_after from owners o where id = p_owner_id;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_owner', 'owners', p_owner_id::text, v_before, v_after);
end $$;

-- Same revoke the original signature carried. Dropping the function dropped
-- its grants with it, so the new one has to be locked down again.
do $$
begin
  execute 'revoke execute on function admin_update_owner(uuid,text,text,text,text,text,text,text,text) from public';
  begin
    execute 'revoke execute on function admin_update_owner(uuid,text,text,text,text,text,text,text,text) from anon, authenticated';
  exception when undefined_object then
    null; -- roles absent outside supabase
  end;
end $$;
