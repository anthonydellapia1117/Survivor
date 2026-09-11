// What a signed-out visitor is told about the master pool. Admin routes name
// its runner; the public site does not, so every player-facing string that
// refers to it reads from here. Internal identifiers (lynne_number,
// lib/lynne/, the export routes) are unchanged: this is copy, not schema.
//
// `tab` and `title` were here until 2026-09-11 and both read "Master List".
// The page they named is gone - it and the Grid are one table now - and a
// constant nobody reads is how a removed page's wording survives to be
// pasted back onto a live one.
export const MASTER_POOL = {
  possessive: "the master pool's",
};
