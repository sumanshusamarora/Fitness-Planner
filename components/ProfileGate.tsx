"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { USERNAME_STORAGE_KEY } from "@/lib/username";

type Phase = "loading" | "username" | "not_found";

export function ProfileGate() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [username, setUsername] = useState("");
  const [notFoundName, setNotFoundName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(USERNAME_STORAGE_KEY);
    if (saved) {
      resolve(saved, false);
    } else {
      setPhase("username");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resolve(name: string, remember: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/profile/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name }),
    });
    const data = await res.json();
    if (data.status === "found") {
      if (remember) localStorage.setItem(USERNAME_STORAGE_KEY, name.trim());
      router.refresh();
      return;
    }
    localStorage.removeItem(USERNAME_STORAGE_KEY);
    setNotFoundName(name.trim());
    setPhase("not_found");
    setBusy(false);
  }

  async function create(name: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/profile/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name }),
    });
    const data = await res.json();
    if (data.user) {
      localStorage.setItem(USERNAME_STORAGE_KEY, name.trim());
      router.refresh();
      return;
    }
    setError(data.error ?? "Could not create profile.");
    setBusy(false);
  }

  if (phase === "loading") {
    return <p className="py-16 text-center text-zinc-500">Loading…</p>;
  }

  return (
    <div className="flex flex-col justify-center py-10">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          Lift Log
        </p>
        <h1 className="mt-3 text-4xl font-bold">Who&apos;s training?</h1>
      </div>

      {phase === "username" && (
        <div className="mt-8 space-y-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (username.trim()) resolve(username, true);
            }}
          >
            <input
              autoFocus
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="What's your username?"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4 text-lg text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !username.trim()}
              className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
            >
              CONTINUE
            </button>
          </form>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}

      {phase === "not_found" && (
        <div className="mt-8 space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-center">
            <p className="text-lg text-zinc-200">
              No profile called <span className="font-bold">{notFoundName}</span> exists.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => create(notFoundName)}
            className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-zinc-950 transition active:scale-[0.98] disabled:opacity-60"
          >
            CREATE PROFILE
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setUsername("");
              setPhase("username");
            }}
            className="w-full rounded-2xl py-3 text-base font-semibold text-zinc-400"
          >
            GO BACK
          </button>
        </div>
      )}
    </div>
  );
}
