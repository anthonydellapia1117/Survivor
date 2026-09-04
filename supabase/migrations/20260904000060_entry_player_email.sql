-- Who PLAYS an entry, as distinct from who bought it.
--
-- Three times now the same shape has turned up: one buyer, one payment at the
-- bulk tier, some of the entries named for other people who need to be
-- reachable. Kris Tomasco bought four and gave two to Chas Flaster; Ray
-- Vassallo bought four and two carry his brother John's name; Nick DiVirgilio
-- bought four and two carry Lou Direnzo's name.
--
-- owners.cc_email solved the first case and breaks at the second giftee,
-- because it is a property of the OWNER and the thing being modelled is a
-- property of the ENTRY. Two giftees on one owner and you are choosing which
-- one gets contacted. It is retired in the next migration, once nothing reads
-- it — one mechanism, not two.
--
-- STANDING, decided by Anthony on 2026-09-04: once an entry is gifted, the
-- GIFTEE owns the pick. Chas replying to change his own pick is legitimate and
-- is acted on. What the giftee does not get is the money or the tier — those
-- stay with the buyer, which is why this is a column on entries and not a
-- second owner row. Ownership, billing and the 4+ tier are untouched by it.
--
-- TWO columns, not one. `player_email` alone cannot say "this entry is
-- somebody else's and I do not have their address yet" — the state Lou
-- Direnzo is in right now — and that is exactly the gap worth chasing. So the
-- fact of the gift is its own bit, and the address hangs off it. The check
-- constraint keeps them honest: an address implies a gift.

alter table entries add column if not exists is_gifted boolean not null default false;
alter table entries add column if not exists player_email text;

alter table entries drop constraint if exists entries_player_email_implies_gifted;
alter table entries add constraint entries_player_email_implies_gifted
  check (player_email is null or is_gifted);

comment on column entries.is_gifted is
  'This entry is played by someone other than the owner who paid for it. The '
  'giftee has standing on the pick; the owner keeps the money and the tier. '
  'True with a null player_email is a real state: gifted, address not yet '
  'known - a gap to chase, surfaced on the pick-emails screen.';
comment on column entries.player_email is
  'Where THIS ENTRY''s pick request goes. Null means the owner plays it. '
  'Requires is_gifted, so an address can never imply an arrangement the '
  'roster does not otherwise record.';

-- admin_update_entry carries the two new fields. Both older signatures are
-- DROPPED rather than left beside the new one: three overloads differing only
-- in trailing arguments is how a caller silently keeps writing an old shape,
-- and 20260904000058 already proved that dropping a signature drops its grants
-- with it. The revoke AND the grant are both re-applied below.
drop function if exists admin_update_entry(uuid, text, text, boolean, text);
drop function if exists admin_update_entry(uuid, text, text, boolean, int, text);

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
         name_is_default = false,
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

-- No public view gains either column. A giftee's address is contact data of
-- exactly the class owners.email is, and v_entry_public lists its columns
-- explicitly, so this is a statement of intent rather than a change.
