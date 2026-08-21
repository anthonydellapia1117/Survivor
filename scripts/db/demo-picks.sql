-- VISUAL-TEST ONLY. Populates weeks 1-5 with plausible picks/results so the
-- grid, entry detail, and dashboard can be inspected with every result state.
-- Never run against production: it fabricates results.

do $$
declare
  e record;
  wk int;
  teams text[] := array['KC','BUF','SF','DAL','PHI','DET','BAL','MIA','CIN','GB','LAR','NYJ','MIN','SEA','JAX','CLE'];
  team text;
  res text;
  i int := 0;
begin
  for e in select id from entries order by entry_name loop
    i := i + 1;
    for wk in 1..5 loop
      team := teams[1 + ((i * 3 + wk * 5) % array_length(teams, 1))];
      -- Deterministic spread of results: mostly wins, some losses/ties/missed.
      if (i + wk) % 11 = 0 then
        res := 'loss';
      elsif (i * wk) % 17 = 0 then
        res := 'tie_loss';
      elsif (i + 2 * wk) % 23 = 0 then
        res := 'missed';
      elsif wk = 5 then
        res := 'pending';
      else
        res := 'win';
      end if;
      insert into picks (entry_id, week, team, result, late, submitted_at)
      values (
        e.id, wk,
        case when res = 'missed' then 'MISSED' else team end,
        res,
        (i + wk) % 13 = 0,
        (select deadline_at - interval '3 hours' from weeks w where w.week = wk)
      );
    end loop;
  end loop;
end $$;
