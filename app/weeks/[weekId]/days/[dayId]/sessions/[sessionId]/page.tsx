import { notFound, redirect } from "next/navigation";
import { ActiveWorkout } from "@/components/ActiveWorkout";
import { requireCurrentUser } from "@/lib/session";
import { routes } from "@/lib/routes";
import { validateSessionRouteContext } from "@/lib/training-route-context";
import { getActiveWorkoutData } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function SessionPage({
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

  if (context.status !== "in_progress") {
    redirect(routes.historySession(context.sessionId));
  }

  const data = await getActiveWorkoutData(user.id, context.sessionId);
  if (!data) notFound();

  return (
    <ActiveWorkout
      data={data}
      nav={{
        weekId: context.weekId,
        dayId: context.dayId,
      }}
    />
  );
}
