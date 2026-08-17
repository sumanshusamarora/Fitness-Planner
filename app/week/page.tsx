import { eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { workoutPlanDays, workoutSessions } from "@/db/schema";
import { todayDayNumber } from "@/lib/dates";
import { hasPlanForWeek, isWeekComplete } from "@/lib/generation";
import { getActivePlan, getPlanExercises } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export default async function WeekPage() {
  const plan = await getActivePlan();

  if (!plan) {
    return <p className="text-lg text-zinc-400">No active plan.</p>;
  }

  const days = await db
    .select()
    .from(workoutPlanDays)
    .where(eq(workoutPlanDays.workoutPlanId, plan.id))
    .orderBy(workoutPlanDays.dayNumber);

  const today = todayDayNumber();

  const weekComplete = await isWeekComplete(plan);
  const nextExists = await hasPlanForWeek(plan.weekNumber + 1);

  const rows = await Promise.all(
    days.map(async (day) => {
      const planExercises = await getPlanExercises(day.id);
      const sessions = await db
        .select()
        .from(workoutSessions)
        .where(eq(workoutSessions.workoutPlanDayId, day.id));
      const completed = sessions.some((s) => s.completedAt != null);
      return { day, exerciseCount: planExercises.length, completed };
    }),
  );

  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">
        Week {plan.weekNumber}
      </h1>

      <div className="space-y-3">
        {rows.map(({ day, exerciseCount, completed }) => {
          const isToday = day.dayNumber === today;
          const isRest = exerciseCount === 0;
          return (
            <div
              key={day.id}
              className={`flex items-center justify-between rounded-2xl border p-4 ${
                isToday
                  ? "border-emerald-500 bg-zinc-900"
                  : "border-zinc-800 bg-zinc-900"
              }`}
            >
              <div>
                <p
                  className={`text-xs font-semibold uppercase tracking-widest ${
                    isToday ? "text-emerald-400" : "text-zinc-500"
                  }`}
                >
                  {day.dayName}
                </p>
                <p className="mt-1 text-lg font-semibold">{day.title}</p>
              </div>

              <div className="flex items-center gap-3">
                {!isRest && (
                  <span className="text-sm text-zinc-500">
                    {exerciseCount} exercises
                  </span>
                )}
                {completed ? (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-lg font-bold text-zinc-950">
                    ✓
                  </span>
                ) : isRest ? (
                  <span className="rounded-full bg-zinc-800 px-3 py-1 text-sm text-zinc-500">
                    Rest
                  </span>
                ) : (
                  <span className="h-3 w-3 rounded-full bg-zinc-700" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {weekComplete && !nextExists && (
        <Link
          href="/week/next"
          className="mt-6 block w-full rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-zinc-950 transition active:scale-[0.98]"
        >
          PLAN NEXT WEEK
        </Link>
      )}
    </div>
  );
}
