import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { assertLocalApiTarget, assertLocalDatabaseTarget } from "./src/lib/local-target.ts";

if (process.env.VERCEL !== "1" || process.env.KUNESTU_LOCAL === "1" || process.env.NODE_ENV !== "production") {
  const databaseUrl = assertLocalDatabaseTarget(process.env.DATABASE_URL);
  assertLocalApiTarget(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseUrl);
  assertLocalApiTarget(process.env.SUPABASE_URL, databaseUrl);
}

const nextConfig: NextConfig = {
  ...(process.env.NEXT_DIST_DIR
    ? { distDir: process.env.NEXT_DIST_DIR }
    : {}),
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
