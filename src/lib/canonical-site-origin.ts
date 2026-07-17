const SAFE_CONFIGURATION_MESSAGE =
  "Canonical site URL is not configured correctly.";

export class CanonicalSiteOriginConfigurationError extends Error {
  constructor() {
    super(SAFE_CONFIGURATION_MESSAGE);
    this.name = "CanonicalSiteOriginConfigurationError";
  }
}

export function parseCanonicalSiteOrigin(value: string | undefined) {
  const configuredValue = value?.trim();

  if (!configuredValue) {
    throw new CanonicalSiteOriginConfigurationError();
  }

  try {
    const url = new URL(configuredValue);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== "/"
    ) {
      throw new CanonicalSiteOriginConfigurationError();
    }

    return url.origin;
  } catch (error) {
    if (error instanceof CanonicalSiteOriginConfigurationError) {
      throw error;
    }

    throw new CanonicalSiteOriginConfigurationError();
  }
}
