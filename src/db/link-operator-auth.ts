import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { operatorUsers } from "./schema.ts";

const DEFAULT_OPERATOR_NAME = "Operator";
const LEGACY_PASSWORD_HASH_PLACEHOLDER = "supabase-auth-managed";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

config({ path: [".env.local", ".env"], quiet: true });

async function linkOperatorAuth() {
  const databaseUrl = process.env.DATABASE_URL;
  const authUserId = process.env.OPERATOR_AUTH_USER_ID?.trim();
  const name =
    process.env.OPERATOR_BOOTSTRAP_NAME?.trim() || DEFAULT_OPERATOR_NAME;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!authUserId) {
    throw new Error("OPERATOR_AUTH_USER_ID is not configured.");
  }

  if (!UUID_PATTERN.test(authUserId)) {
    throw new Error("OPERATOR_AUTH_USER_ID must be a valid UUID.");
  }

  if (name.length > 120) {
    throw new Error("OPERATOR_BOOTSTRAP_NAME must have at most 120 characters.");
  }

  const client = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  const db = drizzle({ client });

  try {
    const [operatorByAuthId] = await db
      .select({ id: operatorUsers.id })
      .from(operatorUsers)
      .where(eq(operatorUsers.authUserId, authUserId))
      .limit(1);
    const [operatorByName] = await db
      .select({ id: operatorUsers.id })
      .from(operatorUsers)
      .where(sql`lower(${operatorUsers.name}) = lower(${name})`)
      .limit(1);

    if (
      operatorByAuthId &&
      operatorByName &&
      operatorByAuthId.id !== operatorByName.id
    ) {
      throw new Error(
        "The Auth user and operator name are already linked to different operator records.",
      );
    }

    const existingOperator = operatorByAuthId ?? operatorByName;
    const [linkedOperator] = existingOperator
      ? await db
          .update(operatorUsers)
          .set({
            authUserId,
            name,
            active: true,
            updatedAt: new Date(),
          })
          .where(eq(operatorUsers.id, existingOperator.id))
          .returning({ id: operatorUsers.id })
      : await db
          .insert(operatorUsers)
          .values({
            authUserId,
            name,
            passwordHash: LEGACY_PASSWORD_HASH_PLACEHOLDER,
            active: true,
          })
          .returning({ id: operatorUsers.id });

    if (!linkedOperator) {
      throw new Error("Operator Auth link could not be saved.");
    }

    const [confirmedOperator] = await db
      .select({
        id: operatorUsers.id,
        authUserId: operatorUsers.authUserId,
      })
      .from(operatorUsers)
      .where(eq(operatorUsers.id, linkedOperator.id))
      .limit(1);

    if (confirmedOperator?.authUserId !== authUserId) {
      throw new Error("Operator Auth link could not be verified.");
    }

    console.log(`Linked active operator (id: ${linkedOperator.id}).`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

linkOperatorAuth().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  console.error(`Operator Auth linking failed: ${message}`);
  process.exitCode = 1;
});
