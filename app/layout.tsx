import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Lift Log",
  description: "A personal, local-first fitness tracker",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <div className="mx-auto flex min-h-screen max-w-md flex-col sm:max-w-lg lg:max-w-xl">
          <main className="flex-1 px-4 pb-28 pt-6">{children}</main>
          <Nav />
        </div>
      </body>
    </html>
  );
}
