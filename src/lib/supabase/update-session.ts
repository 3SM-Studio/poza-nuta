import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  getDashboardOrganizationIdFromPath,
  LAST_SELECTED_ORGANIZATION_COOKIE,
  LAST_SELECTED_ORGANIZATION_MAX_AGE_SECONDS,
} from "../dashboard-last-selected-organization";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          supabaseResponse = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });

          Object.entries(headers).forEach(([key, value]) => {
            supabaseResponse.headers.set(key, value);
          });
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const pathname = request.nextUrl.pathname;
  const isProtectedDashboardRoute =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  if (!data?.claims && isProtectedDashboardRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/sign-in";
    loginUrl.search = "";

    const redirectResponse = NextResponse.redirect(loginUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    ["cache-control", "expires", "pragma"].forEach((headerName) => {
      const value = supabaseResponse.headers.get(headerName);

      if (value) {
        redirectResponse.headers.set(headerName, value);
      }
    });

    return redirectResponse;
  }

  const selectedOrganizationId = data?.claims
    ? getDashboardOrganizationIdFromPath(pathname)
    : null;

  if (selectedOrganizationId) {
    supabaseResponse.cookies.set(
      LAST_SELECTED_ORGANIZATION_COOKIE,
      selectedOrganizationId,
      {
        httpOnly: true,
        maxAge: LAST_SELECTED_ORGANIZATION_MAX_AGE_SECONDS,
        path: "/dashboard",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    );
  }

  return supabaseResponse;
}
