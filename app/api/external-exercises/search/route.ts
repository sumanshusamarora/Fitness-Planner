import { NextResponse } from "next/server";
import { searchExerciseCatalogue } from "@/lib/external-exercises";
import { currentUserOrNull } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const muscles = url.searchParams.get("muscles")?.split(",").filter(Boolean);
  const equipment = url.searchParams.get("equipment")?.split(",").filter(Boolean);
  const difficulty = url.searchParams.get("difficulty")?.split(",").filter(Boolean);
  const exerciseType = url.searchParams.get("exerciseType") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 25;

  const results = await searchExerciseCatalogue(
    { q, muscles, equipment, difficulty, exerciseType },
    limit,
  );

  return NextResponse.json({ results });
}
