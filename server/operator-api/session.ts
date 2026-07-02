import "server-only";

import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { NextRequest, NextResponse } from "next/server";

import {
  operatorAuditLog,
  operatorSessions,
  operatorUsers,
} from "../../db/schema";
import { getDb } from "../db";
import {
  createSessionToken,
  hashPin,
  hashSessionToken,
  verifyPin,
} from "./crypto";
import { OperatorApiError } from "./errors";
import type { LoginInput } from "./validation";

export const OPERATOR_SESSION_COOKIE = "poza_nuta_operator_session";
export const OPERATOR_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AuthenticatedOperatorSession = {
  sessionId: number;
  expiresAt: Date;
  operator: {
    id: number;
    name: string;
    active: true;
  };
};

export async function loginOperator(input: LoginInput) {
  const [operator] = await getDb()
    .select({
      id: operatorUsers.id,
      name: operatorUsers.name,
      passwordHash: operatorUsers.passwordHash,
      active: operatorUsers.active,
    })
    .from(operatorUsers)
    .where(sql`lower(${operatorUsers.name}) = lower(${input.name})`)
    .limit(1);

  const pinMatches = operator
    ? await verifyPin(input.pin, operator.passwordHash)
    : await consumeUnknownOperatorCredential(input.pin);

  if (!operator || !pinMatches) {
    throw new OperatorApiError(
      401,
      "INVALID_CREDENTIALS",
      "The operator name or PIN is incorrect.",
    );
  }

  if (!operator.active) {
    throw new OperatorApiError(
      403,
      "OPERATOR_INACTIVE",
      "This operator account is inactive.",
    );
  }

  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(
    Date.now() + OPERATOR_SESSION_TTL_SECONDS * 1_000,
  );

  const session = await getDb().transaction(async (transaction) => {
    await transaction
      .delete(operatorSessions)
      .where(
        and(
          eq(operatorSessions.operatorId, operator.id),
          lte(operatorSessions.expiresAt, new Date()),
        ),
      );

    const [createdSession] = await transaction
      .insert(operatorSessions)
      .values({
        operatorId: operator.id,
        tokenHash,
        expiresAt,
      })
      .returning({ id: operatorSessions.id });

    await transaction.insert(operatorAuditLog).values({
      operatorId: operator.id,
      action: "login",
      entityId: String(createdSession.id),
      payload: {
        expiresAt: expiresAt.toISOString(),
      },
    });

    return createdSession;
  });

  return {
    token,
    session: {
      sessionId: session.id,
      expiresAt,
      operator: {
        id: operator.id,
        name: operator.name,
        active: true as const,
      },
    },
  };
}

export async function requireOperatorSession(
  request: NextRequest,
): Promise<AuthenticatedOperatorSession> {
  const token = request.cookies.get(OPERATOR_SESSION_COOKIE)?.value;

  if (!token) {
    throw new OperatorApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "A valid operator session is required.",
    );
  }

  const tokenHash = hashSessionToken(token);
  const [session] = await getDb()
    .select({
      sessionId: operatorSessions.id,
      expiresAt: operatorSessions.expiresAt,
      operatorId: operatorUsers.id,
      operatorName: operatorUsers.name,
      operatorActive: operatorUsers.active,
    })
    .from(operatorSessions)
    .innerJoin(
      operatorUsers,
      eq(operatorSessions.operatorId, operatorUsers.id),
    )
    .where(
      and(
        eq(operatorSessions.tokenHash, tokenHash),
        gt(operatorSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    throw new OperatorApiError(
      401,
      "INVALID_SESSION",
      "The operator session is missing, expired, or invalid.",
    );
  }

  if (!session.operatorActive) {
    throw new OperatorApiError(
      403,
      "OPERATOR_INACTIVE",
      "This operator account is inactive.",
    );
  }

  return {
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    operator: {
      id: session.operatorId,
      name: session.operatorName,
      active: true,
    },
  };
}

export async function logoutOperator(session: AuthenticatedOperatorSession) {
  await getDb().transaction(async (transaction) => {
    const deletedSessions = await transaction
      .delete(operatorSessions)
      .where(
        and(
          eq(operatorSessions.id, session.sessionId),
          eq(operatorSessions.operatorId, session.operator.id),
        ),
      )
      .returning({ id: operatorSessions.id });

    if (deletedSessions.length === 0) {
      throw new OperatorApiError(
        401,
        "INVALID_SESSION",
        "The operator session is missing, expired, or invalid.",
      );
    }

    await transaction.insert(operatorAuditLog).values({
      operatorId: session.operator.id,
      action: "logout",
      entityId: String(session.sessionId),
      payload: {},
    });
  });
}

export function setOperatorSessionCookie(
  response: NextResponse,
  token: string,
) {
  response.cookies.set({
    name: OPERATOR_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OPERATOR_SESSION_TTL_SECONDS,
  });
}

export function clearOperatorSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: OPERATOR_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

async function consumeUnknownOperatorCredential(pin: string) {
  await hashPin(pin);
  return false;
}
