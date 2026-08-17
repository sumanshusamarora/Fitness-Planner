import { redirect } from "next/navigation";
import { RecoveryCheck } from "@/components/RecoveryCheck";
import { requireCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ planDayId?: string }>;
}) {
  await requireCurrentUser();
  const { planDayId } = await searchParams;

  if (!planDayId) {
    redirect("/");
  }

  return <RecoveryCheck planDayId={Number(planDayId)} />;
}
