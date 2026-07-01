import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { events } from "./schema.ts";

config({ path: [".env.local", ".env"], quiet: true });

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  const db = drizzle({ client });

  try {
    const insertedEvents = await db
      .insert(events)
      .values({
        name: "Poza Nutą",
        venue: "Domyślny lokal",
        startsAt: new Date(),
        status: "active",
        isActivePublicEvent: true,
        publicQueueEnabled: false,
        publicShowSongTitles: true,
      })
      .onConflictDoNothing()
      .returning({ id: events.id });

    if (insertedEvents.length === 0) {
      console.log("Active public event already exists; seed skipped.");
      return;
    }

    console.log(`Created active public event (id: ${insertedEvents[0].id}).`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

seed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  console.error(`Database seed failed: ${message}`);
  process.exitCode = 1;
});
