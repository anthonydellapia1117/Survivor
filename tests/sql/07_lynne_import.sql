-- Lynne import RPC: idempotent by file hash, applies only pre-screened
-- results, stores variances without touching picks (acceptance 7 + 8).

begin;

do $$
declare
  scratch uuid;
  e1 uuid; e2 uuid;
  import_id uuid;
  n int;
begin
  insert into owners (first_name, last_name) values ('Lynne','Test') returning id into scratch;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 1, 'LT 1') returning id into e1;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 2, 'LT 2') returning id into e2;
  insert into picks (entry_id, week, team, result) values (e1, 1, 'KC', 'pending');
  insert into picks (entry_id, week, team, result) values (e2, 1, 'BUF', 'pending');

  -- Commit: e1's win applies; e2 is a recorded team variance, NOT applied.
  import_id := admin_apply_lynne_import(
    1, 'week1.xlsx', 'HASH-A',
    '[{"entry":"LT 1","team":"KC","result":"win"},{"entry":"LT 2","team":"MIA","result":"loss"}]'::jsonb,
    2, 2, '[]'::jsonb,
    '[{"type":"team_mismatch","entryId":"x","entryName":"LT 2"}]'::jsonb,
    jsonb_build_array(jsonb_build_object('entry_id', e1, 'result', 'win')),
    'test');

  if (select result from picks where entry_id = e1 and week = 1 and is_current) <> 'win' then
    raise exception 'matched result not applied';
  end if;
  if (select result_source from picks where entry_id = e1 and week = 1 and is_current) <> 'lynne' then
    raise exception 'applied result must be attributed to lynne';
  end if;
  -- The variance entry keeps its local state untouched.
  if (select result from picks where entry_id = e2 and week = 1 and is_current) <> 'pending' then
    raise exception 'variance was auto-resolved — forbidden';
  end if;
  if (select team from picks where entry_id = e2 and week = 1 and is_current) <> 'BUF' then
    raise exception 'variance changed the local team — forbidden';
  end if;

  -- Import record stored with rows + variances.
  select count(*) into n from lynne_imports where file_sha256 = 'HASH-A'
    and jsonb_array_length(rows) = 2 and jsonb_array_length(variances) = 1;
  if n <> 1 then raise exception 'import record incomplete'; end if;

  -- Re-importing the same file is a no-op refusal.
  begin
    perform admin_apply_lynne_import(1, 'week1-copy.xlsx', 'HASH-A',
      '[]'::jsonb, 0, 0, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'test');
    raise exception 'duplicate file hash accepted';
  exception when others then
    if sqlerrm not like '%already imported%' then raise; end if;
  end;

  -- Audit rows: one per applied result plus the import summary.
  select count(*) into n from audit_log where action in ('lynne_result','lynne_import');
  if n < 2 then raise exception 'lynne import under-audited'; end if;
end $$;

rollback;
