import "server-only";

import { eq } from "drizzle-orm";

import { operatorAuditLog, operatorUsers } from "../../db/schema";
import { createClient as createSupabaseServerClient } from "../../lib/supabase/server";
import { getDb } from "../db";
import {
  mapSupabaseLoginError,
  resolveOperatorAccess,
  resolveSignInPageAccess,
  type LinkedOperatorRecord,
} from "./auth-policy";
import { OperatorApiError } from "./errors";
import type { LoginInput } from "./validation";

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type AuthenticatedOperatorSession = {
  authUser: {
    id: string;
    email: string | null;
  };
  operator: {
    id: number;
    name: string;
    active: true;
  };
  supabase: SupabaseServerClient;
};

export async function loginOperator(input: LoginInput) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(input);

  if (error || !data.user || !data.session) {
    const mappedError = mapSupabaseLoginError(error ?? {});

    if (mappedError.status === 500) {
      throw new Error(mappedError.message);
    }

    throw new OperatorApiError(
      mappedError.status,
      mappedError.code,
      mappedError.message,
    );
  }

  try {
    const operator = await findLinkedOperator(data.user.id);
    const decision = resolveOperatorAccess(data.user.id, operator);

    if (!decision.allowed) {
      throw new OperatorApiError(
        decision.status,
        decision.code,
        decision.message,
      );
    }

    await getDb().insert(operatorAuditLog).values({
      operatorId: decision.operator.id,
      action: "login",
      entityId: data.user.id,
      payload: {},
    });

    return {
      operator: decision.operator,
    };
  } catch (caughtError) {
    await supabase.auth.signOut();
    throw caughtError;
  }
}

export async function requireOperatorSession(): Promise<AuthenticatedOperatorSession> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const operator = user ? await findLinkedOperator(user.id) : null;
  const decision = resolveOperatorAccess(user?.id ?? null, operator);

  if (!decision.allowed) {
    throw new OperatorApiError(
      decision.status,
      decision.code,
      decision.message,
    );
  }

  return {
    authUser: {
      id: user!.id,
      email: user!.email ?? null,
    },
    operator: decision.operator,
    supabase,
  };
}

export async function getSignInPageAccess() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const operator = user ? await findLinkedOperator(user.id) : null;

  return resolveSignInPageAccess(user?.id ?? null, operator);
}

export async function logoutOperator() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new OperatorApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "A valid Supabase Auth session is required.",
    );
  }

  const operator = await findLinkedOperator(user.id);
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error("Supabase Auth sign-out failed.");
  }

  if (operator) {
    await getDb().insert(operatorAuditLog).values({
      operatorId: operator.id,
      action: "logout",
      entityId: user.id,
      payload: {},
    });
  }
}

async function findLinkedOperator(
  authUserId: string,
): Promise<LinkedOperatorRecord | null> {
  const [operator] = await getDb()
    .select({
      id: operatorUsers.id,
      name: operatorUsers.name,
      active: operatorUsers.active,
    })
    .from(operatorUsers)
    .where(eq(operatorUsers.authUserId, authUserId))
    .limit(1);

  return operator ?? null;
}
