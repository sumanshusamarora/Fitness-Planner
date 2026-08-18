import assert from "node:assert/strict";
import test from "node:test";
import { assemblePastTraining } from "@/lib/coach/ai/context";

test("coach past summary keeps semantic latest performance text (no fake 0 kg)", () => {
  const summary = assemblePastTraining({
    anchorDateISO: "2026-08-18",
    windowStartISO: "2026-08-04",
    sessions: [
      {
        dateISO: "2026-08-17",
        dayName: "Monday",
        title: "Session",
        status: "completed",
        endReason: null,
        exerciseCount: 2,
      },
    ],
    sets: [
      {
        dateISO: "2026-08-17",
        exerciseId: 1,
        exerciseName: "Push-Up",
        measurementType: "bodyweight_reps",
        category: "strength",
        primaryMuscle: "Chest",
        equipment: "Bodyweight",
        weightKg: 0,
        reps: 12,
        rpe: 6,
      },
      {
        dateISO: "2026-08-17",
        exerciseId: 2,
        exerciseName: "Dead Bug",
        measurementType: "timed_hold",
        category: "core",
        primaryMuscle: "Core",
        equipment: "Bodyweight",
        weightKg: 0,
        reps: 30,
        rpe: 5,
      },
    ],
    recovery: [],
    plannedSessions: 1,
  });

  const bodyweight = summary.setsByExercise.find((entry) => entry.exerciseName === "Push-Up");
  const timed = summary.setsByExercise.find((entry) => entry.exerciseName === "Dead Bug");

  assert.ok(bodyweight);
  assert.ok(timed);
  assert.equal(bodyweight?.latestPerformance, "12 reps @ RPE 6");
  assert.equal(timed?.latestPerformance, "30 sec @ RPE 5");
});
