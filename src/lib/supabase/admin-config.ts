export type SupabaseAdminConfig =
  | {
      success: true;
      supabaseUrl: string;
      secretKey: string;
    }
  | {
      success: false;
    };

export function getSupabaseAdminConfig(
  env: Record<string, string | undefined>,
): SupabaseAdminConfig {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const secretKey =
    env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !secretKey) {
    return { success: false };
  }

  try {
    const url = new URL(supabaseUrl);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { success: false };
    }
  } catch {
    return { success: false };
  }

  return {
    success: true,
    supabaseUrl,
    secretKey,
  };
}
