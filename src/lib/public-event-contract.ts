import { canAcceptPublicRequests } from "./public-request-eligibility.ts";

export type PublicEventStatus = "upcoming" | "live" | "ended";

export type PublicEventContract = {
  slug: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  venueName: string | null;
  city: string | null;
  status: PublicEventStatus;
  publicStatus: PublicEventStatus;
  requestsEnabled: boolean;
  publicQueueEnabled: boolean;
  facebookUrl: string | null;
};

export type PublicEventContractInput = {
  name: string;
  slug: string | null;
  venue: string | null;
  city: string | null;
  startsAt: Date;
  autoCloseAt: Date | null;
  closedAt: Date | null;
  status: string;
  isActivePublicEvent: boolean;
  publicQueueEnabled: boolean;
  facebookUrl: string | null;
};

export function getPublicEventStatus(
  event: Pick<
    PublicEventContractInput,
    "status" | "startsAt" | "autoCloseAt" | "closedAt"
  >,
  now = new Date(),
): PublicEventStatus {
  if (event.status === "closed" || event.closedAt) {
    return "ended";
  }

  if (event.status === "active") {
    if (!event.autoCloseAt || now.getTime() < event.autoCloseAt.getTime()) {
      return "live";
    }

    return "ended";
  }

  if (now.getTime() < event.startsAt.getTime()) {
    return "upcoming";
  }

  return "ended";
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
    slug: event.slug,
    name: event.name,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.autoCloseAt?.toISOString() ?? null,
    venueName: event.venue,
    city: event.city,
    status: publicStatus,
    publicStatus,
    requestsEnabled: canAcceptPublicRequests(event, now),
    publicQueueEnabled: event.publicQueueEnabled,
    facebookUrl: event.facebookUrl,
  };
}
