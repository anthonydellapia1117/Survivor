-- Apple Pay is a payment method. Anthony, 2026-09-12.
--
-- He was paid $100 for four entries by Apple Pay, and the ledger had nowhere
-- truthful to put it: payments_method_check allowed venmo, cash, check,
-- correction and comp only.
--
-- WHY THE ENUM GREW RATHER THAN THE ROW BEING BENT. The two wrong answers
-- were both available and both corrupt the ledger:
--
--   * 'venmo' puts a receipt in the ledger that no Venmo receipt will ever
--     match. The payment sweep reconciles against Venmo by amount and then by
--     venmo_txn_id, so a venmo row with no txn id is a permanent unexplained
--     line in exactly the reconciliation this pool runs by hand.
--   * 'cash' is simply not what happened, and "never invent data" covers a
--     column as much as it covers an amount.
--
-- The method column is display and reconciliation only - nothing branches on
-- it except the correction styling on /admin/payments and the correction test
-- in the sheet builder, both of which key on 'correction' by name and are
-- untouched by a new value. The two Venmo dedupe indexes are partial on
-- `venmo_txn_id is not null`, so an Apple Pay row with no txn id never enters
-- them.
--
-- Named apple_pay rather than applepay or apple to match the snake_case the
-- rest of this schema uses for a multi-word value.

alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check
  check (method = any (array['venmo', 'cash', 'check', 'apple_pay', 'correction', 'comp']));
