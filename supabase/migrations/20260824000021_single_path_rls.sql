-- The definer views are the ONLY public read path for people-data tables.
-- Live three-identity probe (anon / non-admin authenticated / admin) found
-- entries directly readable by anon — exposing voided entries, Lynne
-- labels/numbers, and free-entry flags outside the public projection.
-- Drop the public read policies on entries and picks; the FOR ALL
-- is_admin() policies already give the admin full select, and every
-- public consumer reads v_entry_public / v_grid_cells (definer views).
-- Side effect: one permissive SELECT policy per table, which also clears
-- the multiple-permissive-policies performance lints for these tables.

drop policy public_read_entries on entries;
drop policy public_read_picks on picks;
