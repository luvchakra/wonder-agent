import { supabaseServer } from "@/lib/db/supabaseServer";
import { AuthShell, LinkButton } from "@/modules/ui";
import { UpdatePasswordForm } from "./UpdatePasswordForm";

/**
 * Reached only via the recovery link's code-exchange in
 * app/auth/callback/route.ts (?next=/update-password), which establishes
 * the session this page's form acts on. Checked server-side, before any
 * form renders, rather than only from updatePasswordAction's own error
 * path — so a visitor with an expired/already-used/missing link sees the
 * real state immediately instead of an empty form that fails on submit.
 */
export default async function UpdatePasswordPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AuthShell title="Link expired" subtitle="This password reset link has expired or already been used." footer={null}>
        <LinkButton href="/forgot-password" className="w-full">
          Request a new link
        </LinkButton>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose a new password for your WonderID account." footer={null}>
      <UpdatePasswordForm />
    </AuthShell>
  );
}
