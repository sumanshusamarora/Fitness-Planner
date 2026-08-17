"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { USERNAME_STORAGE_KEY } from "@/lib/username";

export function SwitchProfileButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function switchProfile() {
    setBusy(true);
    await fetch("/api/profile/switch", { method: "POST" });
    localStorage.removeItem(USERNAME_STORAGE_KEY);
    router.push("/profile");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={switchProfile}
      disabled={busy}
      className="w-full rounded-2xl bg-zinc-800 py-3 text-base font-semibold text-zinc-100 transition active:scale-[0.98] disabled:opacity-60"
    >
      SWITCH PROFILE
    </button>
  );
}
