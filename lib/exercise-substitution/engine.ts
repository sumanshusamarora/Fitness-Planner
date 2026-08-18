import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { exercises, workoutSessionExercises } from "@/db/schema";
import { runCoachDecision } from "@/lib/coach/ai/runCoach";
import type { CoachRunMetadata } from "@/lib/coach/ai/types";
import {
  getCompatibleEquipment,
  getExerciseMuscles,
  getExerciseRelationships,
  getUserExerciseSignals,
  getUserGymAvailability,
  type ExerciseRelationshipType,
  type UserExerciseSignals,
} from "@/lib/exercise-knowledge";
import { measurementTypeFor, type MeasurementType } from "@/lib/exercise-measurement";
import { buildProgressAnalytics } from "@/lib/progress";
import { requireInProgressSession } from "@/lib/session-guards";
import { DomainError } from "@/lib/errors";

export type SubstitutionReason =
  | "equipment_busy"
  | "equipment_unavailable"
  | "pain_discomfort"
  | "preference"
  | "coach_adjustment"
  | "other";

export type ReplacementScope = "temporary" | "anchor_change";

export interface CandidateFact {
  exerciseId: number;
  name: string;
  relationship: ExerciseRelationshipType | "taxonomy";
  movementPattern: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipmentTypes: string[];
  availability: "available" | "unavailable" | "unknown";
  usedBefore: boolean;
  successfulExposures: number;
  preference: "preferred" | "dont_prefer" | null;
  painHistory: number;
  equipmentBusyFrequency: number;
  anchorState: "none" | "candidate" | "current" | null;
  measurementType: MeasurementType;
  mechanics: string | null;
  laterality: string | null;
  stability: string | null;
  skillDemand: string | null;
  progressionSuitability: string | null;
  score: number;
  scoreNotes: string[];
}

export interface SubstitutionDecision {
  decision: "keep_current" | "replace";
  selectedExerciseId: number | null;
  replacementScope: ReplacementScope | null;
  reasonCode:
    | "no_change_needed"
    | "equipment_issue"
    | "pain_signal"
    | "preference_signal"
    | "plateau_signal"
    | "programming_shift"
    | "coach_adjustment"
    | "fallback";
  rationale: string[];
}

export interface SubstitutionSource {
  source: "llm" | "deterministic_fallback";
  provider: string | null;
  model: string;
  label: string;
}

export interface ReplacementOptionsResult {
  current: {
    exerciseId: number;
    name: string;
    movementPattern: string | null;
    primaryMuscle: string;
    measurementType: string;
    anchorState: "none" | "candidate" | "current" | null;
    progressingOrStable: boolean;
  };
  decision: SubstitutionDecision;
  source: SubstitutionSource;
  recommended: CandidateFact | null;
  candidates: CandidateFact[];
}

type SessionExerciseRow = {
  id: number;
  exerciseId: number;
  name: string;
  primaryMuscle: string;
  category: string;
  equipment: string;
  movementPattern: string | null;
  mechanics: string | null;
  laterality: string | null;
  stability: string | null;
  skillDemand: string | null;
  progressionSuitability: string | null;
  measurementType: string | null;
  origin: string;
  status: string;
};

type AvailabilitySummary = {
  availability: "available" | "unavailable" | "unknown";
  equipmentTypes: string[];
};

const LLM_SUBSTITUTION_DECISION_SCHEMA = z.object({
  decision: z.enum(["keep_current", "replace"]),
  selectedExerciseId: z.number().int().positive().nullable(),
  replacementScope: z.enum(["temporary", "anchor_change"]).nullable(),
  reasonCode: z.enum([
    "no_change_needed",
    "equipment_issue",
    "pain_signal",
    "preference_signal",
    "plateau_signal",
    "programming_shift",
    "coach_adjustment",
    "fallback",
  ]),
  rationale: z.array(z.string().min(1).max(180)).min(1).max(3),
});

function coachSourceLabel(source: "llm" | "deterministic_fallback", metadata?: CoachRunMetadata): string {
  if (source !== "llm" || !metadata) return "Local fallback";
  if (metadata.provider === "openai") return "GPT-5";
  if (metadata.provider === "deepseek") return "DeepSeek";
  return metadata.model;
}

function inferMeasurementType(row: Pick<SessionExerciseRow, "measurementType" | "category" | "equipment" | "name">): MeasurementType {
  return measurementTypeFor({
    measurementType: row.measurementType,
    category: row.category,
    equipment: row.equipment,
    name: row.name,
  });
}

