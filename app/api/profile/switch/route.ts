import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PROFILE_COOKIE } from "@/lib/session";

export async function POST() {
  const store = await cookies();
  store.delete(PROFILE_COOKIE);
  return NextResponse.json({ ok: true });
}
