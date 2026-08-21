import "server-only";
import type { AdminBackend } from "./admin-types";
import { adminLocalPgBackend } from "./admin-localpg";
import { adminSupabaseBackend } from "./admin-supabase";

export * from "./admin-types";

export function getAdminData(): AdminBackend {
  return process.env.LOCAL_PG_URL ? adminLocalPgBackend : adminSupabaseBackend;
}
