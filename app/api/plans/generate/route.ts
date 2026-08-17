import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Week generation now requires a reviewed proposal and explicit approval." },
    { status: 410 },
  );
}
