import Link from "next/link";
import { SwitchProfileButton } from "@/components/SwitchProfileButton";
import { requireCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const user = await requireCurrentUser();
  const displayName = user.name || user.username || "You";

  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">More</h1>

      <div className="space-y-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Current profile
          </p>
          <p className="mt-1 text-xl font-bold">{displayName}</p>
          {user.username && <p className="text-sm text-zinc-500">@{user.username}</p>}
          <div className="mt-4">
            <SwitchProfileButton />
          </div>
        </div>

        <a href="/api/export" className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-lg font-semibold">Export Data</p>
          <p className="mt-1 text-sm text-zinc-400">Download a JSON backup of your data.</p>
        </a>

        <Link href="/tools/training-profile" className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-lg font-semibold">Training profile</p>
          <p className="mt-1 text-sm text-zinc-400">Goal, experience, availability, and limitations.</p>
        </Link>

        <Link href="/tools/media" className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-lg font-semibold">Exercise references</p>
          <p className="mt-1 text-sm text-zinc-400">Edit exercise photos, videos, and links.</p>
        </Link>

        <Link href="/tools/catalogue" className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-lg font-semibold">Exercise catalogue</p>
          <p className="mt-1 text-sm text-zinc-400">Match exercises to the external reference catalogue.</p>
        </Link>
      </div>
    </div>
  );
}
