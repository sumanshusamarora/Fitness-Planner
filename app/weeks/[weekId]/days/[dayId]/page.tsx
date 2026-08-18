import { notFound } from "next/navigation";
import { WeekPlanner } from "@/components/WeekPlanner";
import { requireCurrentUser } from "@/lib/session";
import { getWeekView } from "@/lib/week-view";
import {
  FEEDBACK_REASONS,
  FOLLOW_UP_QUESTIONS,
} from "@/lib/week-rebuild/feedback";
import { validateDayRouteContext } from "@/lib/training-route-context";

export const dynamic = "force-dynamic";

export default async function DayByIdPage({
  params,
}: {
  params: Promise<{ weekId: string; dayId: string }>;
}) {
  const user = await requireCurrentUser();
  const { weekId, dayId } = await params;

  const context = await validateDayRouteContext(
    user.id,
    Number(weekId),
    Number(dayId),
  );
  if (!context) notFound();

  const week = await getWeekView(user.id, context.weekId);
  if (!week) notFound();

  const reasons = FEEDBACK_REASONS.map((option) => ({
    key: option.key,
    label: option.label,
  }));

  return (
    <WeekPlanner
      week={week}
      focusDayId={context.dayId}
      rebuildReasons={reasons}
      rebuildFollowUps={FOLLOW_UP_QUESTIONS}
    />
  );
}
