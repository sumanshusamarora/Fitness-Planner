import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTolerance } from "@/lib/progress";
import { buildAdherenceSummary, buildPlanVsActualSummary } from "@/lib/training-summary";

test("adherence excludes future opportunities and cannot exceed 100% with extras", () => {
  const adherence = buildAdherenceSummary({
    anchorDateISO: "2026-08-18",
    prescribedOpportunities: [
      { dateISO: "2026-08-16", status: "completed" },
      { dateISO: "2026-08-17", status: "completed" },
      { dateISO: "2026-08-18", status: "in_progress" },
      { dateISO: "2026-08-20", status: "none" },
    ],
  });

  assert.equal(adherence.completedPrescribedSessions, 2);
  assert.equal(adherence.knownOpportunityPrescribedSessions, 2);
  assert.equal(adherence.futurePrescribedSessions, 2);
  assert.equal(adherence.adherencePercent, 100);
});

test("skipped prescribed sessions count in known opportunities", () => {
  const adherence = buildAdherenceSummary({
    anchorDateISO: "2026-08-18",
    prescribedOpportunities: [
      { dateISO: "2026-08-16", status: "completed" },
      { dateISO: "2026-08-17", status: "skipped" },
    ],
  });

  assert.equal(adherence.completedPrescribedSessions, 1);
  assert.equal(adherence.skippedPrescribedSessions, 1);
  assert.equal(adherence.knownOpportunityPrescribedSessions, 2);
  assert.equal(adherence.adherencePercent, 50);
});

test("ended-early contributes actual work but not full completion", () => {
  const summary = buildPlanVsActualSummary({
    sessions: [
      {
        sessionId: 1,
        dateISO: "2026-08-17",
        isPrescribed: true,
        status: "ended_early",
        plannedWorkingSets: 6,
        completedPlannedWorkingSets: 3,
        extraWorkingSets: 1,
        replacementWorkingSets: 1,
        replacements: 1,
        replacementReasons: ["equipment_busy"],
        warmupMinutes: 5,
        cardioMinutes: 10,
        mobilityMinutes: 6,
        cooldownMinutes: 4,
        otherActivityMinutes: 3,
      },
    ],
  });

  assert.equal(summary.plannedWorkingSets, 6);
  assert.equal(summary.completedPlannedWorkingSets, 3);
  assert.equal(summary.actualWorkingSets, 5);
  assert.equal(summary.extraWorkingSets, 1);
  assert.equal(summary.replacementWorkingSets, 1);
  assert.equal(summary.sessions[0].completedPlannedRatio, 0.5);
  assert.equal(summary.activityMinutes.cardio, 10);
  assert.equal(summary.activityMinutes.mobility, 6);
  assert.equal(summary.replacementReasons[0]?.reason, "equipment_busy");
});

test("in-progress prescribed session is not treated as terminal adherence outcome", () => {
  const adherence = buildAdherenceSummary({
    anchorDateISO: "2026-08-18",
    prescribedOpportunities: [
      { dateISO: "2026-08-18", status: "in_progress" },
    ],
  });

  assert.equal(adherence.inProgressPrescribedSessions, 1);
  assert.equal(adherence.knownOpportunityPrescribedSessions, 0);
  assert.equal(adherence.adherenceRate, null);
});

test("tolerance uses canonical adherence signals and keeps schedule disruption as confounder", () => {
  const tolerance = analyzeTolerance({
    plannedSessions: 4,
    sessions: [
      {
        sessionId: 1,
        status: "completed",
        startedAt: "2026-08-14T10:00:00.000Z",
        completedAt: "2026-08-14T11:00:00.000Z",
        endReason: null,
        overallRpe: null,
        energyRating: null,
      },
      {
        sessionId: 2,
        status: "ended_early",
        startedAt: "2026-08-15T10:00:00.000Z",
        completedAt: "2026-08-15T10:40:00.000Z",
        endReason: "work",
        overallRpe: null,
        energyRating: null,
      },
      {
        sessionId: 3,
        status: "skipped",
        startedAt: "2026-08-16T10:00:00.000Z",
        completedAt: "2026-08-16T10:05:00.000Z",
        endReason: "family",
        overallRpe: null,
        energyRating: null,
      },
    ],
    sets: [
      { sessionId: 1, rpe: 6 },
      { sessionId: 1, rpe: 6 },
      { sessionId: 2, rpe: 7 },
    ],
    recovery: [
      { logDate: "2026-08-14", sleep: 7, energy: 7, soreness: 2, jointPain: 0, stress: 3 },
    ],
    adherenceSummary: {
      prescribedSessions: 4,
      completedPrescribedSessions: 1,
      endedEarlyPrescribedSessions: 1,
      skippedPrescribedSessions: 1,
      inProgressPrescribedSessions: 0,
      futurePrescribedSessions: 1,
      pastDuePrescribedSessions: 0,
      knownOpportunityPrescribedSessions: 3,
      adherenceRate: 1 / 3,
      adherencePercent: 33,
    },
    extraSessions: 1,
  });

  assert.equal(tolerance.completedSessions, 1);
  assert.equal(tolerance.endedEarlySessions, 1);
  assert.equal(tolerance.skippedSessions, 1);
  assert.equal(tolerance.knownOpportunitySessions, 3);
  assert.equal(tolerance.futurePrescribedSessions, 1);
  assert.equal(tolerance.extraSessions, 1);
  assert.equal(tolerance.adherenceRate, 0.3);
  assert.ok(tolerance.scheduleRelatedEndedEarly >= 2);
});
