"use server";

// Admin account actions. The app holds no service-role key by design, so a
// password change runs as the signed-in admin through Supabase auth:
// re-verify the current password, update, then re-establish this browser's
// session so the change never logs the admin out of the screen they are on.

import { createClient } from "@supabase/supabase-js";
import { getAdminSession } from "@/lib/auth";
import { getAdminData } from "@/lib/data/admin";
import {
  createSupabaseServerClient,
  supabaseConfigured,
} from "@/lib/supabase/server";
import { passwordProblems } from "@/lib/password";

export interface ChangePasswordResult {
  ok: boolean;
  error?: string;
}

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ChangePasswordResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "Not authorized." };
  if (!supabaseConfigured()) {
    return {
      ok: false,
      error: "Supabase auth is not configured in this environment.",
    };
  }

  const { currentPassword, newPassword, confirmPassword } = input;
  if (currentPassword === "") {
    return { ok: false, error: "Enter your current password." };
  }
  // The server re-checks the same rules the form displays: a client that
  // skips the checklist (or a stale tab) still cannot set a weak password.
  const problems = passwordProblems(newPassword);
  if (problems.length > 0) {
    return {
      ok: false,
      error: `New password needs: ${problems.join("; ").toLowerCase()}.`,
    };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "New password and confirmation do not match." };
  }
  if (newPassword === currentPassword) {
    return {
      ok: false,
      error: "New password must be different from the current one.",
    };
  }

  // Throwaway client: verifying the current password must not touch the
  // auth cookies of the live request (a wrong guess must not sign you out).
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { error: signInError } = await verifier.auth.signInWithPassword({
    email: session.email,
    password: currentPassword,
  });
  if (signInError)
    return { ok: false, error: "Current password is incorrect." };

  const { error: updateError } = await verifier.auth.updateUser({
    password: newPassword,
  });
  if (updateError) return { ok: false, error: updateError.message };

  // The change can invalidate the tokens this browser holds, so mint a fresh
  // session on the cookie-bound client — the admin stays signed in.
  const bound = await createSupabaseServerClient();
  const { error: refreshError } = await bound.auth.signInWithPassword({
    email: session.email,
    password: newPassword,
  });
  if (refreshError) {
    return {
      ok: false,
      error:
        "Password changed, but this session could not be refreshed — sign in again with the new password.",
    };
  }

  try {
    await getAdminData().logAudit({
      action: "admin_password_change",
      note: "admin password changed from /admin/account",
      actor: session.actor,
    });
  } catch {
    // An audit hiccup must never make a successful change look failed.
  }

  return { ok: true };
}
