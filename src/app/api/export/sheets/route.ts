// POST /api/export/sheets — regenerate the Google Sheets backup from live
// data. The Sheet is a generated export, never a second source of truth:
// every run clears and rewrites both workbooks. Admin only.
// GET returns setup/status so misconfiguration is diagnosable.

import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getData } from "@/lib/data";
import { getAdminData } from "@/lib/data/admin";
import { buildAllTabs, type SheetsInput } from "@/lib/sheets/build";
import {
  getAccessToken,
  loadServiceAccount,
  syncSpreadsheet,
} from "@/lib/sheets/google";

async function gatherInput(): Promise<SheetsInput> {
  const pub = getData();
  const admin = getAdminData();
  const [entries, weeks, cells, owners, payments, imports, config, allPicks] =
    await Promise.all([
      admin.listEntrySummaries(),
      pub.getWeeks(),
      admin.listGridCells(), // real picks — the sheet is Lynne's copy
      admin.listOwners(),
      admin.listPayments(),
      pub.getLynneImports(),
      admin.getConfig(),
      admin.listAllPicks(),
    ]);
  const names = new Map(entries.map((e) => [e.id, e.entryName]));
  const pickLog = allPicks
    .filter((p) => names.has(p.entryId))
    .map((p) => ({
      entryName: names.get(p.entryId)!,
      week: p.week,
      team: p.team,
      submittedAt: p.submittedAt,
      source: p.source,
      late: p.late,
      result: p.result,
      superseded: !p.isCurrent,
    }));
  return {
    now: new Date(),
    entries,
    weeks,
    cells,
    owners,
    payments,
    imports,
    pickLog,
    config,
  };
}

export async function POST() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const publicId = process.env.GOOGLE_SHEET_ID;
  const privateId = process.env.GOOGLE_PRIVATE_SHEET_ID;
  if (!publicId) {
    return NextResponse.json(
      { error: "GOOGLE_SHEET_ID is not set" },
      { status: 500 },
    );
  }

  try {
    const sa = loadServiceAccount();
    const token = await getAccessToken(sa);
    const input = await gatherInput();
    const wb = buildAllTabs(input);

    const pub = await syncSpreadsheet(token, publicId, wb.public);
    let priv: { url: string; rowCounts: Record<string, number> } | null = null;
    if (privateId) {
      priv = await syncSpreadsheet(token, privateId, wb.private);
    }

    const counts = { ...pub.rowCounts, ...(priv?.rowCounts ?? {}) };
    await getAdminData().logAudit({
      action: "sheets_export",
      note: `exported ${Object.entries(counts)
        .map(([k, v]) => `${k}:${v}`)
        .join(" ")}${priv ? "" : " (private sheet skipped — no GOOGLE_PRIVATE_SHEET_ID)"}`,
      actor: session.actor,
    });

    return NextResponse.json({
      ok: true,
      publicUrl: pub.url,
      privateUrl: priv?.url ?? null,
      generatedAt: input.now.toISOString(),
      rowCounts: counts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const status: Record<string, unknown> = {
    GOOGLE_SHEET_ID: Boolean(process.env.GOOGLE_SHEET_ID),
    GOOGLE_PRIVATE_SHEET_ID: Boolean(process.env.GOOGLE_PRIVATE_SHEET_ID),
    GOOGLE_SERVICE_ACCOUNT_KEY: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  };
  try {
    const sa = loadServiceAccount();
    status.serviceAccountEmail = sa.client_email;
    const token = await getAccessToken(sa);
    status.tokenOk = true;
    if (process.env.GOOGLE_SHEET_ID) {
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}?fields=spreadsheetUrl`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      status.publicSheetAccess = res.ok ? "ok" : `${res.status} — share the sheet with the service account as editor`;
    }
    if (process.env.GOOGLE_PRIVATE_SHEET_ID) {
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_PRIVATE_SHEET_ID}?fields=spreadsheetUrl`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      status.privateSheetAccess = res.ok ? "ok" : `${res.status} — share the sheet with the service account as editor`;
    }
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json(status);
}
