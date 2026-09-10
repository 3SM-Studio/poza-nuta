import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminConfig } from "./admin-config.ts";

export function createAdminClient() {
  const config = getSupabaseAdminConfig(process.env);

  if (!config.success) {
    throw new Error("Supabase admin client is not configured.");
  }

  return createSupabaseClient(config.supabaseUrl, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
