import { HomeScreen } from "@/components/HomeScreen";
import { requireCurrentUser } from "@/lib/session";
import { getWeekView } from "@/lib/week-view";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireCurrentUser();
  const week = await getWeekView(user.id);

  return (
    <HomeScreen
      user={{ name: user.name, username: user.username }}
      week={week}
    />
  );
}
