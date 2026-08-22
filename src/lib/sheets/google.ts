// Minimal Google Sheets client: service-account JWT (RS256 via node:crypto)
// plus the handful of REST calls the export needs. No SDK dependency.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CellSpec, TabSpec } from "./types";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** GOOGLE_SERVICE_ACCOUNT_KEY holds either the JSON itself or a file path. */
export function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  }
  const text = raw.trim().startsWith("{") ? raw : readFileSync(raw, "utf8");
  const parsed = JSON.parse(text) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("service account JSON missing client_email/private_key");
  }
  return parsed;
}

const b64url = (s: Buffer | string) =>
  Buffer.from(s).toString("base64url");

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function api(
  token: string,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`sheets api ${method} ${url.split("?")[0]}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function cellData(c: CellSpec): any {
  const out: any = {};
  if (c.v !== undefined && c.v !== "") {
    out.userEnteredValue =
      typeof c.v === "number" ? { numberValue: c.v } : { stringValue: c.v };
  }
  const fmt: any = {};
  const text: any = {};
  if (c.bold) text.bold = true;
  if (c.italic) text.italic = true;
  if (c.strikethrough) text.strikethrough = true;
  if (c.color) text.foregroundColorStyle = { rgbColor: c.color };
  if (c.fontSize) text.fontSize = c.fontSize;
  if (Object.keys(text).length > 0) fmt.textFormat = text;
  if (c.bg) fmt.backgroundColorStyle = { rgbColor: c.bg };
  if (c.align) fmt.horizontalAlignment = c.align;
  else if (typeof c.v === "number") fmt.horizontalAlignment = "RIGHT";
  fmt.verticalAlignment = "MIDDLE";
  if (c.numberFormat) {
    fmt.numberFormat = {
      type: c.numberFormat.includes("$") ? "CURRENCY" : "DATE",
      pattern: c.numberFormat,
    };
  }
  if (c.wrap) fmt.wrapStrategy = "WRAP";
  else if (c.overflow) fmt.wrapStrategy = "OVERFLOW_CELL";
  else fmt.wrapStrategy = "CLIP";
  if (c.borderTop) {
    fmt.borders = {
      top: { style: "SOLID", colorStyle: { rgbColor: { red: 0.1, green: 0.12, blue: 0.14 } } },
    };
  }
  out.userEnteredFormat = fmt;
  if (c.runs && typeof c.v === "string") {
    out.textFormatRuns = c.runs.map((r) => ({
      startIndex: r.start,
      format: {
        ...(r.color ? { foregroundColorStyle: { rgbColor: r.color } } : {}),
        ...(r.bold ? { bold: true } : {}),
      },
    }));
  }
  return out;
}

interface ExistingSheet {
  sheetId: number;
  title: string;
  index: number;
  protectedRangeIds: number[];
  hasBasicFilter: boolean;
}

async function getExisting(
  token: string,
  spreadsheetId: string,
): Promise<{ sheets: ExistingSheet[]; url: string }> {
  const meta = (await api(
    token,
    "GET",
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets(properties(sheetId,title,index),protectedRanges(protectedRangeId),basicFilter)`,
  )) as any;
  return {
    url: meta.spreadsheetUrl,
    sheets: (meta.sheets ?? []).map((s: any) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      index: s.properties.index,
      protectedRangeIds: (s.protectedRanges ?? []).map(
        (p: any) => p.protectedRangeId,
      ),
      hasBasicFilter: Boolean(s.basicFilter),
    })),
  };
}

/**
 * Clear-and-rewrite the spreadsheet to exactly match `tabs`, in order.
 * Idempotent: grid size is set exactly, every cell is written with full
 * formatting (fields: "*"), stale sheets are deleted, protections and
 * filters are recreated from scratch.
 */
