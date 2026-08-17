import { NextResponse } from "next/server";
import { searchCanonicalExercises } from "@/lib/exercise-search";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? "";
  const rows = await searchCanonicalExercises(query);
  return NextResponse.json({ exercises: rows });
}
