import { redirect } from "next/navigation";
import { ProfileGate } from "@/components/ProfileGate";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return <ProfileGate />;
}
