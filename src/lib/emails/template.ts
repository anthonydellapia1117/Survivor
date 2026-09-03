// The season email shell: one look, many messages.
//
// Everything here renders to HTML that survives a paste into Gmail, which is
// a harsher target than a browser:
//
//   * <style> blocks and classes are stripped, so every rule is INLINE
//   * layout is tables, not flex or grid
//   * CSS variables do not resolve, so the palette is literal hex
//   * a dark look needs explicit background colours on the elements
//     themselves — there is no page behind them to inherit from
//
// The palette is the app's dark theme verbatim (src/app/globals.css), so a
// message looks like it came from the same place as the site.
//
// Blocks are the reusable part. A pick request is a heading, a lead line, an
// entry list and a deadline table; a results recap or a standings mail is the
// same shell with different blocks, so adding one should not mean rewriting
// any of this.

export const EMAIL = {
  bg: "#0b0d0f",
  surface: "#14171a",
  surface2: "#1c2024",
  fg: "#e8eaed",
  muted: "#8a9099",
  border: "#262b31",
  primary: "#4f7cff",
  amber: "#f59e0b",
  green: "#10b981",
} as const;

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** Numerals line up column to column; tabular-nums where it is honoured. */
const NUM =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/**
 * Entry names are stored verbatim and are owner-supplied, so they reach this
 * as untrusted markup. Quotes are escaped as well as angle brackets: nothing
 * puts a name in an attribute today, but the cost is nil and the failure if
 * one ever does — a name breaking out of a `title=` — is silent.
 */
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** A labelled row of a two-column table — tier name and its time, say. */
export interface EmailRow {
  label: string;
  value: string;
  /** Optional emphasis colour for the value. */
  accent?: string;
}

export type EmailBlock =
  | { kind: "lead"; text: string }
  | { kind: "paragraph"; text: string }
  /** Entry names, each with a rule to write the pick on. */
  | { kind: "fill"; caption: string; items: string[] }
  | { kind: "rows"; caption: string; note?: string; rows: EmailRow[] }
  | { kind: "signoff"; from: string; phoneLabel: string; phone: string };

export interface EmailDoc {
  subject: string;
  /** Sits under the title — the week, the season, whatever names the moment. */
  eyebrow: string;
  title: string;
  greeting: string;
  blocks: EmailBlock[];
  /** Small print at the very bottom. */
  footer: string;
}

const cell = (style: string, inner: string) =>
  `<td style="${style}">${inner}</td>`;

