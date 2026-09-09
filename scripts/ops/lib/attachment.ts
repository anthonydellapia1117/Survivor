// Where her attachment is written before lynne:roster reads it.
//
// The directory and the uniqueness are ours, never hers: her filename is
// metadata on the message, and a slash in it targets a directory that does
// not exist while "../" lands outside the temporary directory (issue #40).
//
// But the basename is not cosmetic. scripts/lynne/roster.ts records
// path.basename(--file) as p_source_file on every lynne_roster row and in the
// audit row, and CLAUDE.md tracks her sheets by that name ("Football
// 2026-3.xlsx"). Dropping it puts a generated temp name in the database where
// the name of her sheet belongs. So her name is kept and made safe, rather
// than replaced: the message id makes it unique, and her basename is stripped
// to plain file-name characters. Pure, so the hostile shapes are tested.

/** The file name (never a path) her attachment is written under. */
export function tempSheetName(messageId: string, filename: string): string | null {
  const safeId = messageId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeId) return null;
  // basename() by hand: both separators, so a Windows-style name cannot slip a
  // directory through on a POSIX host.
  const base = filename.split(/[/\\]/).pop() ?? "";
  const herName = base.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").trim();
  return herName && herName !== ".xlsx" ? `survivor-roster-${safeId}-${herName}` : `survivor-roster-${safeId}.xlsx`;
}