function relationshipWeight(relationship: CandidateFact["relationship"]): number {
  if (relationship === "very_similar") return 4;
  if (relationship === "substitute") return 3;
  if (relationship === "related") return 1;
  return 0;
}

export function rankSubstitutionCandidate(
  current: Pick<SessionExerciseRow, "movementPattern" | "primaryMuscle" | "stability" | "skillDemand" | "mechanics">,
  candidate: Omit<CandidateFact, "score" | "scoreNotes">,
): { score: number; notes: string[] } {
  let score = 0;
  const notes: string[] = [];

  const rel = relationshipWeight(candidate.relationship);
  if (rel > 0) {
    score += rel;
    notes.push(`Relationship: ${candidate.relationship.replace("_", " ")}`);
  }

  if (current.movementPattern && candidate.movementPattern && current.movementPattern === candidate.movementPattern) {
    score += 3;
    notes.push("Same movement pattern");
  }

  if (candidate.primaryMuscles.some((m) => m.toLowerCase() === current.primaryMuscle.toLowerCase())) {
    score += 2;
    notes.push("Preserves primary muscle emphasis");
  }

  if (candidate.availability === "available") {
    score += 2;
    notes.push("Known available at your gym");
  } else if (candidate.availability === "unknown") {
    score += 1;
  }

  if (candidate.usedBefore && candidate.successfulExposures > 0) {
    score += 1;
    notes.push("Used successfully before");
  }

  if (candidate.preference === "preferred") {
    score += 2;
    notes.push("Marked preferred");
  }

  if (candidate.stability === current.stability && candidate.stability != null) score += 1;
  if (candidate.skillDemand === current.skillDemand && candidate.skillDemand != null) score += 1;
  if (candidate.mechanics === current.mechanics && candidate.mechanics != null) score += 1;

  if (candidate.painHistory > 0) score -= 2;
  if (candidate.equipmentBusyFrequency >= 2) score -= 1;

  return { score, notes };
}

export function evaluateKeepCurrent(
  reason: SubstitutionReason,
  currentSignals: UserExerciseSignals,
  progressingOrStable: boolean,
): { keep: boolean; rationale: string[] } {
  const tolerated = reason !== "pain_discomfort" && currentSignals.painDiscomfortFrequency < 2;
  const available = !currentSignals.knownUnavailable;
  const familiar = currentSignals.usedBefore;

  const baselineKeep = tolerated && available && familiar && progressingOrStable;

  if (reason === "equipment_unavailable") {
    return { keep: false, rationale: ["Current setup is explicitly unavailable."] };
  }

  if (reason === "pain_discomfort") {
    return { keep: false, rationale: ["Pain/discomfort should trigger a safer temporary change."] };
  }

  if (reason === "equipment_busy") {
    if (currentSignals.equipmentBusyFrequency < 2 && currentSignals.knownAvailable) {
      return {
        keep: true,
        rationale: ["Single busy event is not enough to rotate a productive anchor."],
      };
    }
    return {
      keep: !currentSignals.knownUnavailable && baselineKeep,
      rationale: ["Repeated busy events can justify a substitute."] ,
    };
  }

  if (reason === "preference") {
    if (currentSignals.preference === "dont_prefer") {
      return { keep: false, rationale: ["Strong preference signal supports a change."] };
    }
    return {
      keep: baselineKeep,
      rationale: ["One-off preference can keep the anchor unless performance/fit is poor."],
    };
  }

  if (reason === "coach_adjustment") {
    return { keep: false, rationale: ["Coach adjustment explicitly requested."] };
  }

  return {
    keep: baselineKeep,
    rationale: baselineKeep
      ? ["Exercise is tolerated, available, familiar, and progressing/stable."]
      : ["Exercise fit is uncertain; evaluate alternatives."],
  };
}

function shouldAllowAnchorChange(reason: SubstitutionReason, signals: UserExerciseSignals): boolean {
  if (reason === "equipment_unavailable") return true;
  if (reason === "coach_adjustment") return true;
  if (reason === "equipment_busy" && signals.equipmentBusyFrequency >= 3) return true;
  if (reason === "preference" && signals.preference === "dont_prefer" && signals.replacementFrequency >= 2) return true;
  return false;
}

