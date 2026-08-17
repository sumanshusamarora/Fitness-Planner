import { redirect } from "next/navigation";
import { RecoveryCheck } from "@/components/RecoveryCheck";

export const dynamic = "force-dynamic";

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ planDayId?: string }>;
}) {
  const { planDayId } = await searchParams;

  if (!planDayId) {
    redirect("/");
  }

  return <RecoveryCheck planDayId={Number(planDayId)} />;
}
