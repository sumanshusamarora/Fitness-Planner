import { redirect } from "next/navigation";
import { FirstWeekReview } from "@/components/FirstWeekReview";
import { getDraftInitialProposal } from "@/lib/coach/service";
import { requireCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function OnboardingReviewPage() {
  const user = await requireCurrentUser();
  const proposal = await getDraftInitialProposal(user.id);

  if (!proposal) redirect("/onboarding");
  if (proposal.status === "applied") redirect("/");

  return <FirstWeekReview stored={proposal} />;
}
