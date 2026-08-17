import Link from "next/link";

export const dynamic = "force-dynamic";

export default function ToolsPage() {
  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold">Tools</h1>
      <div className="space-y-3">
        <a
          href="/api/export"
          className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
        >
          <p className="text-lg font-semibold">Export Data</p>
          <p className="mt-1 text-sm text-zinc-400">
            Download a JSON backup of everything.
          </p>
        </a>
        <Link
          href="/tools/media"
          className="block rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
        >
          <p className="text-lg font-semibold">Exercise references</p>
          <p className="mt-1 text-sm text-zinc-400">
            Edit exercise photos, videos, and links.
          </p>
        </Link>
      </div>
    </div>
  );
}
