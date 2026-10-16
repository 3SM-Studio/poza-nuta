import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "./lib/supabase/update-session";

export async function proxy(request: NextRequest) {
  // Display locale only; updateSession retains its existing authorization flow.
  request.headers.set("x-kunestu-management-ui", "1");
  if (["/sign-in", "/sign-up", "/setup", "/auth/invite/accept"].includes(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/sign-in",
    "/sign-up",
    "/setup",
    "/auth/invite/accept",
    "/account/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
    "/api/dashboard/:path*",
    "/api/operator/:path*",
  ],
};
