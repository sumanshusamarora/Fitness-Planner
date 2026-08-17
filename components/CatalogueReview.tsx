"use client";

import { useState } from "react";

interface ExerciseSummary {
  exercise: {
    id: number;
    name: string;
    primaryMuscle: string;
    equipment: string;
    category: string;
  };
  approvedMapping: {
    externalExerciseId: number;
    externalName: string;
    confidence: number | null;
    sourceUrl: string | null;
  } | null;
  suggestedMapping: {
    externalExerciseId: number;
    externalName: string;
    confidence: number | null;
  } | null;
  candidates: Candidate[];
}

interface Candidate {
  externalExerciseId: number;
  externalId: string;
  provider: string;
  name: string;
  confidence: number;
  reasons: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  difficulty: string | null;
  exerciseType: string | null;
  sourceUrl: string | null;
}

interface SearchResult {
  id: number;
  provider: string;
  externalId: string;
  name: string;
  sourceUrl: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  difficulty: string | null;
  exerciseType: string | null;
}

interface InitialData {
  total: number;
  mapped: number;
  suggested: number;
  items: ExerciseSummary[];
}

function StatusChip({ item }: { item: ExerciseSummary }) {
  if (item.approvedMapping) {
    return (
      <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
        Mapped
      </span>
    );
  }
  if (item.suggestedMapping) {
    return (
      <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400">
        Suggested
      </span>
    );
  }
  return (
    <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-400">
      Unmapped
    </span>
  );
}

function Reasons({ candidate }: { candidate: Candidate }) {
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {candidate.reasons.map((reason) => (
        <li key={reason} className="text-zinc-400">
          {reason}
        </li>
      ))}
    </ul>
  );
}

function MetaLine({ candidate }: { candidate: Candidate | SearchResult }) {
  const parts = [
    candidate.primaryMuscles.join(", "),
    candidate.equipment.join(", "),
    candidate.difficulty,
  ].filter(Boolean);
  return <p className="text-sm text-zinc-500">{parts.join(" · ")}</p>;
}

