import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";

import { operatorAuditLog, operatorUsers } from "../../db/schema";
import { createClient as createSupabaseServerClient } from "../../lib/supabase/server";
import { getDb } from "../db";
import {
  isTransientInfrastructureError,
  traceServerStep,
  traceServerStepWithoutTimeout,
} from "../runtime-diagnostics";
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

const SESSION_DB_STEP_TIMEOUT_MS = 4_000;

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
  const { data, error } = await traceServerStep(
    "dashboard.login",
    "signInWithPassword",
    () => supabase.auth.signInWithPassword(input),
  );

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
    const operator = await traceServerStep(
      "dashboard.login",
      "findLinkedOperator",
      () => findLinkedOperator(data.user.id),
    );
    const decision = resolveOperatorAccess(data.user.id, operator);

    if (!decision.allowed) {
      throw new OperatorApiError(
        decision.status,
        decision.code,
        decision.message,
      );
    }

    await traceServerStep("dashboard.login", "writeAuditLog", () =>
      getDb().insert(operatorAuditLog).values({
        operatorId: decision.operator.id,
        action: "login",
        entityId: data.user.id,
        payload: {},
      }),
    );

    return {
      operator: decision.operator,
    };
  } catch (caughtError) {
    await supabase.auth.signOut();
    throw caughtError;
  }
}

export async function requireOperatorSession(routeName = "dashboard.session") {
  return traceServerStepWithoutTimeout(routeName, "getSession", () =>
    getCachedOperatorSession(),
  );
}

const getCachedOperatorSession = cache(
  async (): Promise<AuthenticatedOperatorSession> => {
    return resolveOperatorSession();
  },
);

async function resolveOperatorSession(): Promise<AuthenticatedOperatorSession> {
  const routeName = "dashboard.session";
  const supabase = await createSupabaseServerClient();
  const userResult = await traceServerStep(routeName, "getUser", () =>
    supabase.auth.getUser(),
  );
  throwIfInfrastructureAuthError(userResult.error);

  const {
    data: { user },
  } = userResult;

  const operator = user
    ? await traceServerStep(
        routeName,
        "findLinkedOperator",
        () => findLinkedOperator(user.id),
        SESSION_DB_STEP_TIMEOUT_MS,
      )
    : null;
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
  const userResult = await traceServerStep("sign-in", "getUser", () =>
    supabase.auth.getUser(),
  );
  throwIfInfrastructureAuthError(userResult.error);

  const {
    data: { user },
  } = userResult;
  const operator = user
    ? await traceServerStep("sign-in", "findLinkedOperator", () =>
        findLinkedOperator(user.id),
      )
    : null;

  return resolveSignInPageAccess(user?.id ?? null, operator);
}

export async function logoutOperator() {
  const supabase = await createSupabaseServerClient();
  const userResult = await traceServerStep("dashboard.logout", "getUser", () =>
    supabase.auth.getUser(),
  );
  throwIfInfrastructureAuthError(userResult.error);

  const {
    data: { user },
  } = userResult;

  if (!user) {
    throw new OperatorApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "A valid Supabase Auth session is required.",
    );
  }

  const operator = await traceServerStep(
    "dashboard.logout",
    "findLinkedOperator",
    () => findLinkedOperator(user.id),
  );
  const { error } = await traceServerStep("dashboard.logout", "signOut", () =>
    supabase.auth.signOut(),
  );

  if (error) {
    throw new Error("Supabase Auth sign-out failed.");
  }

  if (operator) {
    await traceServerStep("dashboard.logout", "writeAuditLog", () =>
      getDb().insert(operatorAuditLog).values({
        operatorId: operator.id,
        action: "logout",
        entityId: user.id,
        payload: {},
      }),
    );
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

function throwIfInfrastructureAuthError(error: unknown) {
  if (!error) {
    return;
  }

  if (isTransientInfrastructureError(error) || isSupabaseServiceError(error)) {
    throw error;
  }
}

function isSupabaseServiceError(error: unknown) {
  const status = getNumericProperty(error, "status");
  const statusCode = getNumericProperty(error, "statusCode");
  const httpStatus = status ?? statusCode;

  return typeof httpStatus === "number" && httpStatus >= 500;
}

function getNumericProperty(error: unknown, property: string) {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const value = (error as Record<string, unknown>)[property];

  return typeof value === "number" ? value : undefined;
}
