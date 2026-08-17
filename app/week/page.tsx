import { WeekPlanner } from "@/components/WeekPlanner";
import { requireCurrentUser } from "@/lib/session";
import { getWeekView } from "@/lib/week-view";

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

  return <WeekPlanner week={week} focusDayId={focus ? Number(focus) : undefined} />;
}
