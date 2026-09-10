import { NextResponse, type NextRequest } from "next/server";

import { resolveAuthInviteStart } from "../../../lib/auth-invite";
import {
  AUTH_INVITE_COOKIE_MAX_AGE_SECONDS,
  AUTH_INVITE_COOKIE_NAME,
  AUTH_INVITE_COOKIE_PATH,
} from "../../../lib/auth-invite-cookie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const invite = resolveAuthInviteStart({ requestUrl });
  const response = NextResponse.redirect(invite.location);

  if (invite.status === "success") {
    response.cookies.set(AUTH_INVITE_COOKIE_NAME, invite.cookieValue, {
      httpOnly: true,
      maxAge: AUTH_INVITE_COOKIE_MAX_AGE_SECONDS,
      path: AUTH_INVITE_COOKIE_PATH,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  return response;
}
