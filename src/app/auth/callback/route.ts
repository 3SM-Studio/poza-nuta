import { NextResponse, type NextRequest } from "next/server";

import { getSafeDashboardAuthNextPath } from "../../../lib/auth-redirects";
import { createClient as createSupabaseServerClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = getSafeDashboardAuthNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    return redirectToSignIn(requestUrl, "invalid_link");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectToSignIn(requestUrl, "invalid_link");
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}

function redirectToSignIn(requestUrl: URL, reason: "invalid_link") {
  const signInUrl = new URL("/sign-in", requestUrl.origin);

  signInUrl.searchParams.set("auth_error", reason);

  return NextResponse.redirect(signInUrl);
}
