// The string literals of a TypeScript source, and nothing else.
//
// Copy lives in literals. A comment explaining a rule necessarily contains the
// very shape the rule forbids - "it used to be a bare https://.../grid" is a
// sentence about the mistake, not the mistake - so a whole-file scan fires on
// the explanation and stays silent on the thing it was written to catch. That
// is protection that reads as protection and is not.
//
// Walking the source once rather than pattern-matching quotes matters too: an
// apostrophe in a comment pairs with the next real quote and drags prose into
// the result, which then matches the forbidden phrases as well.
//
// One implementation, used by every copy guard. Two copies of a scanner drift,
// and the day they disagree one of them is passing on nothing.

export function literals(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("//", i)) {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    const quote = src[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      i += 1;
      let text = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          text += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        text += src[i];
        i += 1;
      }
      i += 1;
      out.push(text);
      continue;
    }
    i += 1;
  }
  return out.join("\n");
}
