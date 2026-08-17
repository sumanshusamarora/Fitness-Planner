"use client";

import { useState } from "react";

interface ExerciseMediaEdit {
  id: number;
  name: string;
  imageUrl: string;
  youtubeUrl: string;
  articleUrl: string;
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
        {label}
      </span>
      <input
        type="url"
        inputMode="url"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
      />
    </label>
  );
}

export function MediaEditor({
  exercises,
}: {
  exercises: ExerciseMediaEdit[];
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState({
    imageUrl: "",
    youtubeUrl: "",
    articleUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function open(ex: ExerciseMediaEdit) {
    setOpenId(ex.id);
    setForm({
      imageUrl: ex.imageUrl,
      youtubeUrl: ex.youtubeUrl,
      articleUrl: ex.articleUrl,
    });
    setSaved(false);
  }

  async function save() {
    if (openId == null) return;
    setSaving(true);
    setSaved(false);
    await fetch(`/api/exercises/${openId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="space-y-2">
      {exercises.map((ex) => {
        const hasMedia = Boolean(ex.imageUrl || ex.youtubeUrl || ex.articleUrl);
        const badges = [
          ex.imageUrl ? "Image" : null,
          ex.youtubeUrl ? "Video" : null,
          ex.articleUrl ? "Link" : null,
        ].filter(Boolean);
        return (
          <div
            key={ex.id}
            className="rounded-2xl border border-zinc-800 bg-zinc-900"
          >
            <button
              type="button"
              onClick={() => (openId === ex.id ? setOpenId(null) : open(ex))}
              className="flex w-full items-center justify-between gap-3 p-4"
            >
              <span className="text-lg font-semibold">{ex.name}</span>
              <span className="text-xs text-zinc-500">
                {hasMedia ? badges.join(" · ") : "No media"}
              </span>
            </button>

            {openId === ex.id && (
              <div className="space-y-3 border-t border-zinc-800 p-4">
                <Field
                  label="Image URL"
                  value={form.imageUrl}
                  placeholder="https://…"
                  onChange={(v) => setForm((f) => ({ ...f, imageUrl: v }))}
                />
                <Field
                  label="YouTube URL"
                  value={form.youtubeUrl}
                  placeholder="https://youtube.com/watch?v=…"
                  onChange={(v) => setForm((f) => ({ ...f, youtubeUrl: v }))}
                />
                <Field
                  label="Article / reference URL"
                  value={form.articleUrl}
                  placeholder="https://…"
                  onChange={(v) => setForm((f) => ({ ...f, articleUrl: v }))}
                />
                {saved && (
                  <p className="text-sm font-semibold text-emerald-400">
                    Saved
                  </p>
                )}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="w-full rounded-2xl bg-emerald-500 py-3 text-base font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
