import type { NextRequest } from "next/server";

import { updateSession } from "./lib/supabase/update-session";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/dashboard/:path*",
    "/api/dashboard/:path*",
    "/api/operator/:path*",
  ],
};
