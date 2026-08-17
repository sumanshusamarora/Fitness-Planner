import Link from "next/link";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { requireCurrentUser } from "@/lib/session";
import { getTrainingProfile } from "@/lib/training-profile";

export const dynamic = "force-dynamic";

export default async function TrainingProfilePage() {
  const user = await requireCurrentUser();
  const profile = await getTrainingProfile(user.id);

  return (
    <div>
      <Link href="/tools" className="text-sm text-zinc-400">
        ← More
      </Link>
      <h1 className="mb-6 mt-4 text-3xl font-bold">Training profile</h1>
      <OnboardingWizard
        mode="edit"
        initial={{
          primaryGoal: profile?.primaryGoal ?? null,
          secondaryGoals: (profile?.secondaryGoals as string[] | null) ?? [],
          experienceLevel: profile?.experienceLevel ?? null,
          yearsSinceTraining: profile?.yearsSinceTraining ?? null,
          desiredDaysPerWeek: profile?.desiredDaysPerWeek ?? null,
          preferredDays: (profile?.preferredDays as number[] | null) ?? [],
          sessionMinutes: profile?.sessionMinutes ?? null,
          trainingEnvironment: profile?.trainingEnvironment ?? null,
          equipmentNotes: profile?.equipmentNotes ?? "",
          limitationsNotes: profile?.limitationsNotes ?? "",
          bodyWeightKg: profile?.bodyWeightKg != null ? String(profile.bodyWeightKg) : "",
          dateOfBirth: user.dateOfBirth ?? "",
          heightCm: user.heightCm != null ? String(user.heightCm) : "",
        }}
      />
    </div>
  );
}
