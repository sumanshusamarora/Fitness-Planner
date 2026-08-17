import "dotenv/config";
import { COACH_MODEL, isAICoachAvailable } from "@/lib/coach/ai/client";
import { runCoachDecision } from "@/lib/coach/ai/runCoach";
import { ExtraSessionCoachDecisionSchema, type ExtraSessionCoachDecision } from "@/lib/coach/ai/schemas";
import { validateExtraSessionDecision } from "@/lib/coach/ai/validation";

/**
 * Manual smoke test for the runtime AI coach. Requires OPEN_API_KEY and makes
 * one bounded extra-session request. It never touches the database.
 *
 *   npm run coach:smoke
 */
async function main() {
  if (!isAICoachAvailable()) {
    console.error("OPEN_API_KEY is not set. Export it before running the AI coach smoke test.");
    process.exitCode = 1;
    return;
  }
  console.log(`AI coach model: ${COACH_MODEL}`);
  console.log("Sending one bounded extra-session request (requested effort: light)…\n");

  const result = await runCoachDecision<ExtraSessionCoachDecision>({
    mode: "extra_session",
    schema: ExtraSessionCoachDecisionSchema,
    context: {
      user: { id: 0 },
      today: {
        dateISO: "2026-08-17",
        dayNumber: 1,
        planned: null,
        latestRecovery: null,
        plan: null,
        adjacentMuscles: [],
      },
      requestedEffort: "light",
      deterministic: { effort: "light", reason: "smoke", note: null, allowedEfforts: [null, "light"] },
      plan: { weekNumber: 3, name: "Smoke Week" },
      adjacentMuscles: [],
      candidateExercises: [
        { exerciseId: 1, name: "Plank", primaryMuscle: "Core", equipment: "None" },
        { exerciseId: 2, name: "Dumbbell Curl", primaryMuscle: "Biceps", equipment: "Dumbbell" },
      ],
      past: {
        sessionsCompleted: 0,
        sessionsEndedEarly: 0,
        sessionsSkipped: 0,
        averageRpe: null,
        latestRpe: null,
        rpeTrend: "insufficient_data",
        muscleSets: [],
        painFlags: false,
        workouts: [],
      },
    },
    constraints: { allowedEfforts: [null, "light"] },
  });

  if (!result.ok) {
    console.error(`Smoke test failed: ${result.code} — ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  try {
    const decision = validateExtraSessionDecision(result.decision, { requestedEffort: "light" });
    console.log(`OK  action=${decision.action}  effectiveEffort=${decision.effectiveEffort ?? "-"}`);
    console.log(`    rationale=${decision.rationale.join(" | ")}`);
    console.log(`    metadata=${JSON.stringify(result.metadata)}`);
  } catch (error) {
    console.error("Validation failed:", error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
