"use client";

import { ArrowLeft, ListMusic, Palette, Trophy } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CatalogCollectionSection } from "@/lib/catalog-collections";
import type { PublicCatalogCollection } from "./api";
import { getSessionCatalogCollections } from "./session-api";

const SECTION_CONTENT: Record<
  CatalogCollectionSection,
  { heading: string; empty: string; icon: typeof Trophy }
> = {
  top: {
    heading: "Top",
    empty: "Nie ma teraz aktywnych kolekcji Top.",
    icon: Trophy,
  },
  playlist: {
    heading: "Playlisty",
    empty: "Nie ma teraz aktywnych playlist.",
    icon: ListMusic,
  },
  style: {
    heading: "Style",
    empty: "Nie ma teraz aktywnych kolekcji stylów.",
    icon: Palette,
  },
};

type CollectionState =
  | { status: "loading"; items: PublicCatalogCollection[] }
  | { status: "ready"; items: PublicCatalogCollection[] }
  | { status: "error"; items: PublicCatalogCollection[] };

export function SessionCatalogCollections({
  onBack,
  section,
  sessionToken,
}: {
  onBack: () => void;
  section: CatalogCollectionSection;
  sessionToken: string;
}) {
  const [state, setState] = useState<CollectionState>({
    status: "loading",
    items: [],
  });
  const controllerRef = useRef<AbortController | null>(null);
  const content = SECTION_CONTENT[section];

  const loadCollections = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading", items: [] });
    void getSessionCatalogCollections(sessionToken, section, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", items: response.items });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setState({ status: "error", items: [] });
        }
      });
  }, [section, sessionToken]);

  useEffect(() => {
    const start = window.setTimeout(loadCollections, 0);
    return () => {
      window.clearTimeout(start);
      controllerRef.current?.abort();
    };
  }, [loadCollections]);

  return (
    <section aria-labelledby="catalog-collections-heading" className="mb-7">
      <div className="mb-4 flex items-center gap-2">
        <Button
          aria-label="Wróć do odkrywania"
          className="size-11 rounded-full"
          onClick={onBack}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <h1
          className="text-2xl font-extrabold tracking-[-0.04em]"
          id="catalog-collections-heading"
        >
          {content.heading}
        </h1>
      </div>

      {state.status === "loading" ? <CollectionSkeletons /> : null}
      {state.status === "error" ? (
        <div className="py-4" role="alert">
          <p className="text-sm text-destructive">
            Nie udało się wczytać kolekcji. Spróbuj ponownie.
          </p>
          <Button
            className="mt-3"
            onClick={loadCollections}
            size="sm"
            type="button"
            variant="outline"
          >
            Spróbuj ponownie
          </Button>
        </div>
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground" role="status">
          {content.empty}
        </p>
      ) : null}
      {state.items.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {state.items.map((collection, index) => {
            const Icon = content.icon;
            return (
              <li key={collection.filterKey}>
                <Link
                  aria-label={`Otwórz kolekcję ${collection.title}`}
                  className={`group relative flex min-h-36 overflow-hidden rounded-2xl bg-gradient-to-br ${getCardGradient(index)} p-5 text-primary-foreground shadow-[0_12px_28px_oklch(0_0_0_/_24%)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60`}
                  href={buildCollectionHref(sessionToken, collection.filterKey)}
                  prefetch={false}
                >
                  <span className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,oklch(1_0_0_/_24%),transparent_25%),linear-gradient(to_top,oklch(0_0_0_/_72%),transparent_74%)]" />
                  <Icon aria-hidden="true" className="relative size-7 opacity-90" />
                  <span className="relative mt-auto min-w-0 self-end">
                    <span className="block text-lg font-extrabold tracking-[-0.03em]">
                      {collection.title}
                    </span>
                    {collection.description ? (
                      <span className="mt-1 block line-clamp-2 text-sm text-white/85">
                        {collection.description}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export function buildCollectionHref(sessionToken: string, filterKey: string) {
  const searchParams = new URLSearchParams({ filter: filterKey });
  return `/s/${encodeURIComponent(sessionToken)}/playlist?${searchParams.toString()}`;
}

function CollectionSkeletons() {
  return (
    <div aria-label="Wczytywanie kolekcji" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton className="h-36 rounded-2xl" key={index} />
      ))}
    </div>
  );
}

function getCardGradient(index: number) {
  const gradients = [
    "from-fuchsia-600 via-violet-700 to-slate-950",
    "from-cyan-500 via-blue-700 to-indigo-950",
    "from-rose-500 via-orange-600 to-amber-950",
    "from-emerald-500 via-teal-700 to-slate-950",
  ];
  return gradients[index % gradients.length];
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
