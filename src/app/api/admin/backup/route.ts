// One-click data backup. Admin-only — same gate as every admin screen.
// Produces a single timestamped .sql file that restores in one step
// against a fresh migrations-built database (see src/lib/backup.ts).

import { getAdminSession } from "@/lib/auth";
import { getAdminData } from "@/lib/data/admin";
import {
  BACKUP_TABLES,
  backupFilename,
  buildBackupSql,
  type TableDump,
} from "@/lib/backup";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return new Response("admin only", { status: 403 });
  }

  const admin = getAdminData();
  const dumps: TableDump[] = [];
  for (const t of BACKUP_TABLES) {
    dumps.push({ table: t.table, rows: await admin.dumpTable(t.table, t.orderBy) });
  }

  const now = new Date();
  const sql = buildBackupSql(dumps, now);
  const total = dumps.reduce((s, d) => s + d.rows.length, 0);

  await getAdminData().logAudit({
    action: "data_backup",
    note: `${total} rows across ${dumps.length} tables downloaded`,
    actor: session.email,
  });

  return new Response(sql, {
    headers: {
      "content-type": "application/sql; charset=utf-8",
      "content-disposition": `attachment; filename="${backupFilename(now)}"`,
      "cache-control": "no-store",
    },
  });
}
