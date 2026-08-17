import { NextResponse } from "next/server";
import { currentUserOrNull } from "@/lib/session";
import {
  isFeedbackReason,
  proposeWeekRebuild,
  getWeekRebuildProposal,
} from "@/lib/week-rebuild";
import type { WeekFeedbackReason } from "@/lib/week-rebuild";

export async function POST(req: Request) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    planId?: number;
    feedback?: {
      primaryReason?: unknown;
      secondaryReasons?: unknown;
      structuredDetails?: Record<string, unknown> | null;
      freeText?: string | null;
    };
  };

  try {
    if (!body.planId) {
      return NextResponse.json({ error: "A plan is required." }, { status: 400 });
    }
    const primaryReason = body.feedback?.primaryReason;
    if (!isFeedbackReason(primaryReason)) {
      return NextResponse.json({ error: "Pick a reason." }, { status: 400 });
    }

    const stored = await proposeWeekRebuild({
      userId: user.id,
      workoutPlanId: body.planId,
      feedback: {
        primaryReason: primaryReason as WeekFeedbackReason,
        secondaryReasons: Array.isArray(body.feedback?.secondaryReasons)
          ? body.feedback!.secondaryReasons!.filter(isFeedbackReason)
          : [],
        structuredDetails: body.feedback?.structuredDetails ?? null,
        freeText: body.feedback?.freeText ?? null,
      },
    });

    return NextResponse.json(stored);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not rebuild the week." },
      { status: 400 },
    );
  }
}

export async function GET(req: Request) {
  const user = await currentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "No profile selected" }, { status: 401 });
  }
  const url = new URL(req.url);
  const proposalId = Number(url.searchParams.get("id"));
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return NextResponse.json({ error: "Proposal id required." }, { status: 400 });
  }
  const stored = await getWeekRebuildProposal(user.id, proposalId);
  if (!stored) {
    return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  }
  return NextResponse.json(stored);
}
