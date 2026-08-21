-- Section 9 roster seed: 14 owners, 47 entries, 4 payments.
-- Entry names are VERBATIM and case-sensitive ("tommybrads2" stays lowercase).
-- Runs exactly once: re-running raises and rolls back, leaving state untouched.
-- Totals are never written anywhere — v_owner_finance computes them.

begin;

do $$
begin
  if exists (select 1 from owners) then
    raise exception 'already seeded: owners table is not empty';
  end if;
end $$;

insert into owners (first_name, last_name, source, source_ref)
values
  ('Maria',    'DiCicco',      'import', 'legacy sheet'),
  ('Brian',    'Yost',         'import', 'legacy sheet'),
  ('Tim',      'Flaherty',     'import', 'legacy sheet'),
  ('Marc',     'Massimino',    'import', 'legacy sheet'),
  ('Ashley',   'Scalia',       'import', 'legacy sheet'),
  ('Ernie',    'DellaPia Sr',  'import', 'legacy sheet'),
  ('John',     'Vassallo',     'import', 'legacy sheet'),
  ('Joe',      'Santaguida',   'import', 'legacy sheet'),
  ('Mike',     'Penna',        'import', 'legacy sheet'),
  ('Nolan',    'Lawrence',     'import', 'legacy sheet'),
  ('Tom',      'Bradley',      'import', 'legacy sheet'),
  ('Tommy',    'Nataloni',     'import', 'legacy sheet'),
  ('Ron',      'Malandro Jr',  'import', 'legacy sheet'),
  ('Nicholas', 'James',        'import', 'legacy sheet');

insert into entries (owner_id, entry_index, entry_name, name_is_default)
select o.id, v.entry_index, v.entry_name, v.name_is_default
from (values
  -- Maria DiCicco
  ('Maria','DiCicco',1,'ReRe #1',false),
  ('Maria','DiCicco',2,'ReRe #2',false),
  ('Maria','DiCicco',3,'ReRe #3',false),
  ('Maria','DiCicco',4,'ReRe #4',false),
  -- Brian Yost
  ('Brian','Yost',1,'Brian Yost 1',false),
  ('Brian','Yost',2,'Brian Yost 2',false),
  -- Tim Flaherty
  ('Tim','Flaherty',1,'Pumpy321',false),
  -- Marc Massimino
  ('Marc','Massimino',1,'Mass1',false),
  ('Marc','Massimino',2,'Mass2',false),
  -- Ashley Scalia
  ('Ashley','Scalia',1,'Waggs1',false),
  ('Ashley','Scalia',2,'Waggs2',false),
  ('Ashley','Scalia',3,'Waggs3',false),
  ('Ashley','Scalia',4,'Waggs4',false),
  -- Ernie DellaPia Sr
  ('Ernie','DellaPia Sr',1,'ernie sr 1',false),
  ('Ernie','DellaPia Sr',2,'ernie sr 2',false),
  ('Ernie','DellaPia Sr',3,'poultry 1',false),
  ('Ernie','DellaPia Sr',4,'poultry 2',false),
  -- John Vassallo (default naming convention)
  ('John','Vassallo',1,'John Vassallo 1',true),
  ('John','Vassallo',2,'John Vassallo 2',true),
  ('John','Vassallo',3,'John Vassallo 3',true),
  ('John','Vassallo',4,'John Vassallo 4',true),
  -- Joe Santaguida
  ('Joe','Santaguida',1,'BepeSant 1',false),
  ('Joe','Santaguida',2,'BepeSant 2',false),
  ('Joe','Santaguida',3,'BepeSant 3',false),
  ('Joe','Santaguida',4,'BepeSant 4',false),
  -- Mike Penna (default naming convention)
  ('Mike','Penna',1,'Mike Penna 1',true),
  ('Mike','Penna',2,'Mike Penna 2',true),
  ('Mike','Penna',3,'Mike Penna 3',true),
  ('Mike','Penna',4,'Mike Penna 4',true),
  -- Nolan Lawrence (default naming convention)
  ('Nolan','Lawrence',1,'Nolan Lawrence 1',true),
  ('Nolan','Lawrence',2,'Nolan Lawrence 2',true),
  ('Nolan','Lawrence',3,'Nolan Lawrence 3',true),
  ('Nolan','Lawrence',4,'Nolan Lawrence 4',true),
  -- Tom Bradley (tommybrads2 is lowercase and stays lowercase)
  ('Tom','Bradley',1,'Tommybrads1',false),
  ('Tom','Bradley',2,'tommybrads2',false),
  -- Tommy Nataloni
  ('Tommy','Nataloni',1,'Tommy',false),
  ('Tommy','Nataloni',2,'TNat',false),
  ('Tommy','Nataloni',3,'Ttboy',false),
  ('Tommy','Nataloni',4,'Tomasso',false),
  -- Ron Malandro Jr
  ('Ron','Malandro Jr',1,'rondro 1',false),
  ('Ron','Malandro Jr',2,'rondro 2',false),
  ('Ron','Malandro Jr',3,'rondro 3',false),
  ('Ron','Malandro Jr',4,'rondro 4',false),
  -- Nicholas James
  ('Nicholas','James',1,'Nick&Kels 1',false),
  ('Nicholas','James',2,'Nick&Kels 2',false),
  ('Nicholas','James',3,'Nick&Kels 3',false),
  ('Nicholas','James',4,'Nick&Kels 4',false)
) as v(first_name, last_name, entry_index, entry_name, name_is_default)
join owners o
  on o.first_name = v.first_name and o.last_name = v.last_name;

insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, source_ref)
select o.id, v.amount_cents, 'venmo', v.paid_on::date, v.venmo_txn_id, 'legacy sheet'
from (values
  ('Maria','DiCicco',   10000, '2026-08-14', '4663800776141712543'),
  ('Brian','Yost',       6000, '2026-08-17', '4665778505896168187'),
  ('Tim','Flaherty',     3000, '2026-08-16', '4665247903916912167'),
  ('Marc','Massimino',   6000, '2026-08-17', '204311868M648504R')
) as v(first_name, last_name, amount_cents, paid_on, venmo_txn_id)
join owners o
  on o.first_name = v.first_name and o.last_name = v.last_name;

insert into audit_log (actor, action, target_table, note)
values ('seed', 'seed_roster', 'owners,entries,payments',
        'Section 9 roster: 14 owners, 47 entries, 4 venmo payments ($250)');

commit;
