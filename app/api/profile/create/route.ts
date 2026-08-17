import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { PROFILE_COOKIE, toPublicUser } from "@/lib/session";
import { normalizeUsername, validateUsername } from "@/lib/username";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string };
  const trimmed = (body.username ?? "").trim();

  const validationError = validateUsername(trimmed);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const normalized = normalizeUsername(trimmed);
  const existing = (
    await db
      .select()
      .from(users)
      .where(eq(users.usernameNormalized, normalized))
      .limit(1)
  )[0];

  let user = existing;
  if (!user) {
    const [created] = await db
      .insert(users)
      .values({
        name: trimmed,
        username: trimmed,
        usernameNormalized: normalized,
      })
      .returning();
    user = created;
  }

  const store = await cookies();
  store.set(PROFILE_COOKIE, String(user.id), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });

  return NextResponse.json({
    status: existing ? "found" : "created",
    user: toPublicUser(user),
  });
}
