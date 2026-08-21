import "server-only";
import type { DataBackend } from "./types";
import { localPgBackend } from "./localpg";
import { supabaseBackend } from "./supabase";

export * from "./types";

export function getData(): DataBackend {
  // Dev/visual-test backend against the seeded local Postgres; production
  // always uses Supabase (anon key + RLS).
  return process.env.LOCAL_PG_URL ? localPgBackend : supabaseBackend;
}
