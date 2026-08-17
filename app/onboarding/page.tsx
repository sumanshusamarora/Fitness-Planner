import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { requireCurrentUser } from "@/lib/session";
import { getActivePlan } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireCurrentUser();
  const plan = await getActivePlan(user.id);
  if (plan) redirect("/");

  return <OnboardingWizard mode="onboard" />;
}