function blockHtml(b: EmailBlock): string {
  const pad = "padding:0 28px;";
  switch (b.kind) {
    case "lead":
      return `<tr>${cell(
        `${pad}padding-top:4px;padding-bottom:18px;font-family:${SANS};font-size:15px;line-height:23px;color:${EMAIL.fg};`,
        escapeHtml(b.text),
      )}</tr>`;

    case "paragraph":
      return `<tr>${cell(
        `${pad}padding-bottom:18px;font-family:${SANS};font-size:14px;line-height:22px;color:${EMAIL.muted};`,
        escapeHtml(b.text),
      )}</tr>`;

    case "fill": {
      // Each entry gets its own ruled line. The rule is a bottom border on a
      // full-width cell rather than underscores, so it stays straight at any
      // width and does not wrap.
      const items = b.items
        .map(
          (name) => `
          <tr>
            <td style="padding:11px 0 4px 0;font-family:${SANS};font-size:13px;line-height:17px;color:${EMAIL.fg};font-weight:600;">${escapeHtml(
              name,
            )}</td>
          </tr>
          <tr>
            <td style="border-bottom:1px solid ${EMAIL.border};height:22px;font-family:${NUM};font-size:13px;color:${EMAIL.muted};">&nbsp;</td>
          </tr>`,
        )
        .join("");
      return `<tr>${cell(
        `${pad}padding-bottom:22px;`,
        captionHtml(b.caption) +
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">${items}</table>`,
      )}</tr>`;
    }

    case "rows": {
      const rows = b.rows
        .map(
          (r, i) => `
          <tr>
            <td style="padding:9px 12px;border-top:1px solid ${EMAIL.border};${
              i === 0 ? "border-top:none;" : ""
            }font-family:${SANS};font-size:13px;line-height:18px;color:${EMAIL.muted};">${escapeHtml(
              r.label,
            )}</td>
            <td align="right" style="padding:9px 12px;border-top:1px solid ${EMAIL.border};${
              i === 0 ? "border-top:none;" : ""
            }font-family:${NUM};font-variant-numeric:tabular-nums;font-size:13px;line-height:18px;white-space:nowrap;color:${
              r.accent ?? EMAIL.fg
            };font-weight:600;">${escapeHtml(r.value)}</td>
          </tr>`,
        )
        .join("");
      const note = b.note
        ? `<div style="font-family:${SANS};font-size:12px;line-height:18px;color:${EMAIL.muted};padding:8px 0 0 0;">${escapeHtml(
            b.note,
          )}</div>`
        : "";
      return `<tr>${cell(
        `${pad}padding-bottom:22px;`,
        captionHtml(b.caption) +
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;border:1px solid ${EMAIL.border};background-color:${EMAIL.surface2};">${rows}</table>` +
          note,
      )}</tr>`;
    }

    case "signoff":
      return `<tr>${cell(
        `${pad}padding-top:4px;padding-bottom:26px;border-top:1px solid ${EMAIL.border};`,
        `<div style="font-family:${SANS};font-size:14px;line-height:22px;color:${EMAIL.fg};padding-top:18px;">${escapeHtml(
          b.from,
        )}</div>
         <div style="font-family:${SANS};font-size:13px;line-height:20px;color:${EMAIL.muted};">${escapeHtml(
           b.phoneLabel,
         )} <span style="font-family:${NUM};font-variant-numeric:tabular-nums;color:${EMAIL.fg};">${escapeHtml(
           b.phone,
         )}</span></div>`,
      )}</tr>`;
  }
}

function captionHtml(text: string): string {
  return `<div style="font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL.muted};padding:0 0 8px 0;">${escapeHtml(
    text,
  )}</div>`;
}

/**
 * The full message as a single self-contained HTML string, ready to paste.
 *
 * Wrapped in an outer table with the dark background painted on it: pasting
 * into a compose window drops the body, so the colour has to travel with the
 * content or the message arrives as dark text on white.
 */
export function renderEmailHtml(doc: EmailDoc): string {
  const body = doc.blocks.map(blockHtml).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background-color:${EMAIL.bg};padding:0;margin:0;">
  <tr>
    <td align="center" style="padding:24px 12px;background-color:${EMAIL.bg};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;border-collapse:collapse;background-color:${EMAIL.surface};border:1px solid ${EMAIL.border};">
        <tr>
          <td style="padding:24px 28px 6px 28px;border-bottom:1px solid ${EMAIL.border};">
            <div style="font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:0.1em;text-transform:uppercase;color:${EMAIL.primary};font-weight:700;">${escapeHtml(
              doc.eyebrow,
            )}</div>
            <div style="font-family:${SANS};font-size:22px;line-height:30px;color:${EMAIL.fg};font-weight:700;padding:2px 0 18px 0;">${escapeHtml(
              doc.title,
            )}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 10px 28px;font-family:${SANS};font-size:15px;line-height:22px;color:${EMAIL.fg};font-weight:600;">${escapeHtml(
            doc.greeting,
          )}</td>
        </tr>
        ${body}
        <tr>
          <td style="padding:14px 28px 20px 28px;border-top:1px solid ${EMAIL.border};background-color:${EMAIL.surface2};font-family:${SANS};font-size:11px;line-height:17px;color:${EMAIL.muted};">${escapeHtml(
            doc.footer,
          )}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/** The same message as plain text, for a client that will not take HTML. */
export function renderEmailText(doc: EmailDoc): string {
  const out: string[] = [
    doc.eyebrow.toUpperCase(),
    doc.title,
    "",
    doc.greeting,
    "",
  ];
  for (const b of doc.blocks) {
    switch (b.kind) {
      case "lead":
      case "paragraph":
        out.push(b.text, "");
        break;
      case "fill":
        out.push(b.caption.toUpperCase());
        for (const name of b.items)
          out.push(`  ${name}`, "  ____________________");
        out.push("");
        break;
      case "rows": {
        out.push(b.caption.toUpperCase());
        const w = Math.max(...b.rows.map((r) => r.label.length));
        for (const r of b.rows) out.push(`  ${r.label.padEnd(w)}   ${r.value}`);
        if (b.note) out.push("", `  ${b.note}`);
        out.push("");
        break;
      }
      case "signoff":
        out.push(b.from, `${b.phoneLabel} ${b.phone}`, "");
        break;
    }
  }
  out.push("--", doc.footer);
  return out.join("\n");
}
