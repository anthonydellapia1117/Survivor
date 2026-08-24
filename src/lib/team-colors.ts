// E3: all 32 team palettes (primary + secondary hex from teampalettes.com/
// nfl), shipped statically — never fetched at runtime. Several NFL
// primaries are far too dark for a dark UI, so every team also carries a
// computed `display` variant, lightened just enough to clear WCAG 4.5:1 on
// the app's lightest dark surface (#1c2024) — which means it clears it on
// the darker surfaces too. A test asserts all 32 pass.

export interface TeamPalette {
  primary: string;
  secondary: string;
  /** Contrast-safe variant for text/swatches on dark surfaces. */
  display: string;
}

const RAW: Record<string, [primary: string, secondary: string]> = {
  ARI: ["#97233F", "#000000"],
  ATL: ["#A71930", "#000000"],
  BAL: ["#241773", "#9E7C0C"],
  BUF: ["#00338D", "#C60C30"],
  CAR: ["#0085CA", "#101820"],
  CHI: ["#0B162A", "#C83803"],
  CIN: ["#FB4F14", "#000000"],
  CLE: ["#311D00", "#FF3C00"],
  DAL: ["#003594", "#B0B7BC"],
  DEN: ["#FB4F14", "#002244"],
  DET: ["#0076B6", "#B0B7BC"],
  GB: ["#203731", "#FFB612"],
  HOU: ["#03202F", "#A71930"],
  IND: ["#002C5F", "#A2AAAD"],
  JAX: ["#101820", "#D7A22A"],
  KC: ["#E31837", "#FFB81C"],
  LAC: ["#0080C6", "#FFC20E"],
  LAR: ["#003594", "#FFA300"],
  LV: ["#000000", "#A5ACAF"],
  MIA: ["#008E97", "#FC4C02"],
  MIN: ["#4F2683", "#FFC62F"],
  NE: ["#002244", "#C60C30"],
  NO: ["#D3BC8D", "#101820"],
  NYG: ["#0B2265", "#A71930"],
  NYJ: ["#125740", "#000000"],
  PHI: ["#004C54", "#A5ACAF"],
  PIT: ["#FFB612", "#101820"],
  SEA: ["#002244", "#69BE28"],
  SF: ["#AA0000", "#B3995D"],
  TB: ["#D50A0A", "#FF7900"],
  TEN: ["#0C2340", "#4B92DB"],
  WAS: ["#5A1414", "#FFB612"],
};

/** The lightest dark surface team colors must read against. */
export const DARK_SURFACE = "#1c2024";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix a color toward white until it clears `min` contrast on `bg`. */
export function ensureContrast(hex: string, bg: string, min = 4.5): string {
  if (contrastRatio(hex, bg) >= min) return hex;
  const [r, g, b] = hexToRgb(hex);
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const candidate = rgbToHex(
      r + (255 - r) * t,
      g + (255 - g) * t,
      b + (255 - b) * t,
    );
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return "#ffffff";
}

export const TEAM_PALETTE: Record<string, TeamPalette> = Object.fromEntries(
  Object.entries(RAW).map(([abbr, [primary, secondary]]) => {
    // Prefer whichever brand color already reads well; lighten if neither.
    const base =
      contrastRatio(primary, DARK_SURFACE) >=
      contrastRatio(secondary, DARK_SURFACE)
        ? primary
        : secondary;
    return [abbr, { primary, secondary, display: ensureContrast(base, DARK_SURFACE) }];
  }),
);

/** Back-compat: the contrast-safe accent used on row labels and swatches. */
export const TEAM_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(TEAM_PALETTE).map(([abbr, p]) => [abbr, p.display]),
);
