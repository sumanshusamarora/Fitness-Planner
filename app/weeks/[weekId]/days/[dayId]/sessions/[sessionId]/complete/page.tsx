import { notFound } from "next/navigation";
import { FinishWorkout } from "@/components/FinishWorkout";
import { requireCurrentUser } from "@/lib/session";
import { validateSessionRouteContext } from "@/lib/training-route-context";
import { buildSessionActivitySummary } from "@/lib/session-activities";
import { getSessionSummary } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function SessionCompletePage({
  params,
}: {
  params: Promise<{ weekId: string; dayId: string; sessionId: string }>;
}) {
  const user = await requireCurrentUser();
  const { weekId, dayId, sessionId } = await params;

  const context = await validateSessionRouteContext(
    user.id,
    Number(weekId),
    Number(dayId),
    Number(sessionId),
  );
  if (!context) notFound();

  const [summary, activities] = await Promise.all([
    getSessionSummary(user.id, context.sessionId),
    buildSessionActivitySummary(user.id, context.sessionId).catch(() => null),
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
      nav={{ weekId: context.weekId, dayId: context.dayId }}
    />
  );
}
