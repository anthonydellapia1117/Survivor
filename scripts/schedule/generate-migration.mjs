// Generate supabase/migrations/20260822000014_nfl_schedule.sql from the
// nflverse games.csv (https://github.com/nflverse/nfldata, data/games.csv).
//
//   node scripts/schedule/generate-migration.mjs path/to/games.csv
//
// Verifies the 2026 regular season before emitting anything: 272 games,
// 18 weeks, every team playing 17 with exactly one bye. Derives the two
// pick windows per week from real game days:
//   Wed/Thu/Fri kickoff -> Wednesday 12:00 PM ET of that game week
//   Sat/Sun/Mon kickoff -> Friday 12:00 PM ET of that game week
//   Week 1 -> Tuesday 2026-09-08 12:00 PM ET for every pick (spec-locked)
// All ET->UTC conversion is DST-correct (same fixed-point as src/lib/timezone).

import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.argv[2];
if (!SRC) throw new Error("usage: generate-migration.mjs games.csv");

const ET = "America/New_York";
function etOffsetMs(atUtc) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: ET, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(atUtc).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - atUtc.getTime();
}
function etWallToUtc(dateStr, timeStr) {
  const naive = Date.parse(`${dateStr}T${timeStr}:00Z`);
  if (Number.isNaN(naive)) throw new Error(`bad date/time ${dateStr} ${timeStr}`);
  let guess = naive;
  for (let i = 0; i < 2; i++) guess = naive - etOffsetMs(new Date(guess));
  return new Date(guess).toISOString().replace(".000Z", "+00");
}

// The app's Rams code is LAR; nflverse uses LA.
const TEAM_MAP = { LA: "LAR" };
const mapTeam = (t) => TEAM_MAP[t] ?? t;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Days back from a game's ET date to the Wednesday of its game week.
const TO_WEDNESDAY = { Wednesday: 0, Thursday: 1, Friday: 2, Saturday: 3, Sunday: 4, Monday: 5 };
const EARLY_DAYS = new Set(["Wednesday", "Thursday", "Friday"]);

function shiftDate(dateStr, days) {
  const d = new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---- parse (no quoted commas in this file's relevant columns) -------------
const lines = readFileSync(SRC, "utf8").split("\n").filter((l) => l !== "");
const header = lines[0].split(",");
const col = Object.fromEntries(header.map((h, i) => [h, i]));
for (const need of ["season", "game_type", "week", "gameday", "weekday", "gametime", "away_team", "home_team", "game_id"]) {
  if (!(need in col)) throw new Error(`missing column ${need}`);
}

const games = [];
for (const line of lines.slice(1)) {
  const f = line.split(",");
  if (f[col.season] !== "2026" || f[col.game_type] !== "REG") continue;
  const gameday = f[col.gameday];
  const weekday = f[col.weekday];
  const gametime = f[col.gametime];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameday)) throw new Error(`bad gameday ${gameday}`);
  if (!/^\d{2}:\d{2}$/.test(gametime)) throw new Error(`bad gametime ${gametime} (${f[col.game_id]})`);
  // Cross-check the source's weekday label against the actual date.
  const actualDow = WEEKDAYS[new Date(`${gameday}T12:00:00Z`).getUTCDay()];
  if (actualDow !== weekday) throw new Error(`weekday mismatch ${f[col.game_id]}: csv=${weekday} date=${actualDow}`);
  games.push({
    id: f[col.game_id],
    week: Number(f[col.week]),
    gameday, weekday, gametime,
    away: mapTeam(f[col.away_team]),
    home: mapTeam(f[col.home_team]),
    kickoffUtc: etWallToUtc(gameday, gametime),
  });
}

