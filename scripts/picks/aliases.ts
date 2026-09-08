// Player shorthand that cannot be derived from the entry name. Keys are the
// shorthand with case, "#" and spacing removed (entryKey), the trailing
// number stripped; values are the entry base name exactly as stored. Add a
// line when a new one turns up in the mail; never edit the stored name.
export const ENTRY_ALIASES: Record<string, string> = {
  "mary/maria": "Maria & Mary",
  "maria/mary": "Maria & Mary",
  "mary/matia": "Maria & Mary",
  "maria and mary": "Maria & Mary",
  "mary and maria": "Maria & Mary",
};
