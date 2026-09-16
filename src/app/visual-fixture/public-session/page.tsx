import { notFound } from "next/navigation";

import {
  PublicSessionVisualFixture,
  type PublicSessionVisualFixtureState,
} from "@/components/public/public-session-visual-fixture";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const fixtureStates = new Set<PublicSessionVisualFixtureState>([
  "pre-join",
  "main",
  "discovery",
  "discovery-loading",
  "discovery-network",
  "discovery-minimal",
  "category-genre-results",
  "profile",
  "queue",
  "queue-current",
  "queue-mobile-collapsed",
  "queue-mobile-expanded",
  "queue-mobile-long",
  "queue-mobile-empty",
  "queue-desktop",
  "queue-desktop-long",
  "queue-desktop-empty",
  "search-results",
  "search-loading",
  "search-empty",
  "song-details",
  "song-details-submitting",
  "song-details-error",
  "artwork-gallery",
  "song-details-loading",
  "search-no-results",
]);

export default async function PublicSessionVisualFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  // Production requires an explicit local visual-capture opt-in.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.POZA_NUTA_VISUAL_FIXTURE !== "1"
  ) {
    notFound();
  }

  const { screen } = await searchParams;
  const state = fixtureStates.has(screen as PublicSessionVisualFixtureState)
    ? (screen as PublicSessionVisualFixtureState)
    : "main";

  return <PublicSessionVisualFixture state={state} />;
}
