import { NextResponse, type NextRequest } from "next/server";

import { resolveAuthCallbackRedirect } from "../../../lib/auth-callback";
import { createClient as createSupabaseServerClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);

  if (!requestUrl.searchParams.get("code")) {
    const redirect = await resolveAuthCallbackRedirect({
      requestUrl,
      exchangeCodeForSession: async () => ({}),
    });

    return NextResponse.redirect(redirect.location);
  }

  const supabase = await createSupabaseServerClient();
  const redirect = await resolveAuthCallbackRedirect({
    requestUrl,
    exchangeCodeForSession: (code) =>
      supabase.auth.exchangeCodeForSession(code),
  });

  return NextResponse.redirect(redirect.location);
}
