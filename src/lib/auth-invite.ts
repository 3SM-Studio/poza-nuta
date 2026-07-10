import {
  createAuthInviteCookieValue,
  getAuthInviteCookieSecret,
} from "./auth-invite-cookie.ts";

export type AuthInviteStartResult =
  | {
      status: "success";
      location: string;
      cookieValue: string;
    }
  | {
      status: "invalid_link";
      location: string;
    };

export function resolveAuthInviteStart(input: {
  requestUrl: URL;
  now?: Date;
}): AuthInviteStartResult {
  const tokenHash = input.requestUrl.searchParams.get("token_hash");
  const type = input.requestUrl.searchParams.get("type");
  const secret = getAuthInviteCookieSecret();

  if (!tokenHash || type !== "invite" || !secret) {
    return buildInvalidInviteRedirect(input.requestUrl);
  }

  return {
    status: "success",
    location: new URL("/auth/invite/accept", input.requestUrl.origin).toString(),
    cookieValue: createAuthInviteCookieValue({
      tokenHash,
      secret,
      now: input.now,
    }),
  };
}

function buildInvalidInviteRedirect(requestUrl: URL): AuthInviteStartResult {
  const signInUrl = new URL("/sign-in", requestUrl.origin);

  signInUrl.searchParams.set("auth_error", "invalid_link");

  return {
    status: "invalid_link",
    location: signInUrl.toString(),
  };
}