// ---- verify ---------------------------------------------------------------
if (games.length !== 272) throw new Error(`expected 272 REG games, got ${games.length}`);
const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
if (weeks.length !== 18 || weeks[0] !== 1 || weeks[17] !== 18) throw new Error(`bad week set ${weeks}`);
const perTeam = new Map();
for (const g of games) {
  for (const t of [g.home, g.away]) {
    if (!perTeam.has(t)) perTeam.set(t, new Set());
    if (perTeam.get(t).has(g.week)) throw new Error(`${t} plays twice in week ${g.week}`);
    perTeam.get(t).add(g.week);
  }
}
if (perTeam.size !== 32) throw new Error(`expected 32 teams, got ${perTeam.size}`);
for (const [t, ws] of perTeam) {
  if (ws.size !== 17) throw new Error(`${t} plays ${ws.size} games, expected 17`);
}

// ---- derive per-week windows ---------------------------------------------
const weekWindows = new Map(); // week -> {earlyUtc, lateUtc, counts}
for (const w of weeks) {
  const wg = games.filter((g) => g.week === w);
  const wednesdays = new Set(wg.map((g) => shiftDate(g.gameday, -TO_WEDNESDAY[g.weekday])));
  if (wednesdays.size !== 1) throw new Error(`week ${w} spans multiple game weeks: ${[...wednesdays]}`);
  const wed = [...wednesdays][0];
  const fri = shiftDate(wed, 2);
  const earlyUtc = etWallToUtc(wed, "12:00");
  const lateUtc = etWallToUtc(fri, "12:00");
  // Deadlines must precede every kickoff in their bucket.
  for (const g of wg) {
    const dl = EARLY_DAYS.has(g.weekday) ? earlyUtc : lateUtc;
    if (Date.parse(dl) >= Date.parse(g.kickoffUtc)) {
      throw new Error(`week ${w}: deadline ${dl} not before kickoff ${g.kickoffUtc} (${g.id})`);
    }
  }
  weekWindows.set(w, {
    earlyUtc, lateUtc,
    early: wg.filter((g) => EARLY_DAYS.has(g.weekday)).length,
    late: wg.length - wg.filter((g) => EARLY_DAYS.has(g.weekday)).length,
  });
}

// Week 1 is spec-locked: Tuesday 2026-09-08 12:00 ET for every pick.
const W1 = etWallToUtc("2026-09-08", "12:00");
const w1FirstKick = Math.min(...games.filter((g) => g.week === 1).map((g) => Date.parse(g.kickoffUtc)));
if (Date.parse(W1) >= w1FirstKick) throw new Error("week 1 Tuesday deadline is not before the opener");
weekWindows.set(1, { ...weekWindows.get(1), earlyUtc: W1, lateUtc: W1 });

// ---- emit -----------------------------------------------------------------
const esc = (s) => s.replaceAll("'", "''");
const inserts = games
  .sort((a, b) => a.week - b.week || a.kickoffUtc.localeCompare(b.kickoffUtc) || a.id.localeCompare(b.id))
  .map((g) => `  ('${esc(g.id)}', ${g.week}, '${g.kickoffUtc}', '${g.weekday}', '${g.away}', '${g.home}')`)
  .join(",\n");

const weekUpdates = weeks
  .map((w) => {
    const { earlyUtc, lateUtc } = weekWindows.get(w);
    return `update weeks set early_deadline_at = '${earlyUtc}', late_deadline_at = '${lateUtc}', deadline_at = '${lateUtc}', confirmed = true where week = ${w};`;
  })
  .join("\n");

