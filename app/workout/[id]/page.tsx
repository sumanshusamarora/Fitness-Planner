import { notFound } from "next/navigation";
import { ActiveWorkout } from "@/components/ActiveWorkout";
import { requireCurrentUser } from "@/lib/session";
import { getActiveWorkoutData } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function ActiveWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;
  const data = await getActiveWorkoutData(user.id, Number(id));

  if (!data) notFound();

  return <ActiveWorkout data={data} />;
}
