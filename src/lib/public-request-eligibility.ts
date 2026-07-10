import { getEventPhase } from "./event-phase.ts";

export type PublicRequestEligibilityInput = {
  status: string;
  visibility: string;
  publishedAt: Date | null;
  startsAt: Date;
  endsAt: Date;
  closedAt: Date | null;
  songRequestsEnabled: boolean;
};

export function canAcceptPublicRequests(
  event: PublicRequestEligibilityInput,
  now = new Date(),
) {
  if (event.visibility !== "public" || !event.publishedAt) {
    return false;
  }

  if (!event.songRequestsEnabled) {
    return false;
  }

  return getEventPhase(event, now) === "live";
}
