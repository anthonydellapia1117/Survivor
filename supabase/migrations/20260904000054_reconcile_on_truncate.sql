-- Fire the rule on TRUNCATE too. Codex's finding, reproduced against a real
-- database.
--
-- The triggers covered INSERT, UPDATE and DELETE. TRUNCATE is none of those,
-- and PostgreSQL will not fire a statement trigger for it unless the trigger
-- says so. So emptying a watched table skipped reconciliation entirely:
--
--   ratio 20, 20 recruited, 1 free entry held -- correct
--   truncate config          -- the ratio falls back to 10, entitlement is 2
--   held: 1, should be 2     -- and stays that way until an unrelated write
--
-- This is the narrowest gap on this branch: it needs a non-default ratio and a
-- bare TRUNCATE of `config`, which the app never issues. It is worth closing
-- anyway, because the invariant this whole change claims is unconditional --
-- the rule holds for any write, not for the write shapes someone happened to
-- enumerate. That claim is the entire reason the rule moved into the database,
-- and "we listed three of the four" is the same shape as the original bug.
--
-- The data backup DOES truncate all three, in one statement before it disables
-- the triggers. That is safe and stays safe: at that point every table in the
-- list is already empty, so the rule finds no runner and returns. Then the
-- inserts land with the triggers off, and the settle at the end reconciles
-- against the complete roster, exactly as before.

drop trigger if exists entries_lock_free_entry_rule on entries;
create trigger entries_lock_free_entry_rule
before insert or update or delete or truncate on entries
for each statement
execute function lock_free_entry_rule();

drop trigger if exists owners_lock_free_entry_rule on owners;
create trigger owners_lock_free_entry_rule
before insert or update or delete or truncate on owners
for each statement
execute function lock_free_entry_rule();

drop trigger if exists config_lock_free_entry_rule on config;
create trigger config_lock_free_entry_rule
before insert or update or delete or truncate on config
for each statement
execute function lock_free_entry_rule();

drop trigger if exists entries_mint_free_entries on entries;
create trigger entries_mint_free_entries
after insert or update or delete or truncate on entries
for each statement
execute function mint_free_entries();

drop trigger if exists owners_mint_free_entries on owners;
create trigger owners_mint_free_entries
after insert or update or delete or truncate on owners
for each statement
execute function mint_free_entries();

drop trigger if exists config_mint_free_entries on config;
create trigger config_mint_free_entries
after insert or update or delete or truncate on config
for each statement
execute function mint_free_entries();
