import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";
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

  if (!week) redirect("/");

  if (focus) {
    redirect(routes.day(week.planId, Number(focus)));
  }
  redirect(routes.week(week.planId));
}
