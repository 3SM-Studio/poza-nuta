import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminConfig } from "./admin-config.ts";
import { assertLocalApiTarget } from "../local-target.ts";

export function createAdminClient() {
  const config = getSupabaseAdminConfig(process.env);

  if (!config.success) {
    throw new Error("Supabase admin client is not configured.");
  }

  if (process.env.VERCEL !== "1" || process.env.KUNESTU_LOCAL === "1" || process.env.NODE_ENV === "test") {
    assertLocalApiTarget(config.supabaseUrl, process.env.DATABASE_URL);
  }
  return createSupabaseClient(config.supabaseUrl, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
