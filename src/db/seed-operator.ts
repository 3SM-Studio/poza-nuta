import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { operatorUsers } from "./schema.ts";
import { hashPin } from "../server/operator-api/crypto.ts";
import { DEFAULT_OPERATOR_NAME } from "../server/operator-api/validation.ts";

config({ path: [".env.local", ".env"], quiet: true });

async function seedOperator() {
  const databaseUrl = process.env.DATABASE_URL;
  const pin = process.env.OPERATOR_BOOTSTRAP_PIN;
  const name =
    process.env.OPERATOR_BOOTSTRAP_NAME?.trim() || DEFAULT_OPERATOR_NAME;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pin) {
    throw new Error("OPERATOR_BOOTSTRAP_PIN is not configured.");
  }

  if (pin === "change-me") {
    throw new Error(
      "OPERATOR_BOOTSTRAP_PIN still contains the example placeholder.",
    );
  }

  if (name.length > 120) {
    throw new Error("OPERATOR_BOOTSTRAP_NAME must have at most 120 characters.");
  }

  if (pin.length < 4 || pin.length > 128) {
    throw new Error(
      "OPERATOR_BOOTSTRAP_PIN must have between 4 and 128 characters.",
    );
  }

  const client = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  const db = drizzle({ client });

  try {
    const [existingOperator] = await db
      .select({
        id: operatorUsers.id,
        active: operatorUsers.active,
      })
      .from(operatorUsers)
      .where(sql`lower(${operatorUsers.name}) = lower(${name})`)
      .limit(1);

    if (existingOperator?.active) {
      console.log("Active operator already exists; seed skipped.");
      return;
    }

    if (existingOperator) {
      throw new Error(
        "An inactive operator with this name already exists; seed did not modify it.",
      );
    }

    const passwordHash = await hashPin(pin);
    const [createdOperator] = await db
      .insert(operatorUsers)
      .values({
        name,
        passwordHash,
        active: true,
      })
      .returning({ id: operatorUsers.id });

    if (!createdOperator) {
      throw new Error("Operator could not be created.");
    }

    const [confirmedOperator] = await db
      .select({ id: operatorUsers.id })
      .from(operatorUsers)
      .where(eq(operatorUsers.id, createdOperator.id))
      .limit(1);

    if (!confirmedOperator) {
      throw new Error("Operator creation could not be verified.");
    }

    console.log(`Created active operator (id: ${createdOperator.id}).`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

seedOperator().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  console.error(`Operator seed failed: ${message}`);
  process.exitCode = 1;
});
