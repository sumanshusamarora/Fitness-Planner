import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { exercises } from "@/db/schema";

/** Lightweight canonical exercise search for add-activity / replace flows. */
export async function searchCanonicalExercises(query: string, limit = 20) {
  const q = query.trim().toLowerCase();
  const rows = q
    ? await db
        .select({
          id: exercises.id,
          name: exercises.name,
          category: exercises.category,
          primaryMuscle: exercises.primaryMuscle,
          equipment: exercises.equipment,
          measurementType: exercises.measurementType,
        })
        .from(exercises)
        .where(
          and(
            eq(exercises.active, true),
            ilike(exercises.name, `%${q}%`),
          ),
        )
        .orderBy(asc(exercises.name))
        .limit(limit)
    : await db
        .select({
          id: exercises.id,
          name: exercises.name,
          category: exercises.category,
          primaryMuscle: exercises.primaryMuscle,
          equipment: exercises.equipment,
          measurementType: exercises.measurementType,
        })
        .from(exercises)
        .where(eq(exercises.active, true))
        .orderBy(asc(exercises.name))
        .limit(limit);

  return rows;
}
