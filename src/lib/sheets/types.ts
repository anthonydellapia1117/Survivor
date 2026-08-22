// Sheet-building primitives. A TabSpec is a complete, deterministic
// description of one tab — values plus formatting — produced from app data.
// The Google layer turns specs into batchUpdate requests; nothing here
// touches the network, so the whole build is unit-testable.

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface TextRun {
  /** Start index in the cell's text. */
  start: number;
  color?: RgbColor;
  bold?: boolean;
}

export interface CellSpec {
  /** String or number value. Numbers right-align automatically. */
  v?: string | number;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  color?: RgbColor; // text color
  bg?: RgbColor; // background
  align?: "LEFT" | "CENTER" | "RIGHT";
  /** Sheets number format pattern, e.g. "$#,##0" or "ddd, mmm d". */
  numberFormat?: string;
  fontSize?: number;
  /** Let text spill over empty neighbors (banner row). */
  overflow?: boolean;
  runs?: TextRun[]; // rich-text coloring (status dots)
  borderTop?: boolean;
  wrap?: boolean;
}

export interface TabSpec {
  title: string;
  tabColor: RgbColor;
  /** Every row of the tab, banner row first. Row 0 is the merged banner. */
  rows: CellSpec[][];
  columnCount: number;
  frozenRows: number;
  frozenCols: number;
  /** Pixel widths per column. */
  columnWidths: number[];
  /** Row heights: [bannerHeight, headerHeight, bodyHeight]. */
  rowHeights: { banner: number; header: number; body: number };
  /** 0-based row index where the basic filter's header sits. */
  filterHeaderRow: number | null;
  /** Count of data rows (excludes banner/header/totals), for reporting. */
  dataRowCount: number;
}

export const COLORS = {
  headerBg: rgb(0x1c, 0x20, 0x24),
  headerText: rgb(0xff, 0xff, 0xff),
  bandA: rgb(0xff, 0xff, 0xff),
  bandB: rgb(0xf8, 0xf9, 0xfa),
  border: rgb(0xdf, 0xe3, 0xe8),
  muted: rgb(0x8a, 0x90, 0x99),
  text: rgb(0x16, 0x19, 0x1d),
  win: rgb(0x10, 0xb9, 0x81),
  loss: rgb(0xef, 0x44, 0x44),
  tie: rgb(0xf5, 0x9e, 0x0b),
  bye: rgb(0x64, 0x74, 0x8b),
  pendingBg: rgb(0xf1, 0xf3, 0xf4),
  missedBg: rgb(0xe8, 0xea, 0xed),
  missedText: rgb(0xb9, 0x1c, 0x1c),
  white: rgb(0xff, 0xff, 0xff),
  accentBlue: rgb(0x4f, 0x7c, 0xff),
  amber: rgb(0xf5, 0x9e, 0x0b),
  neutralTab: rgb(0x8a, 0x90, 0x99),
  darkTab: rgb(0x1c, 0x20, 0x24),
  partial: rgb(0xd9, 0x77, 0x06),
  paidGreen: rgb(0x0a, 0x9d, 0x6c),
  correctionBg: rgb(0xfd, 0xf2, 0xdc),
} as const;

export function rgb(r: number, g: number, b: number): RgbColor {
  return { red: r / 255, green: g / 255, blue: b / 255 };
}
