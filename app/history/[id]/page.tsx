import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";
import { requireCurrentUser } from "@/lib/session";
import { getSessionSummary } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;
  const summary = await getSessionSummary(user.id, Number(id));
  if (!summary) redirect("/history");
  redirect(routes.historySession(summary.id));
}