export function filterSubstitutionCandidates(
  current: Pick<SessionExerciseRow, "exerciseId" | "movementPattern" | "primaryMuscle" | "measurementType" | "category" | "equipment" | "name" | "mechanics" | "laterality">,
  reason: SubstitutionReason,
  candidates: Omit<CandidateFact, "score" | "scoreNotes">[],
): Omit<CandidateFact, "score" | "scoreNotes">[] {
  const currentMeasurement = inferMeasurementType(current);

  return candidates.filter((candidate) => {
    if (!Number.isInteger(candidate.exerciseId) || candidate.exerciseId <= 0) return false;
    if (candidate.exerciseId === current.exerciseId) return false;

    if (candidate.availability === "unavailable") return false;
    if (candidate.preference === "dont_prefer") return false;

    if (candidate.measurementType !== currentMeasurement) return false;

    const samePattern = current.movementPattern && candidate.movementPattern && current.movementPattern === candidate.movementPattern;
    const primaryMatch = candidate.primaryMuscles.some((m) => m.toLowerCase() === current.primaryMuscle.toLowerCase());
    const hasStrongRelation = candidate.relationship === "very_similar" || candidate.relationship === "substitute";
    if (!samePattern && !primaryMatch && !hasStrongRelation) return false;

    if (reason === "pain_discomfort") {
      if (candidate.painHistory > 0) return false;
      const sameMechanics = current.mechanics != null && candidate.mechanics === current.mechanics;
      const sameLaterality = current.laterality != null && candidate.laterality === current.laterality;
      if (samePattern && sameMechanics && sameLaterality) return false;
    }

    return true;
  });
}

async function summarizeAvailability(userId: number, exerciseId: number): Promise<AvailabilitySummary> {
  const compat = await getCompatibleEquipment(exerciseId);
  if (compat.length === 0) {
    return { availability: "unknown", equipmentTypes: [] };
  }

  const equipmentTypes = compat.map((item) => item.code);
  const states = await Promise.all(equipmentTypes.map((code) => getUserGymAvailability(userId, code)));

  // Unknown is eligible. Unavailable only wins when there is no known-available signal.
  const hasUnavailable = states.some((state) => state.availability === "unavailable");
  const hasAvailable = states.some((state) => state.availability === "available");

  if (hasUnavailable && !hasAvailable) {
    return { availability: "unavailable", equipmentTypes };
  }
  if (hasAvailable) {
    return { availability: "available", equipmentTypes };
  }
  return { availability: "unknown", equipmentTypes };
}

async function loadSessionExercise(userId: number, sessionId: number, exerciseId: number): Promise<SessionExerciseRow> {
  await requireInProgressSession(userId, sessionId);

  const row = (
    await db
      .select({
        id: workoutSessionExercises.id,
        exerciseId: exercises.id,
        name: exercises.name,
        primaryMuscle: exercises.primaryMuscle,
        category: exercises.category,
        equipment: exercises.equipment,
        movementPattern: exercises.movementPattern,
        mechanics: exercises.mechanics,
        laterality: exercises.laterality,
        stability: exercises.stability,
        skillDemand: exercises.skillDemand,
        progressionSuitability: exercises.progressionSuitability,
        measurementType: exercises.measurementType,
        origin: workoutSessionExercises.origin,
        status: workoutSessionExercises.status,
      })
      .from(workoutSessionExercises)
      .innerJoin(exercises, eq(workoutSessionExercises.exerciseId, exercises.id))
      .where(
        and(
          eq(workoutSessionExercises.workoutSessionId, sessionId),
          eq(workoutSessionExercises.exerciseId, exerciseId),
        ),
      )
      .limit(1)
  )[0];

  if (!row) {
    throw new DomainError("Exercise not found in session.", "EXERCISE_NOT_FOUND", 404);
  }
  if (row.origin !== "planned" || row.status !== "pending") {
    throw new DomainError(
      "Only a pending planned exercise can be replaced.",
      "EXERCISE_NOT_REPLACEABLE",
      409,
    );
  }

  return row;
}

