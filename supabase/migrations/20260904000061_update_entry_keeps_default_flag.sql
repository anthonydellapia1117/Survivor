-- `name_is_default` means NOBODY HAS SUPPLIED A REAL NAME YET. It drives the
-- "Default name" filter on /admin/entries, which is the list Anthony works
-- when chasing owners for their real wording. admin_update_entry cleared it on
-- every call, unconditionally, and that is wrong for any caller that submits
-- the name it already read back.
--
-- Two such callers exist, and one of them is a bulk operation:
--
--   * bulkSetLynneNumbersAction re-submits each entry's EXISTING name in order
--     to write a lynne_number through the audited RPC. A Lynne-number paste
--     import therefore stamped "a real name was supplied" across every row it
--     touched, emptying the chase list without anybody typing a name.
--   * The entry dialog now also carries the gift fields from
--     20260904000060. Ticking "played by someone else" on an entry whose name
--     is still the generated default would have cleared the flag as a side
--     effect of an edit that said nothing about naming.
--
-- So clear it only when the submitted name actually DIFFERS from the stored
-- one. `is distinct from`, not `<>`, so a null on either side compares rather
-- than swallowing the branch. Everything else about the function is unchanged.
--
-- This is the same defect class 20260901000021 avoided by giving the numbering
-- conversion its own RPC: "the generic admin_update_entry would have cleared
-- the still-need-to-ask flag". That reasoning was right about the function and
-- the fix belonged in the function.
--
-- Byte-exact comparison, deliberately. Names are stored verbatim and the
-- collision detector depends on case and spacing being the owner's, so
-- "tommybrads" arriving over "Tommybrads" is a real rename and clears the
-- flag, exactly as typing it by hand would.

create or replace function admin_update_entry(
  p_entry_id uuid,
  p_entry_name text,
  p_lynne_label text,
  p_is_free boolean,
  p_lynne_number integer,
  p_is_gifted boolean,
  p_player_email text,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_gifted boolean;
  v_player text;
begin
  select to_jsonb(e) - 'created_at' into v_before from entries e where id = p_entry_id;
  if v_before is null then
    raise exception 'entry % not found', p_entry_id;
  end if;

  -- trim_name_ws, not a bare nullif: the app decides whether an address
  -- exists with JS trim(), and a value only one layer calls blank is a
  -- contact the database believes in and the mail never reaches. Same drift
  -- 20260903000035 introduced this helper to end.
  v_player := nullif(trim_name_ws(coalesce(p_player_email, '')), '');
  v_gifted := coalesce(p_is_gifted, false);

  -- An address is an arrangement. Rather than refuse the write on the check
  -- constraint and make the caller send two fields in the right order, take
  -- the address as proof of the gift.
  if v_player is not null then
    v_gifted := true;
  end if;

  update entries
     set entry_name = p_entry_name,
         name_is_default = case
           when p_entry_name is distinct from (v_before ->> 'entry_name')
             then false
           else name_is_default
         end,
         lynne_label = nullif(p_lynne_label, ''),
         is_free_entry = coalesce(p_is_free, is_free_entry),
         lynne_number = p_lynne_number,
         is_gifted = v_gifted,
         player_email = v_player
   where id = p_entry_id;

  select to_jsonb(e) - 'created_at' into v_after from entries e where id = p_entry_id;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_entry', 'entries', p_entry_id::text, v_before, v_after);
end $$;

-- `create or replace` preserves the ACL, so the grant from 20260904000060
-- carries. Re-stated anyway: two migrations have now shipped green while an
-- admin RPC was uncallable in production because a grant went missing with a
-- dropped signature, and restating a grant that is already correct costs
-- nothing.
revoke execute on function
  admin_update_entry(uuid,text,text,boolean,int,boolean,text,text) from public;

do $$
begin
  revoke execute on function
    admin_update_entry(uuid,text,text,boolean,int,boolean,text,text) from anon;
  grant execute on function
    admin_update_entry(uuid,text,text,boolean,int,boolean,text,text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
