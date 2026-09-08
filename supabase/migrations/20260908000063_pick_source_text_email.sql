-- Picks arrive two more ways than the schema admitted.
--
-- Anthony records picks that come by phone or text, and the intake command
-- records picks that come by email, and each is a source in its own right:
-- the audit trail has to say how a pick reached the pool, not just that an
-- admin typed it. The check constraint from 20260821000001 allowed only
-- admin, lynne_import, player and override, so the first text pick was
-- refused with picks_source_check on 2026-09-08. Two values are added and
-- nothing else changes; the constraint is dropped and re-created with the
-- same name so the later migrations that reference it still do.
alter table picks drop constraint picks_source_check;
alter table picks add constraint picks_source_check
  check (source in ('admin','lynne_import','player','override','text','email'));
