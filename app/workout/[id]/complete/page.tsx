import { notFound } from "next/navigation";
import { FinishWorkout } from "@/components/FinishWorkout";
import { requireCurrentUser } from "@/lib/session";
import { getSessionSummary } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function CompletePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;
  const summary = await getSessionSummary(user.id, Number(id));

  if (!summary) notFound();

  return (
    <FinishWorkout
      sessionId={summary.id}
      title={summary.title}
      status={summary.status}
      completedExerciseCount={summary.completedExerciseCount}
      skippedExerciseCount={summary.skippedExerciseCount}
      notPerformedCount={
        summary.exerciseCount -
        summary.completedExerciseCount -
        summary.skippedExerciseCount
      }
      setCount={summary.setCount}
      durationText={summary.durationText}
    />
  );
}
