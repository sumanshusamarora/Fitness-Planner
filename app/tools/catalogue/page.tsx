import Link from "next/link";
import { CatalogueReview } from "@/components/CatalogueReview";
import { listCanonicalExercisesWithMappings } from "@/lib/external-exercises";
import { requireCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  await requireCurrentUser();
  const data = await listCanonicalExercisesWithMappings();

  return (
    <div>
      <Link href="/tools" className="text-sm text-zinc-400">
        ← Tools
      </Link>
      <h1 className="mb-6 mt-4 text-3xl font-bold">Exercise catalogue</h1>
      <CatalogueReview initial={data} />
    </div>
  );
}