const sql = `-- 2026 NFL regular-season schedule + per-pick deadline windows.
-- GENERATED by scripts/schedule/generate-migration.mjs from nflverse
-- games.csv (github.com/nflverse/nfldata) — verified 272 games, 18 weeks,
-- every team 17 games with one bye. Do not hand-edit the seeded rows;
-- regenerate from a fresh CSV instead.
--
-- Deadline model: a pick's deadline depends on the day its team plays.
--   Wed/Thu/Fri kickoff  -> Wednesday 12:00 PM ET of that game week
--   Sat/Sun/Mon kickoff  -> Friday 12:00 PM ET of that game week
--   Week 1               -> Tuesday 2026-09-08 12:00 PM ET, every pick
-- weeks.deadline_at stays the LATE deadline: the moment the whole week is
-- locked (reveal + sweep boundary). Weeks with schedule-derived windows are
-- auto-confirmed.

create table nfl_games (
  id text primary key,
  week int not null references weeks(week),
  kickoff_at timestamptz not null,
  day_of_week text not null check (day_of_week in
    ('Wednesday','Thursday','Friday','Saturday','Sunday','Monday')),
  away_team text not null,
  home_team text not null,
  source text not null default 'nflverse',
  check (away_team <> home_team)
);
create index nfl_games_week_idx on nfl_games (week);
create index nfl_games_home_idx on nfl_games (week, home_team);
create index nfl_games_away_idx on nfl_games (week, away_team);

alter table nfl_games enable row level security;
create policy "public_read_nfl_games" on nfl_games for select using (true);
grant select on nfl_games to anon, authenticated;

insert into nfl_games (id, week, kickoff_at, day_of_week, away_team, home_team) values
${inserts};

-- Two windows per week; deadline_at remains the late (full-lock) boundary.
alter table weeks add column early_deadline_at timestamptz;
alter table weeks add column late_deadline_at timestamptz;

${weekUpdates}

alter table weeks alter column early_deadline_at set not null;
alter table weeks alter column late_deadline_at set not null;

-- The deadline for one pick: which window applies depends on the day the
-- picked team plays that week. A bye/unknown team (including SKIP_WEEK)
-- gets the late deadline — the week's final submission boundary.
create or replace function pick_deadline(p_week int, p_team text)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when w.week = 1 then w.early_deadline_at
    when g.day_of_week in ('Wednesday','Thursday','Friday') then w.early_deadline_at
    else w.late_deadline_at
  end
  from weeks w
  left join nfl_games g
    on g.week = w.week and (g.home_team = p_team or g.away_team = p_team)
  where w.week = p_week
$$;

-- Late flag now derives from the pick's own deadline, not the week's.
-- The bye guards from the rules engine stay exactly as they were.
create or replace function admin_submit_pick(
  p_entry_id uuid,
  p_week int,
  p_team text,
  p_source text,
  p_actor text
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deadline timestamptz;
  v_old_id uuid;
  v_new_id uuid;
  v_double_through int;
  v_losses int;
  v_bye_used boolean;
begin
  select pick_deadline(p_week, p_team) into v_deadline;
  if v_deadline is null then
    raise exception 'week % does not exist', p_week;
  end if;

  if p_team = 'SKIP_WEEK' then
    select double_elim_through_week into v_double_through from config;
    if p_week <= v_double_through then
      raise exception 'bye may only be used from week % on', v_double_through + 1;
    end if;
    select count(*) filter (where p.result in ('loss','tie_loss','missed') and p.week <= v_double_through),
           bool_or(p.team = 'SKIP_WEEK')
      into v_losses, v_bye_used
      from picks p
     where p.entry_id = p_entry_id and p.is_current;
    if coalesce(v_losses, 0) > 0 then
      raise exception 'bye not earned: entry took a loss in weeks 1-%', v_double_through;
    end if;
    if coalesce(v_bye_used, false) then
      raise exception 'bye already used';
    end if;
  end if;

  select id into v_old_id from picks
   where entry_id = p_entry_id and week = p_week and is_current;

  if v_old_id is not null then
    update picks set is_current = false where id = v_old_id;
  end if;

  insert into picks (entry_id, week, team, source, supersedes_id, late, result)
  values (p_entry_id, p_week, p_team,
          coalesce(nullif(p_source, ''), 'admin'),
          v_old_id,
          now() > v_deadline,
          case when p_team = 'SKIP_WEEK' then 'bye' else 'pending' end)
  returning id into v_new_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor,
          case when v_old_id is null then 'submit_pick' else 'override_pick' end,
          'picks', v_new_id::text,
          jsonb_build_object('entry_id', p_entry_id, 'week', p_week,
                             'team', p_team, 'supersedes', v_old_id));
  return v_new_id;
end $$;

-- The sweep waits for the LATE deadline: an entry without a pick could
-- still legally submit a Sat-Mon team until Friday noon.
create or replace function admin_deadline_sweep(
  p_week int,
  p_commit boolean,
  p_actor text
) returns table (entry_id uuid, entry_name text, owner_name text)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deadline timestamptz;
  v_confirmed boolean;
  v_count int := 0;
  r record;
begin
  select w.late_deadline_at, w.confirmed into v_deadline, v_confirmed
    from weeks w where w.week = p_week;
  if v_deadline is null then
    raise exception 'week % does not exist', p_week;
  end if;
  if p_commit and not v_confirmed then
    raise exception 'week % deadline is not confirmed — confirm it on the Weeks screen before sweeping', p_week;
  end if;
  if p_commit and now() <= v_deadline then
    raise exception 'week % late deadline has not passed; sweep cannot commit', p_week;
  end if;

  drop table if exists _sweep;
  create temp table _sweep on commit drop as
  select e.id as entry_id,
         e.entry_name,
         o.first_name || ' ' || o.last_name as owner_name
  from entries e
  join owners o on o.id = e.owner_id
  join v_entry_standing s on s.entry_id = e.id
  where o.participation_status = 'confirmed'
    and e.voided_at is null
    and s.status <> 'eliminated'
    and not exists (
      select 1 from picks p
      where p.entry_id = e.id and p.week = p_week and p.is_current
    );

  if p_commit then
    for r in select * from _sweep loop
      insert into picks (entry_id, week, team, source, late, result, result_source, submitted_at)
      values (r.entry_id, p_week, 'MISSED', 'admin', false, 'missed', 'manual', now());
      insert into audit_log (actor, action, target_table, target_id, after)
      values (p_actor, 'deadline_sweep_miss', 'picks', r.entry_id::text,
              jsonb_build_object('week', p_week, 'entry_name', r.entry_name));
      v_count := v_count + 1;
    end loop;
    insert into audit_log (actor, action, target_table, target_id, note)
    values (p_actor, 'deadline_sweep', 'picks', p_week::text,
            format('week %s sweep: %s automatic losses', p_week, v_count));
  end if;

  return query select * from _sweep;
end $$;

-- The weeks editor now edits the two windows directly.
drop function if exists admin_update_week(int, text, timestamptz, boolean, text);
create or replace function admin_update_week(
  p_week int,
  p_early timestamptz,
  p_late timestamptz,
  p_confirmed boolean,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if p_late < p_early then
    raise exception 'late deadline must not precede the early deadline';
  end if;

  select to_jsonb(w) into v_before from weeks w where w.week = p_week;
  if v_before is null then
    raise exception 'week % does not exist', p_week;
  end if;

  update weeks
     set early_deadline_at = p_early,
         late_deadline_at = p_late,
         deadline_at = p_late,
         confirmed = p_confirmed
   where week = p_week;

  select to_jsonb(w) into v_after from weeks w where w.week = p_week;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_week', 'weeks', p_week::text, v_before, v_after);
end $$;

do $$
begin
  execute 'revoke execute on function admin_update_week(int,timestamptz,timestamptz,boolean,text) from public';
  execute 'revoke execute on function pick_deadline(int,text) from public';
  begin
    execute 'revoke execute on function admin_update_week(int,timestamptz,timestamptz,boolean,text) from anon';
    execute 'grant execute on function admin_update_week(int,timestamptz,timestamptz,boolean,text) to authenticated';
    execute 'grant execute on function pick_deadline(int,text) to anon, authenticated';
  exception when undefined_object then
    null;
  end;
end $$;
`;

writeFileSync("supabase/migrations/20260822000014_nfl_schedule.sql", sql);

// ---- report ---------------------------------------------------------------
console.log(`games: ${games.length}`);
console.log(`teams: ${perTeam.size}, each 17 games`);
for (const w of weeks) {
  const { earlyUtc, lateUtc, early, late } = weekWindows.get(w);
  console.log(
    `W${String(w).padStart(2)}: early ${earlyUtc} (${early} games) late ${lateUtc} (${late} games)`,
  );
}
