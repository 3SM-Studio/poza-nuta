"use client";

import Link from "next/link";
import { Disc3, Heart, MicVocal, Music2, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Skeleton } from "@/components/ui/skeleton";
import type { PublicSong, SessionSongDiscovery, SongDiscoveryCategory } from "./api";
import { browseSessionSongs } from "./session-api";

type SongSectionKey = "hits" | "newest" | "duets";
type SongSectionState = {
  items: PublicSong[];
  status: "loading" | "ready" | "error";
};

type EnabledSongSection = {
  key: SongSectionKey;
  title: string;
  input: { hit?: true; duet?: true; sort?: "newest"; limit: number };
};

type SessionDiscoveryHomeProps = {
  sessionToken: string;
  discovery: SessionSongDiscovery;
  onSongSelect: (song: PublicSong) => void;
  onGenreSelect?: (genre: SongDiscoveryCategory) => void;
  initialSongSections?: Partial<Record<SongSectionKey, PublicSong[]>>;
  forceLoading?: boolean;
  forceMinimal?: boolean;
};

const SONG_SECTION_LIMIT = 8;
const CARD_GRADIENTS = [
  "from-fuchsia-600 via-violet-700 to-slate-950",
  "from-rose-500 via-orange-600 to-amber-950",
  "from-cyan-500 via-blue-700 to-indigo-950",
  "from-emerald-500 via-teal-700 to-slate-950",
  "from-violet-500 via-pink-600 to-slate-950",
  "from-amber-400 via-rose-600 to-purple-950",
] as const;

