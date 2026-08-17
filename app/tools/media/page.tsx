import { asc } from "drizzle-orm";
import Link from "next/link";
import { MediaEditor } from "@/components/MediaEditor";
import { db } from "@/db";
import { exerciseMedia, exercises } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function MediaEditorPage() {
  const exs = await db
    .select()
    .from(exercises)
    .orderBy(asc(exercises.name));

  const mediaRows = await db
    .select()
    .from(exerciseMedia)
    .orderBy(asc(exerciseMedia.exerciseId), asc(exerciseMedia.sortOrder));

  const data = exs.map((ex) => {
    const rows = mediaRows.filter((m) => m.exerciseId === ex.id);
    const image =
      rows.find((m) => m.mediaType === "image" && m.isPrimary) ??
      rows.find((m) => m.mediaType === "image");
    const youtube = rows.find((m) => m.mediaType === "youtube");
    const article = rows.find((m) => m.mediaType === "article");
    return {
      id: ex.id,
      name: ex.name,
      imageUrl: image?.url ?? "",
      youtubeUrl: youtube?.url ?? "",
      articleUrl: article?.url ?? "",
    };
  });

  return (
    <div>
      <Link href="/tools" className="text-sm text-zinc-400">
        ← Tools
      </Link>
      <h1 className="mb-6 mt-4 text-3xl font-bold">Exercise references</h1>
      <MediaEditor exercises={data} />
    </div>
  );
}
