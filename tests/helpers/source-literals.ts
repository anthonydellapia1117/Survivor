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
//
// JSX TEXT IS NOT A LITERAL. `<Link ...>Master List</Link>` is a name a reader
// sees and no quoted string anywhere, so a literals-only scan is blind to it.
// codeWithoutComments() is the other half: everything but the comments, which
// is where a rule's own history is written down.

interface Scanned {
  /** Every quoted string, one per line. */
  literals: string;
  /** The source with the comments taken out and everything else left. */
  code: string;
}

function scan(src: string): Scanned {
  const out: string[] = [];
  const kept: string[] = [];
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
      kept.push(quote + text + quote);
      continue;
    }
    kept.push(src[i]);
    i += 1;
  }
  return { literals: out.join("\n"), code: kept.join("") };
}

/** The string literals of a source, and nothing else. */
export function literals(src: string): string {
  return scan(src).literals;
}

/**
 * The source with every comment removed. What is left is what ships: quoted
 * strings, JSX text, attribute values, identifiers. Use it where the mistake
 * can be written without quotes and the explanation of the rule cannot be
 * allowed to trip it.
 */
export function codeWithoutComments(src: string): string {
  return scan(src).code;
}
