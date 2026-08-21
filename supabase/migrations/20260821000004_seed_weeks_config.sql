-- Seed the 2026 season: 18 weeks with pick deadlines, plus the single config row.
--
-- Deadline rules (spec section 3):
--   Week 1: Tuesday 2026-09-08 12:00 PM America/New_York (special, locked by spec)
--   Thu/Fri window: Wednesday 12:00 PM ET before that week's Thursday game
--   Sat-Mon window: Friday 12:00 PM ET
-- Weeks 2-17 carry a Thursday game in the modern NFL schedule -> thu_fri.
-- Week 18 has no Thursday game (Sat/Sun slate only) -> sat_mon, Friday noon.
-- Any week whose real 2026 slate differs is editable in /admin/deadline.
--
-- Timestamps are UTC: EDT (UTC-4) through Oct, EST (UTC-5) from Nov 1, 2026.

insert into weeks (week, window_label, deadline_at) values
  ( 1, 'thu_fri', '2026-09-08 16:00:00+00'),
  ( 2, 'thu_fri', '2026-09-16 16:00:00+00'),
  ( 3, 'thu_fri', '2026-09-23 16:00:00+00'),
  ( 4, 'thu_fri', '2026-09-30 16:00:00+00'),
  ( 5, 'thu_fri', '2026-10-07 16:00:00+00'),
  ( 6, 'thu_fri', '2026-10-14 16:00:00+00'),
  ( 7, 'thu_fri', '2026-10-21 16:00:00+00'),
  ( 8, 'thu_fri', '2026-10-28 16:00:00+00'),
  ( 9, 'thu_fri', '2026-11-04 17:00:00+00'),
  (10, 'thu_fri', '2026-11-11 17:00:00+00'),
  (11, 'thu_fri', '2026-11-18 17:00:00+00'),
  (12, 'thu_fri', '2026-11-25 17:00:00+00'),
  (13, 'thu_fri', '2026-12-02 17:00:00+00'),
  (14, 'thu_fri', '2026-12-09 17:00:00+00'),
  (15, 'thu_fri', '2026-12-16 17:00:00+00'),
  (16, 'thu_fri', '2026-12-23 17:00:00+00'),
  (17, 'thu_fri', '2026-12-30 17:00:00+00'),
  (18, 'sat_mon', '2027-01-08 17:00:00+00');

insert into config (id) values (1);
