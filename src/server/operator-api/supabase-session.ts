import "server-only";

import { cache } from "react";
import { eq, sql } from "drizzle-orm";

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
  mapSupabaseSignupError,
  resolveOperatorAccess,
  resolveSignInPageAccess,
  type AccessibleOperatorRecord,
  type LinkedOperatorRecord,
} from "./auth-policy";
import { OperatorApiError } from "./errors";
import type { LoginInput, OperatorProfileInput, SignupInput } from "./validation";

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

const SESSION_DB_STEP_TIMEOUT_MS = 4_000;
const SUPABASE_AUTH_PASSWORD_HASH_PLACEHOLDER = "supabase-auth-managed";
const SIGNUP_OPERATOR_NAME_PLACEHOLDER = "Nowy uzytkownik";

export type AuthenticatedOperatorSession = {
  authUser: {
    id: string;
    email: string | null;
  };
  operator: {
    id: number;
    name: string;
    displayName: string | null;
    profileCompletedAt: Date | null;
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
        actorKind: "operator",
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

export async function signupOperator(input: {
  data: SignupInput;
  emailRedirectTo: string;
}) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await traceServerStep(
    "dashboard.signup",
    "signUp",
    () =>
      supabase.auth.signUp({
        email: input.data.email,
        password: input.data.password,
        options: {
          emailRedirectTo: input.emailRedirectTo,
        },
      }),
  );

  if (error || !data.user) {
    const mappedError = mapSupabaseSignupError(error ?? {});

    throw new OperatorApiError(
      mappedError.status,
      mappedError.code,
      mappedError.message,
    );
  }

  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new OperatorApiError(
      400,
      "SIGNUP_FAILED",
      "The account could not be created.",
    );
  }

  const authUserId = data.user.id;
  const operator = await traceServerStep(
    "dashboard.signup",
    "ensureLocalOperator",
    () =>
      ensureSignupOperatorForAuthUser({
        authUserId,
      }),
  );

  return {
    status: data.session ? ("signed_in" as const) : ("check_email" as const),
    operator,
  };
}

const getCachedOperatorSession = cache(
  async (): Promise<AuthenticatedOperatorSession> => {
    return resolveOperatorSession();
  },
);

async function resolveOperatorSession(): Promise<AuthenticatedOperatorSession> {
  const routeName = "dashboard.session";
  const supabase = await createSupabaseServerClient();
  const authUser = await getVerifiedAuthIdentity(supabase, routeName);

  const operator = authUser
    ? await traceServerStep(
        routeName,
        "findLinkedOperator",
        () => findLinkedOperator(authUser.id),
        SESSION_DB_STEP_TIMEOUT_MS,
      )
    : null;
  const decision = resolveOperatorAccess(authUser?.id ?? null, operator);

  if (!decision.allowed) {
    throw new OperatorApiError(
      decision.status,
      decision.code,
      decision.message,
    );
  }

  return {
    authUser: authUser!,
    operator: decision.operator,
    supabase,
  };
}

export async function getSignInPageAccess() {
  const supabase = await createSupabaseServerClient();
  const authUser = await getVerifiedAuthIdentity(supabase, "sign-in");
  const operator = authUser
    ? await traceServerStep("sign-in", "findLinkedOperator", () =>
        findLinkedOperator(authUser.id),
      )
    : null;

  return resolveSignInPageAccess(authUser?.id ?? null, operator);
}

async function getVerifiedAuthIdentity(
  supabase: SupabaseServerClient,
  routeName: string,
) {
  const claimsResult = await traceServerStep(routeName, "getClaims", () =>
    supabase.auth.getClaims(),
  );
  throwIfInfrastructureAuthError(claimsResult.error);

  const claims = claimsResult.data?.claims;
  const id = typeof claims?.sub === "string" ? claims.sub : null;

  if (!id) {
    return null;
  }

  return {
    id,
    email: typeof claims?.email === "string" ? claims.email : null,
  };
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
        actorKind: "operator",
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
      displayName: operatorUsers.displayName,
      profileCompletedAt: operatorUsers.profileCompletedAt,
      active: operatorUsers.active,
      suspendedAt: operatorUsers.suspendedAt,
    })
    .from(operatorUsers)
    .where(eq(operatorUsers.authUserId, authUserId))
    .limit(1);

  return operator ?? null;
}

