import { notFound } from "next/navigation";
import { WeekPlanner } from "@/components/WeekPlanner";
import { requireCurrentUser } from "@/lib/session";
import { getWeekView } from "@/lib/week-view";
import {
  FEEDBACK_REASONS,
  FOLLOW_UP_QUESTIONS,
} from "@/lib/week-rebuild/feedback";

export const dynamic = "force-dynamic";

export default async function WeekByIdPage({
  params,
  searchParams,
}: {
  params: Promise<{ weekId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const user = await requireCurrentUser();
  const { weekId } = await params;
  const { focus } = await searchParams;
  const week = await getWeekView(user.id, Number(weekId));

  if (!week) notFound();

  const reasons = FEEDBACK_REASONS.map((option) => ({
    key: option.key,
    label: option.label,
  }));

  return (
    <WeekPlanner
      week={week}
      focusDayId={focus ? Number(focus) : undefined}
      rebuildReasons={reasons}
      rebuildFollowUps={FOLLOW_UP_QUESTIONS}
    />
  );
}
