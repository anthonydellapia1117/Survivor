import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/admin/account/change-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account" };

export default async function AdminAccountPage() {
  const session = await requireAdmin();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {session.email}.
        </p>
      </div>
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Takes effect immediately for this login — no Supabase dashboard
            needed. You stay signed in here after the change.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
