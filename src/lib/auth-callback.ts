import { getSafeDashboardAuthNextPath } from "./auth-redirects.ts";

export type AuthCodeExchangeResult = {
  error?: unknown;
};

export type AuthCallbackRedirect =
  | {
      status: "success";
      location: string;
    }
  | {
      status: "invalid_link";
      location: string;
    };

type ExchangeCodeForSession = (code: string) => Promise<AuthCodeExchangeResult>;

export async function resolveAuthCallbackRedirect(input: {
  requestUrl: URL;
  exchangeCodeForSession: ExchangeCodeForSession;
}): Promise<AuthCallbackRedirect> {
  const code = input.requestUrl.searchParams.get("code");

  if (!code) {
    return buildInvalidLinkRedirect(input.requestUrl);
  }

  const { error } = await input.exchangeCodeForSession(code);

  if (error) {
    return buildInvalidLinkRedirect(input.requestUrl);
  }

  const next = getSafeDashboardAuthNextPath(
    input.requestUrl.searchParams.get("next"),
  );

  return {
    status: "success",
    location: new URL(next, input.requestUrl.origin).toString(),
  };
}

function buildInvalidLinkRedirect(requestUrl: URL): AuthCallbackRedirect {
  const signInUrl = new URL("/sign-in", requestUrl.origin);

  signInUrl.searchParams.set("auth_error", "invalid_link");

  return {
    status: "invalid_link",
    location: signInUrl.toString(),
  };
}