async function ensureSignupOperatorForAuthUser(input: {
  authUserId: string;
}): Promise<AccessibleOperatorRecord> {
  return getDb().transaction(async (transaction) => {
    const [existingOperator] = await transaction
      .select({
        id: operatorUsers.id,
        name: operatorUsers.name,
        displayName: operatorUsers.displayName,
        profileCompletedAt: operatorUsers.profileCompletedAt,
        active: operatorUsers.active,
        suspendedAt: operatorUsers.suspendedAt,
      })
      .from(operatorUsers)
      .where(eq(operatorUsers.authUserId, input.authUserId))
      .limit(1);

    if (existingOperator) {
      const access = resolveOperatorAccess(input.authUserId, existingOperator);

      if (!access.allowed) {
        throw new OperatorApiError(
          access.status,
          access.code,
          access.message,
        );
      }

      return access.operator;
    }

    const name = await generateUniqueOperatorName(
      transaction,
      SIGNUP_OPERATOR_NAME_PLACEHOLDER,
    );
    const [operator] = await transaction
      .insert(operatorUsers)
      .values({
        name,
        authUserId: input.authUserId,
        displayName: null,
        profileCompletedAt: null,
        // Passwords are managed exclusively by Supabase Auth.
        passwordHash: SUPABASE_AUTH_PASSWORD_HASH_PLACEHOLDER,
        active: true,
        suspendedAt: null,
        suspensionReason: null,
        suspendedByOperatorId: null,
      })
      .returning({
        id: operatorUsers.id,
        name: operatorUsers.name,
        displayName: operatorUsers.displayName,
        profileCompletedAt: operatorUsers.profileCompletedAt,
        active: operatorUsers.active,
      });

    if (!operator) {
      throw new Error("Local operator account could not be created.");
    }

    return {
      ...operator,
      active: true,
    };
  });
}

export async function updateOperatorProfileForAuthUser(input: {
  authUserId: string;
  profile: OperatorProfileInput;
}) {
  const [operator] = await getDb()
    .update(operatorUsers)
    .set({
      displayName: input.profile.displayName,
      profileCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(operatorUsers.authUserId, input.authUserId))
    .returning({
      id: operatorUsers.id,
      name: operatorUsers.name,
      displayName: operatorUsers.displayName,
      profileCompletedAt: operatorUsers.profileCompletedAt,
      active: operatorUsers.active,
    });

  if (!operator) {
    throw new OperatorApiError(
      404,
      "OPERATOR_NOT_FOUND",
      "Operator profile was not found.",
    );
  }

  if (!operator.active) {
    throw new OperatorApiError(
      403,
      "OPERATOR_INACTIVE",
      "This operator account is inactive.",
    );
  }

  return {
    ...operator,
    active: true as const,
  };
}

export function getOperatorDisplayName(operator: {
  name: string;
  displayName: string | null;
}) {
  return operator.displayName ?? operator.name;
}

export function isOperatorProfileCompleted(operator: {
  profileCompletedAt: Date | null;
}) {
  return operator.profileCompletedAt !== null;
}

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

async function generateUniqueOperatorName(
  transaction: DatabaseTransaction,
  displayName: string,
) {
  const normalizedDisplayName = displayName.trim();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : ` ${attempt + 1}`;
    const candidate = `${normalizedDisplayName}${suffix}`.slice(0, 120);
    const [existingOperator] = await transaction
      .select({ id: operatorUsers.id })
      .from(operatorUsers)
      .where(sql`lower(${operatorUsers.name}) = ${candidate.toLowerCase()}`)
      .limit(1);

    if (!existingOperator) {
      return candidate;
    }
  }

  throw new Error("Could not generate a unique operator name.");
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
