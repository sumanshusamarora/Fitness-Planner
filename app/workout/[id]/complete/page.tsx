import { notFound } from "next/navigation";
import { FinishWorkout } from "@/components/FinishWorkout";
import { requireCurrentUser } from "@/lib/session";
import { getSessionSummary } from "@/lib/workouts";
import { buildSessionActivitySummary } from "@/lib/session-activities";

export const dynamic = "force-dynamic";

export default async function CompletePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;
  const sessionId = Number(id);
  const [summary, activities] = await Promise.all([
    getSessionSummary(user.id, sessionId),
    buildSessionActivitySummary(user.id, sessionId).catch(() => null),
  ]);

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
        summary.skippedExerciseCount -
        summary.replacedExerciseCount
      }
      replacedExerciseCount={summary.replacedExerciseCount}
      setCount={summary.setCount}
      durationText={summary.durationText}
      activities={activities}
    />
  );
}
