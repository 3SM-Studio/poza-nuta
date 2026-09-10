import { NextResponse, type NextRequest } from "next/server";

import { resolveAuthConfirmPostRedirect } from "../../../lib/auth-confirm";
import {
  AUTH_INVITE_COOKIE_NAME,
  AUTH_INVITE_COOKIE_PATH,
} from "../../../lib/auth-invite-cookie";
import { createClient as createSupabaseServerClient } from "../../../lib/supabase/server";
import { requireSameOriginRequest } from "../../../server/setup/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestUrl = new URL(request.url);

  try {
    requireSameOriginRequest(request);
  } catch {
    return redirectAndClearInviteCookie(
      new URL("/sign-in?auth_error=invalid_link", requestUrl.origin).toString(),
    );
  }

  const redirect = await resolveAuthConfirmPostRedirect({
    inviteCookieValue: request.cookies.get(AUTH_INVITE_COOKIE_NAME)?.value,
    requestUrl,
    verifyInviteOtp: async (input) => {
      const supabase = await createSupabaseServerClient();

      return supabase.auth.verifyOtp(input);
    },
  });

  return redirectAndClearInviteCookie(redirect.location);
}

function redirectAndClearInviteCookie(location: string) {
  const response = NextResponse.redirect(location, { status: 303 });

  response.cookies.set(AUTH_INVITE_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: AUTH_INVITE_COOKIE_PATH,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
