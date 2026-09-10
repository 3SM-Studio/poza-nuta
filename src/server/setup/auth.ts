import "server-only";

import { createClient as createSupabaseServerClient } from "../../lib/supabase/server";
import type { VerifiedSetupUser } from "./service";

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export async function getVerifiedSetupUser(
  supabase: SupabaseServerClient,
): Promise<VerifiedSetupUser> {
  const claimsResult = await supabase.auth.getClaims();
  const claims = claimsResult.data?.claims;
  const subject = typeof claims?.sub === "string" ? claims.sub : null;

  if (claimsResult.error || !subject) {
    return { status: "missing" };
  }

  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;

  if (userResult.error || !user || user.id !== subject) {
    return { status: "missing" };
  }

  return {
    status: "authenticated",
    id: user.id,
    email: user.email ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
  };
}

export async function getVerifiedSetupUserFromRequest() {
  const supabase = await createSupabaseServerClient();

  return getVerifiedSetupUser(supabase);
}
