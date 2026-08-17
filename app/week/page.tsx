import { WeekPlanner } from "@/components/WeekPlanner";
import { requireCurrentUser } from "@/lib/session";
import { getWeekView } from "@/lib/week-view";
import { FEEDBACK_REASONS, FOLLOW_UP_QUESTIONS } from "@/lib/week-rebuild/feedback";

export const dynamic = "force-dynamic";

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const user = await requireCurrentUser();
  const week = await getWeekView(user.id);
  const { focus } = await searchParams;

  if (!week) {
    return <p className="text-lg text-zinc-400">No active plan.</p>;
  }

  const reasons = FEEDBACK_REASONS.map((option) => ({ key: option.key, label: option.label }));

  return (
    <WeekPlanner
      week={week}
      focusDayId={focus ? Number(focus) : undefined}
      rebuildReasons={reasons}
      rebuildFollowUps={FOLLOW_UP_QUESTIONS}
    />
  );
}