async function buildCandidateFacts(
  userId: number,
  current: SessionExerciseRow,
): Promise<Omit<CandidateFact, "score" | "scoreNotes">[]> {
  const relationships = await getExerciseRelationships(current.exerciseId);
  const relationById = new Map<number, ExerciseRelationshipType>();
  for (const edge of relationships) {
    const otherId = edge.direction === "outgoing" ? edge.toExerciseId : edge.fromExerciseId;
    relationById.set(otherId, edge.relationshipType);
  }

  const relatedIds = [...relationById.keys()];
  const library = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      primaryMuscle: exercises.primaryMuscle,
      category: exercises.category,
      equipment: exercises.equipment,
      measurementType: exercises.measurementType,
      movementPattern: exercises.movementPattern,
      mechanics: exercises.mechanics,
      laterality: exercises.laterality,
      stability: exercises.stability,
      skillDemand: exercises.skillDemand,
      progressionSuitability: exercises.progressionSuitability,
      active: exercises.active,
    })
    .from(exercises)
    .where(and(eq(exercises.active, true), ne(exercises.id, current.exerciseId)));

  const fallbackIds = library
    .filter((exercise) => {
      const samePattern = current.movementPattern != null && exercise.movementPattern === current.movementPattern;
      const samePrimary = exercise.primaryMuscle.toLowerCase() === current.primaryMuscle.toLowerCase();
      const sameMeasurement =
        measurementTypeFor({
          measurementType: exercise.measurementType,
          category: exercise.category,
          equipment: exercise.equipment,
          name: exercise.name,
        }) === inferMeasurementType(current);
      return samePattern || samePrimary || sameMeasurement;
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 40)
    .map((exercise) => exercise.id);

  const candidateIds = [...new Set([...relatedIds, ...fallbackIds])].slice(0, 40);

  const byId = new Map(library.map((exercise) => [exercise.id, exercise]));

  const facts = await Promise.all(
    candidateIds.map(async (exerciseId) => {
      const row = byId.get(exerciseId);
      if (!row) return null;

      const [muscles, signals, availability] = await Promise.all([
        getExerciseMuscles(exerciseId),
        getUserExerciseSignals(userId, exerciseId),
        summarizeAvailability(userId, exerciseId),
      ]);

      const primaryMuscles = muscles.filter((m) => m.role === "primary").map((m) => m.name);
      const secondaryMuscles = muscles.filter((m) => m.role === "secondary").map((m) => m.name);

      return {
        exerciseId,
        name: row.name,
        relationship: relationById.get(exerciseId) ?? "taxonomy",
        movementPattern: row.movementPattern,
        primaryMuscles: primaryMuscles.length > 0 ? primaryMuscles : [row.primaryMuscle],
        secondaryMuscles,
        equipmentTypes: availability.equipmentTypes,
        availability: availability.availability,
        usedBefore: signals.usedBefore,
        successfulExposures: signals.successfulExposures,
        preference: signals.preference,
        painHistory: signals.painDiscomfortFrequency,
        equipmentBusyFrequency: signals.equipmentBusyFrequency,
        anchorState: signals.anchorState,
        measurementType: measurementTypeFor({
          measurementType: row.measurementType,
          category: row.category,
          equipment: row.equipment,
          name: row.name,
        }),
        mechanics: row.mechanics,
        laterality: row.laterality,
        stability: row.stability,
        skillDemand: row.skillDemand,
        progressionSuitability: row.progressionSuitability,
      } satisfies Omit<CandidateFact, "score" | "scoreNotes">;
    }),
  );

  return facts.filter((fact): fact is Omit<CandidateFact, "score" | "scoreNotes"> => fact != null);
}

function fallbackDecision(
  keepCurrent: boolean,
  keepRationale: string[],
  ranked: CandidateFact[],
): SubstitutionDecision {
  if (keepCurrent || ranked.length === 0) {
    return {
      decision: "keep_current",
      selectedExerciseId: null,
      replacementScope: null,
      reasonCode: "no_change_needed",
      rationale: keepRationale.slice(0, 3),
    };
  }

  return {
    decision: "replace",
    selectedExerciseId: ranked[0].exerciseId,
    replacementScope: "temporary",
    reasonCode: "fallback",
    rationale: [
      "Using the best deterministic substitute.",
      ...ranked[0].scoreNotes.slice(0, 2),
    ].slice(0, 3),
  };
}

export function isValidSubstitutionModelDecision(
  decision: z.infer<typeof LLM_SUBSTITUTION_DECISION_SCHEMA>,
  candidateIds: Set<number>,
): boolean {
  if (decision.decision === "keep_current") return true;
  if (decision.selectedExerciseId == null) return false;
  return candidateIds.has(decision.selectedExerciseId);
}

