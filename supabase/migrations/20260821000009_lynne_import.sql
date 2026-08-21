-- Lynne import: store rows as received, and apply results transactionally.

-- The /lynne board shows her table exactly as received.
alter table lynne_imports add column rows jsonb;

-- Commit an import: one transaction covering the import record, every
-- result applied, and the audit rows. The file_sha256 unique constraint is
-- the idempotency — a repeated file raises 'already imported' and nothing
-- is written. Variances are stored for display, NEVER applied (spec D10:
-- Lynne wins on results, but disagreements are reported, not auto-resolved).
create or replace function admin_apply_lynne_import(
  p_week int,
  p_filename text,
  p_sha256 text,
  p_rows jsonb,
  p_row_count int,
  p_matched_count int,
  p_unmatched jsonb,
  p_variances jsonb,
  p_applies jsonb,   -- [{entry_id, result}] pre-screened: matched, no variance
  p_actor text
) returns uuid
language plpgsql
as $$
declare
  v_import_id uuid;
  v_apply jsonb;
  v_pick_id uuid;
  v_applied int := 0;
begin
  begin
    insert into lynne_imports (week, filename, file_sha256, row_count,
                               matched_count, unmatched, variances, rows)
    values (p_week, p_filename, p_sha256, p_row_count,
            p_matched_count, p_unmatched, p_variances, p_rows)
    returning id into v_import_id;
  exception when unique_violation then
    raise exception 'already imported: this exact file was committed before';
  end;

  for v_apply in select * from jsonb_array_elements(coalesce(p_applies, '[]'::jsonb)) loop
    select id into v_pick_id from picks
     where entry_id = (v_apply ->> 'entry_id')::uuid
       and week = p_week and is_current;
    if v_pick_id is null then
      raise exception 'no current pick for entry % week % — should have been a variance',
        v_apply ->> 'entry_id', p_week;
    end if;

    update picks
       set result = v_apply ->> 'result',
           result_source = 'lynne'
     where id = v_pick_id;

    insert into audit_log (actor, action, target_table, target_id, after)
    values (p_actor, 'lynne_result', 'picks', v_pick_id::text,
            jsonb_build_object('week', p_week,
                               'entry_id', v_apply ->> 'entry_id',
                               'result', v_apply ->> 'result',
                               'import_id', v_import_id));
    v_applied := v_applied + 1;
  end loop;

  insert into audit_log (actor, action, target_table, target_id, note)
  values (p_actor, 'lynne_import', 'lynne_imports', v_import_id::text,
          format('week %s: %s rows, %s matched, %s applied, %s variances',
                 p_week, p_row_count, p_matched_count, v_applied,
                 coalesce(jsonb_array_length(p_variances), 0)));
  return v_import_id;
end $$;

do $$
begin
  execute 'revoke execute on function admin_apply_lynne_import(int,text,text,jsonb,int,int,jsonb,jsonb,jsonb,text) from public';
  begin
    execute 'revoke execute on function admin_apply_lynne_import(int,text,text,jsonb,int,int,jsonb,jsonb,jsonb,text) from anon, authenticated';
  exception when undefined_object then
    null;
  end;
end $$;
