import Link from "next/link";
import { notFound } from "next/navigation";
import { WeekReview } from "@/components/WeekReview";
import { createProposalForActivePlan } from "@/lib/coach/service";
import { requireCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NextWeekPage() {
  const user = await requireCurrentUser();
  const proposal = await createProposalForActivePlan(user.id);

  if (!proposal || proposal.proposal.days.length === 0) notFound();

  return (
    <div>
      <Link href="/week" className="text-sm text-zinc-400">
        ← Week
      </Link>
      <div className="mt-4">
        <WeekReview storedProposal={proposal} />
      </div>
    </div>
  );
}
