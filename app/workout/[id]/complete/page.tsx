import { notFound } from "next/navigation";
import { FinishWorkout } from "@/components/FinishWorkout";
import { getSessionSummary } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function CompletePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const summary = await getSessionSummary(Number(id));

  if (!summary) notFound();

  return (
    <FinishWorkout
      sessionId={summary.id}
      title={summary.title}
      exerciseCount={summary.exerciseCount}
      setCount={summary.setCount}
      durationText={summary.durationText}
    />
  );
}
