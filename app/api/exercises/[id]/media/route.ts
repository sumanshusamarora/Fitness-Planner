import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { exerciseMedia } from "@/db/schema";
import { extractYoutubeVideoId, youtubeThumbnailUrl } from "@/lib/media";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const exerciseId = Number(id);

  if (!Number.isFinite(exerciseId)) {
    return NextResponse.json({ error: "Invalid exercise id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    imageUrl?: string;
    youtubeUrl?: string;
    articleUrl?: string;
  };

  const imageUrl = (body.imageUrl ?? "").trim();
  const youtubeUrl = (body.youtubeUrl ?? "").trim();
  const articleUrl = (body.articleUrl ?? "").trim();

  await db.delete(exerciseMedia).where(eq(exerciseMedia.exerciseId, exerciseId));

  let sort = 0;
  if (imageUrl) {
    await db.insert(exerciseMedia).values({
      exerciseId,
      mediaType: "image",
      url: imageUrl,
      isPrimary: true,
      sortOrder: sort++,
    });
  }
  if (youtubeUrl) {
    const videoId = extractYoutubeVideoId(youtubeUrl);
    await db.insert(exerciseMedia).values({
      exerciseId,
      mediaType: "youtube",
      url: youtubeUrl,
      youtubeVideoId: videoId,
      thumbnailUrl: videoId ? youtubeThumbnailUrl(videoId) : null,
      title: videoId ? "Technique video" : null,
      sortOrder: sort++,
    });
  }
  if (articleUrl) {
    await db.insert(exerciseMedia).values({
      exerciseId,
      mediaType: "article",
      url: articleUrl,
      sortOrder: sort++,
    });
  }

  return NextResponse.json({ ok: true });
}