export function SessionDiscoveryHome({
  sessionToken,
  discovery,
  onSongSelect,
  onGenreSelect,
  initialSongSections,
  forceLoading = false,
  forceMinimal = false,
}: SessionDiscoveryHomeProps) {
  const enabledSections = useMemo(
    () => getEnabledSongSections(discovery),
    [discovery],
  );
  const [songSections, setSongSections] = useState<
    Partial<Record<SongSectionKey, SongSectionState>>
  >(() =>
    Object.fromEntries(
      enabledSections.map((section) => [
        section.key,
        {
          items: initialSongSections?.[section.key] ?? [],
          status: initialSongSections?.[section.key] ? "ready" : "loading",
        },
      ]),
    ),
  );

  useEffect(() => {
    if (forceLoading || initialSongSections) return;
    const controllers = enabledSections.map(() => new AbortController());

    for (const [index, section] of enabledSections.entries()) {
      const controller = controllers[index];
      if (!controller) continue;
      void browseSessionSongs(sessionToken, section.input, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return;
          setSongSections((current) => ({
            ...current,
            [section.key]: { items: response.items, status: "ready" },
          }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSongSections((current) => ({
            ...current,
            [section.key]: { items: [], status: "error" },
          }));
        });
    }

    return () => controllers.forEach((controller) => controller.abort());
  }, [enabledSections, forceLoading, initialSongSections, sessionToken]);

  const hasGenres = discovery.genres.length > 0;
  const hasSongSection = enabledSections.length > 0;

  if (forceMinimal || (!hasGenres && !hasSongSection)) {
    return <DiscoveryMinimalState sessionToken={sessionToken} />;
  }

  return (
    <div className="space-y-8 pb-2 sm:space-y-10">
      <h1 className="sr-only">Odkrywaj muzykę</h1>
      {hasGenres ? (
        <DiscoverySection
          title="Gatunki"
          moreHref={buildBrowseHref(sessionToken)}
          moreLabel="Zobacz wszystkie gatunki"
        >
          <GenreCarousel
            genres={discovery.genres}
            onGenreSelect={onGenreSelect}
            sessionToken={sessionToken}
          />
        </DiscoverySection>
      ) : null}

      {enabledSections.map((section) => {
        const state = songSections[section.key];
        return (
          <DiscoverySection
            key={section.key}
            title={section.title}
            moreHref={buildBrowseHref(sessionToken, section.input)}
            moreLabel={`Zobacz więcej: ${section.title}`}
          >
            {forceLoading || state?.status === "loading" || !state ? (
              <SongCarouselSkeleton title={section.title} />
            ) : state.status === "error" ? (
              <p className="px-0.5 text-sm text-muted-foreground" role="status">
                Ta sekcja jest chwilowo niedostępna.
              </p>
            ) : state.items.length > 0 ? (
              <SongCarousel
                items={state.items}
                onSongSelect={onSongSelect}
                title={section.title}
              />
            ) : null}
          </DiscoverySection>
        );
      })}
    </div>
  );
}

function DiscoverySection({
  title,
  moreHref,
  moreLabel,
  children,
}: {
  title: string;
  moreHref?: string;
  moreLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`discovery-${slugify(title)}`}>
      <div className="mb-3 flex items-baseline justify-between gap-4 px-0.5">
        <h2
          className="text-xl font-extrabold tracking-[-0.035em]"
          id={`discovery-${slugify(title)}`}
        >
          {title}
        </h2>
        {moreHref && moreLabel ? (
          <Link
            aria-label={moreLabel}
            className="shrink-0 text-sm font-bold text-primary transition-colors hover:text-primary-hover focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={moreHref}
          >
            Więcej
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function GenreCarousel({
  genres,
  sessionToken,
  onGenreSelect,
}: {
  genres: SongDiscoveryCategory[];
  sessionToken: string;
  onGenreSelect?: (genre: SongDiscoveryCategory) => void;
}) {
  return (
    <Carousel aria-label="Karuzela gatunków" opts={{ dragFree: true }}>
      <CarouselContent>
        {genres.slice(0, 12).map((genre, index) => (
          <CarouselItem
            className="basis-[42%] sm:basis-[30%] md:basis-1/4 xl:basis-1/5"
            key={genre.value}
          >
            <DiscoveryCard
              href={
                onGenreSelect
                  ? undefined
                  : buildBrowseHref(sessionToken, { genre: genre.value })
              }
              icon={index % 2 === 0 ? Disc3 : Sparkles}
              index={index}
              onClick={
                onGenreSelect ? () => onGenreSelect(genre) : undefined
              }
              subtitle={`${genre.count} piosenek`}
              title={genre.label}
            />
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="hidden md:inline-flex" />
      <CarouselNext className="hidden md:inline-flex" />
    </Carousel>
  );
}

function SongCarousel({
  items,
  onSongSelect,
  title,
}: {
  items: PublicSong[];
  onSongSelect: (song: PublicSong) => void;
  title: string;
}) {
  return (
    <Carousel aria-label={`Karuzela: ${title}`} opts={{ dragFree: true }}>
      <CarouselContent>
        {items.map((song, index) => (
          <CarouselItem
            className="basis-[42%] sm:basis-[30%] md:basis-1/4 xl:basis-1/5"
            key={song.id}
          >
            <DiscoveryCard
              icon={song.isDuet ? MicVocal : Music2}
              index={index + song.id}
              onClick={() => onSongSelect(song)}
              subtitle={song.artist}
              title={song.title}
            />
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="hidden md:inline-flex" />
      <CarouselNext className="hidden md:inline-flex" />
    </Carousel>
  );
}

function DiscoveryCard({
  title,
  subtitle,
  index,
  icon: Icon,
  href,
  onClick,
}: {
  title: string;
  subtitle: string;
  index: number;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
}) {
  const className = `group relative flex aspect-square w-full overflow-hidden rounded-xl bg-gradient-to-br ${CARD_GRADIENTS[index % CARD_GRADIENTS.length]} p-3 text-left text-primary-foreground shadow-[0_12px_28px_oklch(0_0_0_/_28%)] transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60`;
  const content = (
    <>
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,oklch(1_0_0_/_28%),transparent_24%),linear-gradient(to_top,oklch(0_0_0_/_80%),oklch(0_0_0_/_14%)_68%)]" />
      <Icon aria-hidden="true" className="relative size-7 opacity-85" strokeWidth={1.7} />
      <span className="relative mt-auto min-w-0">
        <span className="block line-clamp-2 text-sm font-extrabold leading-tight tracking-[-0.02em]">
          {title}
        </span>
        <span className="mt-1 block truncate text-xs font-medium text-white/90">
          {subtitle}
        </span>
      </span>
    </>
  );

  if (href) {
    return (
      <Link aria-label={`${title}, ${subtitle}`} className={className} href={href}>
        {content}
      </Link>
    );
  }

  return (
    <button aria-label={`${title} — ${subtitle}`} className={className} onClick={onClick} type="button">
      {content}
    </button>
  );
}

function SongCarouselSkeleton({ title }: { title: string }) {
  return (
    <div aria-label={`Wczytywanie sekcji ${title}`} className="flex gap-3 overflow-hidden">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton
          className="aspect-square w-[42%] shrink-0 rounded-xl sm:w-[30%] md:w-1/4 xl:w-1/5"
          key={index}
        />
      ))}
    </div>
  );
}

function DiscoveryMinimalState({ sessionToken }: { sessionToken: string }) {
  return (
    <section className="rounded-xl bg-secondary px-4 py-5" aria-labelledby="discovery-minimal-title">
      <Heart aria-hidden="true" className="mb-3 size-6 text-primary" />
      <h2 className="text-xl font-extrabold tracking-[-0.035em]" id="discovery-minimal-title">
        Odkrywaj katalog
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Wybierz utwór, który chcesz zaśpiewać.
      </p>
      <Link
        className="mt-4 inline-flex text-sm font-bold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href={buildBrowseHref(sessionToken)}
      >
        Przeglądaj piosenki
      </Link>
    </section>
  );
}

function getEnabledSongSections(discovery: SessionSongDiscovery) {
  const sections: EnabledSongSection[] = [
    {
      key: "newest",
      title: "Najnowsze",
      input: { sort: "newest", limit: SONG_SECTION_LIMIT },
    },
  ];

  if (discovery.features.hitCount > 0) {
    sections.unshift({
      key: "hits",
      title: "Hity",
      input: { hit: true, limit: SONG_SECTION_LIMIT },
    });
  }
  if (discovery.features.duetCount > 0) {
    sections.push({
      key: "duets",
      title: "Duety",
      input: { duet: true, limit: SONG_SECTION_LIMIT },
    });
  }

  return sections;
}

function buildBrowseHref(
  sessionToken: string,
  input: { genre?: string; hit?: boolean; duet?: boolean; sort?: "newest"; limit?: number } = {},
) {
  const searchParams = new URLSearchParams();
  if (input.genre) searchParams.set("genre", input.genre);
  if (input.hit) searchParams.set("hit", "true");
  if (input.duet) searchParams.set("duet", "true");
  if (input.sort) searchParams.set("sort", input.sort);
  const query = searchParams.toString();
  return `/s/${encodeURIComponent(sessionToken)}/songs${query ? `?${query}` : ""}`;
}

function slugify(value: string) {
  return value.toLocaleLowerCase("pl-PL").replace(/[^a-z0-9]+/g, "-");
}
