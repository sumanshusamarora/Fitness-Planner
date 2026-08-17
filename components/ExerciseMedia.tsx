"use client";

import { useState } from "react";
import { youtubeEmbedUrl, youtubeThumbnailUrl } from "@/lib/media";

export interface ExerciseMediaData {
  primaryImageUrl: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  youtubeTitle: string | null;
  articleUrl: string | null;
  articleTitle: string | null;
}

export function ExerciseMedia({ media }: { media: ExerciseMediaData | null }) {
  const [viewer, setViewer] = useState<"image" | "video" | null>(null);

  if (!media) return null;

  const imageUrl =
    media.primaryImageUrl ??
    (media.youtubeVideoId ? youtubeThumbnailUrl(media.youtubeVideoId) : null);

  const hasAny = Boolean(
    imageUrl || media.youtubeVideoId || media.articleUrl,
  );
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      {imageUrl && (
        <button
          type="button"
          onClick={() => setViewer("image")}
          className="block w-full overflow-hidden rounded-2xl border border-zinc-800"
          aria-label="View exercise image larger"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Exercise reference"
            className="h-44 w-full object-cover"
            loading="lazy"
          />
        </button>
      )}

      {media.youtubeVideoId && (
        <button
          type="button"
          onClick={() => setViewer("video")}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-800 py-3 text-base font-semibold text-zinc-100 transition active:scale-[0.98]"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M8 5v14l11-7z" />
          </svg>
          Watch technique
        </button>
      )}

      {media.articleUrl && (
        <a
          href={media.articleUrl}
          target="_blank"
          rel="noreferrer"
          className="block w-full rounded-2xl bg-zinc-800 py-3 text-center text-base font-semibold text-zinc-100"
        >
          More info
        </a>
      )}

      {viewer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setViewer(null)}
        >
          <div
            className="w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {viewer === "image" && imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Exercise reference" className="w-full rounded-2xl" />
            )}
            {viewer === "video" && media.youtubeVideoId && (
              <div className="space-y-3">
                <div className="aspect-video w-full overflow-hidden rounded-2xl">
                  <iframe
                    src={youtubeEmbedUrl(media.youtubeVideoId)}
                    title={media.youtubeTitle ?? "Technique video"}
                    className="h-full w-full"
                    allowFullScreen
                    allow="autoplay; encrypted-media; picture-in-picture"
                  />
                </div>
                <a
                  href={media.youtubeUrl ?? youtubeEmbedUrl(media.youtubeVideoId)}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl bg-zinc-800 py-3 text-center font-semibold text-zinc-100"
                >
                  Open in YouTube
                </a>
              </div>
            )}
            <button
              type="button"
              onClick={() => setViewer(null)}
              className="mt-4 w-full rounded-2xl bg-zinc-800 py-3 font-semibold text-zinc-100"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
