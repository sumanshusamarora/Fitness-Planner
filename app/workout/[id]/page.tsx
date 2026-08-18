import { notFound, redirect } from "next/navigation";
import { routes } from "@/lib/routes";
import { requireCurrentUser } from "@/lib/session";
import { resolveSessionRouteContext } from "@/lib/training-route-context";

export const dynamic = "force-dynamic";

export default async function ActiveWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;
  const context = await resolveSessionRouteContext(user.id, Number(id));
  if (!context) notFound();
  redirect(routes.session(context.weekId, context.dayId, context.sessionId));
}
