import { getEventPhase, type EventPhase } from "./event-phase.ts";
import { canAcceptPublicRequests } from "./public-request-eligibility.ts";

export type PublicEventStatus = EventPhase;

export type PublicEventContract = {
  id: number;
  slug: string;
  name: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  city: string | null;
  status: PublicEventStatus;
  publicStatus: PublicEventStatus;
  requestsEnabled: boolean;
  songRequestsEnabled: boolean;
  publicQueueEnabled: boolean;
  facebookUrl: string | null;
};

export type PublicEventContractInput = {
  id: number;
  name: string;
  slug: string | null;
  venue: string | null;
  city: string | null;
  startsAt: Date;
  autoCloseAt?: Date | null;
  endsAt: Date;
  closedAt: Date | null;
  status: string;
  visibility: string;
  publishedAt: Date | null;
  songRequestsEnabled: boolean;
  publicQueueEnabled: boolean;
  facebookUrl: string | null;
};

export function getPublicEventStatus(
  event: Pick<
    PublicEventContractInput,
    "status" | "startsAt" | "endsAt" | "closedAt"
  >,
  now = new Date(),
): PublicEventStatus {
  return getEventPhase(event, now);
}

export function toPublicEventContract(
  event: PublicEventContractInput,
  now = new Date(),
): PublicEventContract {
  if (!event.slug) {
    throw new Error("Public event contract is invalid.");
  }

  const publicStatus = getPublicEventStatus(event, now);

  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    venueName: event.venue,
    city: event.city,
    status: publicStatus,
    publicStatus,
    requestsEnabled: canAcceptPublicRequests(event, now),
    songRequestsEnabled: event.songRequestsEnabled,
    publicQueueEnabled: event.publicQueueEnabled,
    facebookUrl: event.facebookUrl,
  };
}