export async function getReplacementOptions(input: {
  userId: number;
  sessionId: number;
  exerciseId: number;
  reason: SubstitutionReason;
  maxCandidates?: number;
}): Promise<ReplacementOptionsResult> {
  const maxCandidates = Math.max(3, Math.min(5, input.maxCandidates ?? 5));

  const current = await loadSessionExercise(input.userId, input.sessionId, input.exerciseId);
  const [currentSignals, progress] = await Promise.all([
    getUserExerciseSignals(input.userId, current.exerciseId),
    buildProgressAnalytics({ userId: input.userId }),
  ]);

  const currentProgress = progress.exercises.find((entry) => entry.exerciseId === current.exerciseId);
  const progressingOrStable =
    !currentProgress ||
    ["improving_fast", "improving", "improving_slowly", "flat"].includes(currentProgress.direction);

  const keep = evaluateKeepCurrent(input.reason, currentSignals, progressingOrStable);

  const generated = await buildCandidateFacts(input.userId, current);
  const filtered = filterSubstitutionCandidates(current, input.reason, generated);

  const ranked = filtered
    .map((candidate) => {
      const rankedInfo = rankSubstitutionCandidate(current, candidate);
      return {
        ...candidate,
        score: rankedInfo.score,
        scoreNotes: rankedInfo.notes,
      } satisfies CandidateFact;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.relationship !== b.relationship) return relationshipWeight(b.relationship) - relationshipWeight(a.relationship);
      return a.name.localeCompare(b.name);
    })
    .slice(0, maxCandidates);

  const candidateIds = new Set(ranked.map((candidate) => candidate.exerciseId));
  const allowAnchorChange = shouldAllowAnchorChange(input.reason, currentSignals);

  const deterministic = fallbackDecision(keep.keep, keep.rationale, ranked);

  let decision = deterministic;
  let source: SubstitutionSource = {
    source: "deterministic_fallback",
    provider: null,
    model: "deterministic",
    label: "Local fallback",
  };

  if (ranked.length > 0) {
    const result = await runCoachDecision<z.infer<typeof LLM_SUBSTITUTION_DECISION_SCHEMA>>({
      mode: "exercise_substitution",
      schema: LLM_SUBSTITUTION_DECISION_SCHEMA,
      context: {
        reason: input.reason,
        keepCurrentRecommended: keep.keep,
        keepCurrentRationale: keep.rationale,
        currentExercise: {
          exerciseId: current.exerciseId,
          name: current.name,
          movementPattern: current.movementPattern,
          primaryMuscle: current.primaryMuscle,
          measurementType: inferMeasurementType(current),
          progressingOrStable,
          anchorState: currentSignals.anchorState,
        },
        candidates: ranked.map((candidate) => ({
          exerciseId: candidate.exerciseId,
          name: candidate.name,
          relationship: candidate.relationship,
          movementPattern: candidate.movementPattern,
          primaryMuscles: candidate.primaryMuscles,
          secondaryMuscles: candidate.secondaryMuscles,
          equipmentTypes: candidate.equipmentTypes,
          availability: candidate.availability,
          usedBefore: candidate.usedBefore,
          successfulExposures: candidate.successfulExposures,
          preference: candidate.preference,
          painHistory: candidate.painHistory,
          equipmentBusyFrequency: candidate.equipmentBusyFrequency,
          anchorState: candidate.anchorState,
          measurementType: candidate.measurementType,
          score: candidate.score,
          notes: candidate.scoreNotes,
        })),
      },
      constraints: {
        allowedExerciseIds: [...candidateIds],
        decisionContract: "Return keep_current or replace with one allowed exerciseId.",
        allowAnchorChange,
      },
      reasoningEffort: "low",
      timeoutMs: 20000,
    });

    if (result.ok && isValidSubstitutionModelDecision(result.decision, candidateIds)) {
      const llmDecision = result.decision;
      const selectedScope =
        llmDecision.decision === "replace"
          ? llmDecision.replacementScope ?? "temporary"
          : null;

      decision = {
        decision: llmDecision.decision,
        selectedExerciseId:
          llmDecision.decision === "replace"
            ? llmDecision.selectedExerciseId
            : null,
        replacementScope:
          selectedScope === "anchor_change" && allowAnchorChange
            ? "anchor_change"
            : selectedScope === "anchor_change"
              ? "temporary"
              : selectedScope,
        reasonCode: llmDecision.reasonCode,
        rationale: llmDecision.rationale.slice(0, 3),
      };

      source = {
        source: "llm",
        provider: result.metadata.provider,
        model: result.metadata.model,
        label: coachSourceLabel("llm", result.metadata),
      };
    }
  }

  const recommended = decision.decision === "replace"
    ? ranked.find((candidate) => candidate.exerciseId === decision.selectedExerciseId) ?? ranked[0] ?? null
    : null;

  return {
    current: {
      exerciseId: current.exerciseId,
      name: current.name,
      movementPattern: current.movementPattern,
      primaryMuscle: current.primaryMuscle,
      measurementType: inferMeasurementType(current),
      anchorState: currentSignals.anchorState,
      progressingOrStable,
    },
    decision,
    source,
    recommended,
    candidates: ranked,
  };
}
