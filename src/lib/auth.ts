import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AdminSession {
  email: string;
  actor: string;
}

/**
 * Local development only: with the local-Postgres backend active and the
 * bypass flag set, admin pages open without Supabase auth. Never active in
 * production — both env vars would have to be deliberately set.
 */
function devBypass(): AdminSession | null {
  if (process.env.LOCAL_PG_URL && process.env.ADMIN_DEV_BYPASS === "1") {
    return { email: "dev@localhost", actor: "dev-admin" };
  }
  return null;
}

/** Session if the request is the admin; null otherwise. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const bypass = devBypass();
  if (bypass) return bypass;

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || user.email.toLowerCase() !== adminEmail.toLowerCase()) {
    return null;
  }
  return { email: user.email, actor: user.email };
}

/** Gate for admin pages: redirects to the login screen when not the admin. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}
