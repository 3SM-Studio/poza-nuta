export type SessionCapabilitiesInput = {
  songRequestsEnabled: boolean;
  publicQueueEnabled: boolean;
};

export type SessionCapabilityState = {
  canSearchSongs: boolean;
  canSubmitSongRequests: boolean;
  canViewPublicQueue: boolean;
  allSessionFeaturesDisabled: boolean;
};

export function getSessionCapabilityState(
  capabilities: SessionCapabilitiesInput,
): SessionCapabilityState {
  const canSubmitSongRequests = capabilities.songRequestsEnabled;
  const canViewPublicQueue = capabilities.publicQueueEnabled;

  return {
    canSearchSongs: canSubmitSongRequests,
    canSubmitSongRequests,
    canViewPublicQueue,
    allSessionFeaturesDisabled:
      !canSubmitSongRequests && !canViewPublicQueue,
  };
}

export function canUseSessionSongRequests(
  capabilities: SessionCapabilitiesInput,
) {
  return getSessionCapabilityState(capabilities).canSubmitSongRequests;
}

export function canUseSessionPublicQueue(
  capabilities: SessionCapabilitiesInput,
) {
  return getSessionCapabilityState(capabilities).canViewPublicQueue;
}