export async function syncSpreadsheet(
  token: string,
  spreadsheetId: string,
  tabs: TabSpec[],
): Promise<{ url: string; rowCounts: Record<string, number> }> {
  const existing = await getExisting(token, spreadsheetId);
  const byTitle = new Map(existing.sheets.map((s) => [s.title, s]));

  // Pass 1: create missing sheets (placeholder grid; sized in pass 2).
  const createReqs: any[] = [];
  for (const t of tabs) {
    if (!byTitle.has(t.title)) {
      createReqs.push({ addSheet: { properties: { title: t.title } } });
    }
  }
  if (createReqs.length > 0) {
    await api(
      token,
      "POST",
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: createReqs },
    );
  }
  const refreshed = createReqs.length > 0 ? await getExisting(token, spreadsheetId) : existing;
  const sheetsByTitle = new Map(refreshed.sheets.map((s) => [s.title, s]));

  const reqs: any[] = [];

  // Remove existing protections and filters so recreation is exact.
  for (const s of refreshed.sheets) {
    for (const pid of s.protectedRangeIds) {
      reqs.push({ deleteProtectedRange: { protectedRangeId: pid } });
    }
    if (s.hasBasicFilter) {
      reqs.push({ clearBasicFilter: { sheetId: s.sheetId } });
    }
  }

  tabs.forEach((t, order) => {
    const sheet = sheetsByTitle.get(t.title)!;
    const id = sheet.sheetId;
    const rowCount = t.rows.length;

    reqs.push({
      updateSheetProperties: {
        properties: {
          sheetId: id,
          index: order,
          tabColorStyle: { rgbColor: t.tabColor },
          gridProperties: {
            rowCount,
            columnCount: t.columnCount,
            // Freezing every visible row/column is an API error, so an
            // empty tab keeps at least one unfrozen row no matter what
            // the builder produced.
            frozenRowCount: Math.min(t.frozenRows, Math.max(rowCount - 1, 0)),
            frozenColumnCount: Math.min(
              t.frozenCols,
              Math.max(t.columnCount - 1, 0),
            ),
            hideGridlines: true,
          },
        },
        fields:
          "index,tabColorStyle,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount,hideGridlines)",
      },
    });

    // No merges anywhere: a merge crossing a frozen row/column boundary is
    // rejected by the Sheets API (the Grid/Entries tabs freeze column 1).
    // The banner lives unmerged in A1 and overflows. This unmerge also
    // cleans up any merge left by an older export.
    reqs.push({
      unmergeCells: {
        range: { sheetId: id, startRowIndex: 0, endRowIndex: rowCount },
      },
    });

    // Full-grid write: values + formats, wiping anything stale.
    reqs.push({
      updateCells: {
        range: {
          sheetId: id,
          startRowIndex: 0,
          endRowIndex: rowCount,
          startColumnIndex: 0,
          endColumnIndex: t.columnCount,
        },
        fields: "userEnteredValue,userEnteredFormat,textFormatRuns",
        rows: t.rows.map((r) => {
          const padded = [...r];
          while (padded.length < t.columnCount) padded.push({});
          return { values: padded.map(cellData) };
        }),
      },
    });

    // Column widths.
    t.columnWidths.forEach((px, col) => {
      reqs.push({
        updateDimensionProperties: {
          range: { sheetId: id, dimension: "COLUMNS", startIndex: col, endIndex: col + 1 },
          properties: { pixelSize: px },
          fields: "pixelSize",
        },
      });
    });

    // Row heights: banner, header, body.
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId: id, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: t.rowHeights.banner },
        fields: "pixelSize",
      },
    });
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId: id, dimension: "ROWS", startIndex: 1, endIndex: 2 },
        properties: { pixelSize: t.rowHeights.header },
        fields: "pixelSize",
      },
    });
    if (rowCount > 2) {
      reqs.push({
        updateDimensionProperties: {
          range: { sheetId: id, dimension: "ROWS", startIndex: 2, endIndex: rowCount },
          properties: { pixelSize: t.rowHeights.body },
          fields: "pixelSize",
        },
      });
    }

    // Filter over the data region.
    if (t.filterHeaderRow !== null) {
      reqs.push({
        setBasicFilter: {
          filter: {
            range: {
              sheetId: id,
              startRowIndex: t.filterHeaderRow,
              endRowIndex: rowCount,
              startColumnIndex: 0,
              endColumnIndex: t.columnCount,
            },
          },
        },
      });
    }

    // Warning-only protection over the whole tab.
    reqs.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: id, startRowIndex: 0, endRowIndex: rowCount },
          warningOnly: true,
          description: "Generated from the app — edits are overwritten.",
        },
      },
    });
  });

  // Delete sheets that are not part of the spec (e.g. the default "Sheet1").
  const wanted = new Set(tabs.map((t) => t.title));
  for (const s of refreshed.sheets) {
    if (!wanted.has(s.title)) {
      reqs.push({ deleteSheet: { sheetId: s.sheetId } });
    }
  }

  await api(
    token,
    "POST",
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    { requests: reqs },
  );

  return {
    url: refreshed.url,
    rowCounts: Object.fromEntries(tabs.map((t) => [t.title, t.dataRowCount])),
  };
}
