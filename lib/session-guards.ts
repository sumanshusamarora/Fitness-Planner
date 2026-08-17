import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  workoutSessionActivities,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "../db/schema";
import { DomainError } from "./errors";

/**
 * Shared session state guards. Every actual-work mutation must pass through
 * these before touching history, so no ad-hoc per-route checks can drift.
 */

export const TERMINAL_SESSION_STATUSES = [
  "completed",
  "ended_early",
  "skipped",
] as const;

export type TerminalSessionStatus = (typeof TERMINAL_SESSION_STATUSES)[number];

export function isTerminalSessionStatus(status: string): boolean {
  return (TERMINAL_SESSION_STATUSES as readonly string[]).includes(status);
}

/**
 * A minimal queryable shape so these guards work both against the top-level
 * `db` handle and inside a `db.transaction(async (tx) => …)`.
 */
export interface Queryable {
  select: typeof db.select;
  insert: typeof db.insert;
  update: typeof db.update;
  delete: typeof db.delete;
}

/** Loads the session and enforces that it belongs to `userId`. */
export async function requireOwnedSession(
  userId: number,
  sessionId: number,
  q: Queryable = db,
) {
  const rows = await q
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.id, sessionId),
        eq(workoutSessions.userId, userId),
      ),
    )
    .limit(1);
  const session = rows[0];
  if (!session) {
    throw new DomainError("Session not found.", "SESSION_NOT_FOUND", 404);
  }
  return session;
}

/**
 * Loads the session and requires it to still be `in_progress`. Every mutation
 * of actual work (sets, activities, exercises, completion, replacement) uses
 * this guard so terminal history can never be silently rewritten.
 */
export async function requireInProgressSession(
  userId: number,
  sessionId: number,
  q: Queryable = db,
) {
  const session = await requireOwnedSession(userId, sessionId, q);
  if (session.status !== "in_progress") {
    throw new DomainError(
      "This workout is already finalised; actual history is locked.",
      "SESSION_NOT_IN_PROGRESS",
      409,
    );
  }
  return session;
}

/**
 * True when the session carries any user-authored actual state: a set, an
 * activity, or an exercise outcome (completed/skipped/replaced) or added /
 * replacement work. Automatically created "pending" planned rows are not
 * actual work and do not count.
 */
export async function hasActualWork(q: Queryable, sessionId: number): Promise<boolean> {
  const [setRows, activityRows, exerciseRows] = await Promise.all([
    q
      .select({ id: workoutSets.id })
      .from(workoutSets)
      .innerJoin(
        workoutSessionExercises,
        eq(workoutSets.workoutSessionExerciseId, workoutSessionExercises.id),
      )
      .where(eq(workoutSessionExercises.workoutSessionId, sessionId))
      .limit(1),
    q
      .select({ id: workoutSessionActivities.id })
      .from(workoutSessionActivities)
      .where(eq(workoutSessionActivities.workoutSessionId, sessionId))
      .limit(1),
    q
      .select({
        status: workoutSessionExercises.status,
        origin: workoutSessionExercises.origin,
      })
      .from(workoutSessionExercises)
      .where(eq(workoutSessionExercises.workoutSessionId, sessionId)),
  ]);

  if (setRows.length > 0 || activityRows.length > 0) return true;

  return exerciseRows.some(
    (row) =>
      row.status === "completed" ||
      row.status === "skipped" ||
      row.status === "replaced" ||
      row.origin === "added" ||
      row.origin === "replacement",
  );
}