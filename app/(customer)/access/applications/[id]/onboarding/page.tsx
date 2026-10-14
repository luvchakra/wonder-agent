import { redirect } from "next/navigation";

// The onboarding page now lives in the application's Onboarding tab (owner
// feedback, 2026-10-14); old links land there.
export default async function ApplicationOnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/access/applications/${id}?tab=onboarding`);
}
