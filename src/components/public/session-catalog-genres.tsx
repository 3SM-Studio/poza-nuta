"use client";

import Link from "next/link";
import { ArrowLeft, Disc3, Sparkles, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SongDiscoveryCategory } from "./api";

const CARD_GRADIENTS = [
  "from-fuchsia-600 via-violet-700 to-slate-950",
  "from-rose-500 via-orange-600 to-amber-950",
  "from-cyan-500 via-blue-700 to-indigo-950",
  "from-emerald-500 via-teal-700 to-slate-950",
  "from-violet-500 via-pink-600 to-slate-950",
  "from-amber-400 via-rose-600 to-purple-950",
] as const;

export function SessionCatalogGenres({
  genres,
  onBack,
  sessionToken,
}: {
  genres: SongDiscoveryCategory[];
  onBack: () => void;
  sessionToken: string;
}) {
  return (
    <section aria-labelledby="catalog-genres-heading" className="mb-7">
      <div className="mb-5 flex items-center gap-2">
        <Button aria-label="Wróć do odkrywania" className="size-11 rounded-full" onClick={onBack} size="icon" type="button" variant="ghost">
          <ArrowLeft />
        </Button>
        <h1 className="text-2xl font-extrabold tracking-[-0.04em]" id="catalog-genres-heading">Gatunki</h1>
      </div>
      {genres.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Brak gatunków w katalogu.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {genres.map((genre, index) => (
            <GenreCard genre={genre} index={index} key={genre.value} sessionToken={sessionToken} />
          ))}
        </div>
      )}
    </section>
  );
}

function GenreCard({ genre, index, sessionToken }: { genre: SongDiscoveryCategory; index: number; sessionToken: string }) {
  const Icon: LucideIcon = index % 2 === 0 ? Disc3 : Sparkles;
  const params = new URLSearchParams({ genre: genre.value });
  return (
    <Link
      aria-label={`${genre.label}, ${genre.count} piosenek`}
      className={`group relative flex aspect-square overflow-hidden rounded-xl bg-gradient-to-br ${CARD_GRADIENTS[index % CARD_GRADIENTS.length]} p-3 text-primary-foreground shadow-[0_12px_28px_oklch(0_0_0_/_28%)] transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60`}
      href={`/s/${encodeURIComponent(sessionToken)}/catalog?${params.toString()}`}
      prefetch={false}
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,oklch(1_0_0_/_28%),transparent_24%),linear-gradient(to_top,oklch(0_0_0_/_80%),oklch(0_0_0_/_14%)_68%)]" />
      <Icon aria-hidden="true" className="relative size-7 opacity-85" strokeWidth={1.7} />
      <span className="relative mt-auto min-w-0">
        <span className="block line-clamp-2 text-sm font-extrabold leading-tight tracking-[-0.02em]">{genre.label}</span>
        <span className="mt-1 block truncate text-xs font-medium text-white/90">{genre.count} piosenek</span>
      </span>
    </Link>
  );
}
