import { notFound } from "next/navigation";
import { ActiveWorkout } from "@/components/ActiveWorkout";
import { getActiveWorkoutData } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function ActiveWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getActiveWorkoutData(Number(id));

  if (!data) notFound();

  return <ActiveWorkout data={data} />;
}
