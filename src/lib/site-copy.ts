// What a signed-out visitor is told about the master pool. Admin routes name
// its runner; the public site does not, so every player-facing string that
// refers to it reads from here. Internal identifiers (lynne_number,
// lib/lynne/, the export routes) are unchanged: this is copy, not schema.
export const MASTER_POOL = {
  tab: "Official Results",
  title: "Official Board",
  possessive: "the official pool's",
};
