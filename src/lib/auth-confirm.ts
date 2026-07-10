import {
  getAuthInviteCookieSecret,
  readAuthInviteCookieValue,
} from "./auth-invite-cookie.ts";

export type AuthInviteVerifyResult = {
  error?: unknown;
};

export type AuthConfirmRedirect =
  | {
      status: "success";
      location: string;
    }
  | {
      status: "invalid_link";
      location: string;
    };

type VerifyInviteOtp = (input: {
  token_hash: string;
  type: "invite";
}) => Promise<AuthInviteVerifyResult>;

export async function resolveAuthConfirmPostRedirect(input: {
  inviteCookieValue: string | undefined;
  requestUrl: URL;
  now?: Date;
  verifyInviteOtp: VerifyInviteOtp;
}): Promise<AuthConfirmRedirect> {
  const secret = getAuthInviteCookieSecret();

  if (!secret) {
    return buildInvalidInviteRedirect(input.requestUrl);
  }

  const inviteCookie = readAuthInviteCookieValue({
    value: input.inviteCookieValue,
    secret,
    now: input.now,
  });

  if (!inviteCookie.success) {
    return buildInvalidInviteRedirect(input.requestUrl);
  }

  const { error } = await input.verifyInviteOtp({
    token_hash: inviteCookie.tokenHash,
    type: "invite",
  });

  if (error) {
    return buildInvalidInviteRedirect(input.requestUrl);
  }

  return {
    status: "success",
    location: new URL("/setup", input.requestUrl.origin).toString(),
  };
}

function buildInvalidInviteRedirect(requestUrl: URL): AuthConfirmRedirect {
  const signInUrl = new URL("/sign-in", requestUrl.origin);

  signInUrl.searchParams.set("auth_error", "invalid_link");

  return {
    status: "invalid_link",
    location: signInUrl.toString(),
  };
}
