import type {
  RecoveryRecord,
  SessionRecord,
  ToleranceTrend,
  TrainingTolerance,
  TrendDirection,
} from "./types";
import type { AdherenceSummary } from "@/lib/training-summary";

/**
 * Training tolerance: "how much productive training can this user currently
 * recover from?" — kept separate from performance.
 *
 * Uses only factual signals: completed sets, adherence, effort, recovery and
 * the reasons behind skipped / ended-early sessions. Scheduling problems
 * (work/family, equipment busy) and time pressure are never treated as poor
 * physiological tolerance.
 */

const MIN_SESSIONS = 2;
const FATIGUE_REASONS = ["fatigue", "tired", "exhaust", "sleep", "sore", "ill", "sick", "unwell", "recover", "feeling off", "not feeling well", "pain", "injur"];
const SCHEDULE_REASONS = ["work", "family", "equipment", "busy", "time", "schedule", "travel", "child", "kid", "commitment"];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function matchesReason(reason: string | null, keywords: string[]): boolean {
  if (!reason) return false;
  const text = reason.toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

/**
 * Internal, documented recovery-quality signal used only for a *trend*. Each
 * subscale is normalised 0–10 so lower is worse, then averaged. This is not a
 * readiness score exposed to the model; it only drives "improving / stable /
 * worsening".
 */
function recoveryQuality(entry: RecoveryRecord): number {
  const subscales = [
    entry.sleep,
    entry.energy,
    10 - entry.soreness,
    10 - entry.stress,
    10 - entry.jointPain,
  ];
  return subscales.reduce((sum, value) => sum + value, 0) / subscales.length;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function halves(values: number[]): { early: number; late: number; delta: number } | null {
  if (values.length < 2) return null;
  const mid = Math.ceil(values.length / 2);
  const early = mean(values.slice(0, mid));
  const late = mean(values.slice(mid));
  if (early == null || late == null) return null;
  return { early, late, delta: late - early };
}

function classifyTrend(delta: number, threshold: number): TrendDirection {
  if (delta >= threshold) return "increasing";
  if (delta <= -threshold) return "decreasing";
  return "stable";
}

export interface ToleranceInput {
  plannedSessions: number | null;
  sessions: SessionRecord[];
  /** Set RPEs by session, to derive per-session effort and completed sets. */
  sets: { sessionId: number; rpe: number | null }[];
  recovery: RecoveryRecord[];
  adherenceSummary?: AdherenceSummary;
  extraSessions?: number;
}

export function analyzeTolerance(input: ToleranceInput): TrainingTolerance {
  const finished = input.sessions;
  const completed = finished.filter((session) => session.status === "completed");
  const endedEarly = finished.filter((session) => session.status === "ended_early");
  const skipped = finished.filter((session) => session.status === "skipped");

  const adherence = input.adherenceSummary;
  const completedPrescribedSessions = adherence?.completedPrescribedSessions ?? completed.length;
  const endedEarlyPrescribedSessions = adherence?.endedEarlyPrescribedSessions ?? endedEarly.length;
  const skippedPrescribedSessions = adherence?.skippedPrescribedSessions ?? skipped.length;
  const inProgressPrescribedSessions = adherence?.inProgressPrescribedSessions ?? 0;
  const knownOpportunitySessions =
    adherence?.knownOpportunityPrescribedSessions ??
    (completed.length + endedEarly.length + skipped.length);
  const futurePrescribedSessions = adherence?.futurePrescribedSessions ?? 0;
  const pastDuePrescribedSessions = adherence?.pastDuePrescribedSessions ?? 0;
  const prescribedSessions = adherence?.prescribedSessions ?? input.plannedSessions;
  const adherenceRate = adherence?.adherenceRate ?? (finished.length > 0 ? completed.length / finished.length : null);
  const extraSessions = input.extraSessions ?? 0;

  const setsBySession = new Map<number, number>();
  const rpesBySession = new Map<number, number[]>();
  for (const set of input.sets) {
    setsBySession.set(set.sessionId, (setsBySession.get(set.sessionId) ?? 0) + 1);
    if (set.rpe != null) {
      const list = rpesBySession.get(set.sessionId) ?? [];
      list.push(set.rpe);
      rpesBySession.set(set.sessionId, list);
    }
  }

  // Per-session completed sets and average RPE, in chronological order.
  const sessionsInOrder = [...finished].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const setCounts = sessionsInOrder.map((session) => setsBySession.get(session.sessionId) ?? 0);
  const sessionRpes = sessionsInOrder
    .map((session) => {
      const list = rpesBySession.get(session.sessionId) ?? [];
      return list.length ? mean(list) : null;
    })
    .filter((value): value is number => value != null);

  const completedSets = input.sets.length;

  const setHalves = halves(setCounts);
  const rpeHalves = halves(sessionRpes);
  const completedSetsTrend: TrendDirection = setHalves ? classifyTrend(setHalves.delta, 0.5) : "insufficient_data";
  const averageRpeTrend: TrendDirection = rpeHalves ? classifyTrend(rpeHalves.delta, 0.5) : "insufficient_data";

  // Recovery trend across logged recovery entries (chronological).
  const recoveryInOrder = [...input.recovery].sort((a, b) => a.logDate.localeCompare(b.logDate));
  const recoverySeries = recoveryInOrder.map(recoveryQuality);
  const recoveryHalves = halves(recoverySeries);
  const recoveryTrend: TrendDirection = recoveryHalves ? classifyTrend(recoveryHalves.delta, 0.5) : "insufficient_data";

  const fatigueRelatedEndedEarly = endedEarly.filter((session) => matchesReason(session.endReason, FATIGUE_REASONS)).length;
  const scheduleRelatedEndedEarly = endedEarly
    .concat(skipped)
    .filter((session) => matchesReason(session.endReason, SCHEDULE_REASONS)).length;

  const painFlags = input.recovery.some((entry) => entry.jointPain >= 7);
  const meaningfulJointPain = painFlags;

  const evidence: string[] = [];
  if (prescribedSessions != null) {
    evidence.push(`${completedPrescribedSessions}/${prescribedSessions} prescribed sessions completed.`);
  }
  if (adherenceRate != null) {
    evidence.push(
      `Adherence ${Math.round(adherenceRate * 100)}% (${completedPrescribedSessions}/${knownOpportunitySessions}) of prescribed known opportunities.`,
    );
  }
  if (futurePrescribedSessions > 0) {
    evidence.push(`${futurePrescribedSessions} prescribed session(s) are still future opportunities.`);
  }
  if (pastDuePrescribedSessions > 0) {
    evidence.push(`${pastDuePrescribedSessions} prescribed session(s) are past due without a terminal outcome.`);
  }
  if (extraSessions > 0) {
    evidence.push(`${extraSessions} extra session(s) recorded separately from prescribed adherence.`);
  }
  evidence.push(`${completedSets} sets completed across the analysed window.`);
  if (scheduleRelatedEndedEarly > 0) evidence.push(`${scheduleRelatedEndedEarly} session(s) cut short or skipped for scheduling reasons (not a tolerance signal).`);
  if (fatigueRelatedEndedEarly > 0) evidence.push(`${fatigueRelatedEndedEarly} session(s) cut short for recovery/fatigue reasons.`);
  if (meaningfulJointPain) evidence.push("Meaningful joint pain reported.");

  const hasSessions = completed.length >= MIN_SESSIONS;

  let trend: ToleranceTrend = "unknown";
  if (!hasSessions) {
    trend = "unknown";
  } else {
    const workIncreasing = completedSetsTrend === "increasing";
    const workDecreasing = completedSetsTrend === "decreasing";
    const rpeRising = averageRpeTrend === "increasing";
    const recoveryWorsening = recoveryTrend === "decreasing";

    if (recoveryWorsening || (rpeRising && !workDecreasing)) {
      trend = "worsening";
    } else if (workIncreasing && !rpeRising) {
      trend = "improving";
    } else {
      trend = "stable";
    }
  }

  return {
    trend,
    adherenceRate: adherenceRate == null ? null : round1(adherenceRate),
    completedSessions: completedPrescribedSessions,
    plannedSessions: prescribedSessions,
    endedEarlySessions: endedEarlyPrescribedSessions,
    skippedSessions: skippedPrescribedSessions,
    inProgressSessions: inProgressPrescribedSessions,
    futurePrescribedSessions,
    pastDuePrescribedSessions,
    knownOpportunitySessions,
    extraSessions,
    completedSets,
    completedSetsTrend,
    averageRpeTrend,
    recoveryTrend,
    fatigueRelatedEndedEarly,
    scheduleRelatedEndedEarly,
    painFlags,
    meaningfulJointPain,
    evidence,
  };
}
