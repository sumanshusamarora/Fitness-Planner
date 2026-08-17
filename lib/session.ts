import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const PROFILE_COOKIE = "fitness_profile_id";

export interface PublicUser {
  id: number;
  name: string;
  username: string | null;
}

export function toPublicUser(user: {
  id: number;
  name: string;
  username: string | null;
}): PublicUser {
  return { id: user.id, name: user.name, username: user.username };
}

/** Resolve the selected user id from the profile cookie (no auth semantics). */
export async function getCurrentUserId(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(PROFILE_COOKIE)?.value;
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function getCurrentUser() {
  const id = await getCurrentUserId();
  if (id == null) return null;
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** For server components. Redirects to /profile when no valid user is selected. */
export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/profile");
  return user;
}

/** For route handlers. Returns the user or null (so the caller can return 401). */
export async function currentUserOrNull() {
  return getCurrentUser();
}
