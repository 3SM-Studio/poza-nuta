export type PublicRequestEligibilityInput = {
  isActivePublicEvent: boolean;
  status: string;
  autoCloseAt: Date | null;
  closedAt: Date | null;
};

export function canAcceptPublicRequests(
  event: PublicRequestEligibilityInput,
  now = new Date(),
) {
  if (!event.isActivePublicEvent || event.status !== "active") {
    return false;
  }

  if (event.closedAt) {
    return false;
  }

  return !event.autoCloseAt || event.autoCloseAt.getTime() > now.getTime();
}
