import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { PROFILE_COOKIE, toPublicUser } from "@/lib/session";
import { normalizeUsername } from "@/lib/username";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string };
  const normalized = normalizeUsername(body.username ?? "");
  if (!normalized) {
    return NextResponse.json({ error: "Enter a username." }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.usernameNormalized, normalized))
    .limit(1);
  const user = rows[0];

  if (!user) {
    return NextResponse.json({ status: "not_found" });
  }

  const store = await cookies();
  store.set(PROFILE_COOKIE, String(user.id), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });

  return NextResponse.json({ status: "found", user: toPublicUser(user) });
}