export function CatalogueReview({ initial }: { initial: InitialData }) {
  const [items, setItems] = useState(initial.items);
  const [openId, setOpenId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Record<number, Candidate[]>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [searchFor, setSearchFor] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mappedCount = items.filter((i) => i.approvedMapping).length;
  const suggestedCount = items.filter((i) => !i.approvedMapping && i.suggestedMapping).length;

  async function loadCandidates(exerciseId: number) {
    if (candidates[exerciseId]) return;
    setLoading(exerciseId);
    try {
      const res = await fetch(`/api/exercises/${exerciseId}/external-mapping`);
      const data = (await res.json()) as { candidates?: Candidate[] };
      if (data.candidates) {
        setCandidates((prev) => ({ ...prev, [exerciseId]: data.candidates! }));
      }
    } finally {
      setLoading(null);
    }
  }

  async function toggle(exerciseId: number) {
    if (openId === exerciseId) {
      setOpenId(null);
      setSearchFor(null);
      return;
    }
    setOpenId(exerciseId);
    setSearchFor(null);
    setError(null);
    await loadCandidates(exerciseId);
  }

  async function runSearch(exerciseId: number) {
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm.trim()) params.set("q", searchTerm.trim());
      params.set("limit", "10");
      const res = await fetch(`/api/external-exercises/search?${params}`);
      const data = (await res.json()) as { results?: SearchResult[] };
      setSearchResults(data.results ?? []);
    } finally {
      setSearching(false);
    }
  }

  async function mutate(
    exerciseId: number,
    action: "approve" | "reject",
    externalExerciseId: number,
    externalName: string,
  ) {
    setError(null);
    const res = await fetch(`/api/exercises/${exerciseId}/external-mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, externalExerciseId }),
    });
    if (!res.ok) {
      setError("Could not save. Try again.");
      return;
    }
    setItems((prev) =>
      prev.map((item) => {
        if (item.exercise.id !== exerciseId) return item;
        return {
          ...item,
          approvedMapping:
            action === "approve"
              ? { externalExerciseId, externalName, confidence: null, sourceUrl: null }
              : null,
          suggestedMapping:
            action === "reject" ? null : item.suggestedMapping,
        };
      }),
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Exercise matches
        </p>
        <p className="mt-1 text-2xl font-bold">
          {mappedCount} / {initial.total} mapped
        </p>
        {suggestedCount > 0 && (
          <p className="text-sm text-zinc-400">{suggestedCount} awaiting approval</p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="space-y-2">
        {items.map((item) => {
          const open = openId === item.exercise.id;
          const list = candidates[item.exercise.id] ?? [];
          const top = list[0];
          const others = list.slice(1);
          const suggestedCandidate =
            top && item.suggestedMapping ? top : null;

          return (
            <div key={item.exercise.id} className="rounded-2xl border border-zinc-800 bg-zinc-900">
              <button
                type="button"
                onClick={() => toggle(item.exercise.id)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{item.exercise.name}</p>
                  <p className="text-sm text-zinc-500">
                    {item.exercise.primaryMuscle} · {item.exercise.equipment}
                  </p>
                </div>
                <StatusChip item={item} />
              </button>

              {open && (
                <div className="space-y-4 border-t border-zinc-800 p-4">
                  {item.approvedMapping && (
                    <div className="rounded-2xl bg-emerald-500/10 p-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                        Approved match
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {item.approvedMapping.externalName}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          mutate(
                            item.exercise.id,
                            "reject",
                            item.approvedMapping!.externalExerciseId,
                            item.approvedMapping!.externalName,
                          )
                        }
                        className="mt-3 rounded-xl border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-300"
                      >
                        Remove approval
                      </button>
                    </div>
                  )}

                  {loading === item.exercise.id && (
                    <p className="text-sm text-zinc-500">Loading matches…</p>
                  )}

                  {!item.approvedMapping && suggestedCandidate && (
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                        Suggested match
                      </p>
                      <p className="mt-1 text-lg font-semibold">{suggestedCandidate.name}</p>
                      <MetaLine candidate={suggestedCandidate} />
                      <p className="mt-1 text-sm font-semibold text-amber-400">
                        Confidence: {suggestedCandidate.confidence}%
                      </p>
                      <Reasons candidate={suggestedCandidate} />
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            mutate(
                              item.exercise.id,
                              "approve",
                              suggestedCandidate.externalExerciseId,
                              suggestedCandidate.name,
                            )
                          }
                          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-zinc-950"
                        >
                          Use this
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            mutate(
                              item.exercise.id,
                              "reject",
                              suggestedCandidate.externalExerciseId,
                              suggestedCandidate.name,
                            )
                          }
                          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {!item.approvedMapping && !suggestedCandidate && list.length > 0 && (
                    <div className="rounded-2xl border border-zinc-800 p-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                        Best match
                      </p>
                      <p className="mt-1 text-lg font-semibold">{list[0].name}</p>
                      <MetaLine candidate={list[0]} />
                      <p className="mt-1 text-sm font-semibold text-amber-400">
                        Confidence: {list[0].confidence}%
                      </p>
                      <Reasons candidate={list[0]} />
                      <button
                        type="button"
                        onClick={() =>
                          mutate(
                            item.exercise.id,
                            "approve",
                            list[0].externalExerciseId,
                            list[0].name,
                          )
                        }
                        className="mt-3 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-zinc-950"
                      >
                        Use this
                      </button>
                    </div>
                  )}

                  {others.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                        Other matches
                      </p>
                      <div className="space-y-2">
                        {others.map((c) => (
                          <div
                            key={c.externalExerciseId}
                            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 p-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{c.name}</p>
                              <p className="text-xs text-zinc-500">
                                {c.confidence}% · {c.primaryMuscles.join(", ")}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                mutate(
                                  item.exercise.id,
                                  "approve",
                                  c.externalExerciseId,
                                  c.name,
                                )
                              }
                              className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300"
                            >
                              Use this
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        setSearchFor(searchFor === item.exercise.id ? null : item.exercise.id)
                      }
                      className="text-sm font-semibold text-emerald-400"
                    >
                      {searchFor === item.exercise.id ? "Close search" : "Search catalogue"}
                    </button>

                    {searchFor === item.exercise.id && (
                      <div className="mt-3 space-y-3">
                        <div className="flex gap-2">
                          <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") runSearch(item.exercise.id);
                            }}
                            placeholder="e.g. lat pulldown"
                            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-600"
                          />
                          <button
                            type="button"
                            onClick={() => runSearch(item.exercise.id)}
                            disabled={searching}
                            className="shrink-0 rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100"
                          >
                            {searching ? "…" : "Search"}
                          </button>
                        </div>
                        <div className="space-y-2">
                          {searchResults.map((r) => (
                            <div
                              key={r.id}
                              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 p-3"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-semibold">{r.name}</p>
                                <MetaLine candidate={r} />
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  mutate(item.exercise.id, "approve", r.id, r.name)
                                }
                                className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-zinc-950"
                              >
                                Use this
                              </button>
                            </div>
                          ))}
                          {searchResults.length === 0 && !searching && searchTerm && (
                            <p className="text-sm text-zinc-500">No results.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
