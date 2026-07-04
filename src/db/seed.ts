import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { calculateAutoCloseAt } from "../lib/event-lifecycle.ts";
import {
  DEFAULT_WORKSPACE_HANDLE,
  DEFAULT_WORKSPACE_NAME,
} from "../lib/workspace.ts";
import { logDatabaseError } from "./log-db-error.ts";
import { events, workspaces } from "./schema.ts";

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
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: DEFAULT_WORKSPACE_NAME,
        handle: DEFAULT_WORKSPACE_HANDLE,
      })
      .onConflictDoUpdate({
        target: workspaces.handle,
        set: {
          name: DEFAULT_WORKSPACE_NAME,
          active: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: workspaces.id });

    const startsAt = new Date();
    const insertedEvents = await db
      .insert(events)
      .values({
        workspaceId: workspace.id,
        name: "Poza Nutą",
        venue: "Domyślny lokal",
        startsAt,
        autoCloseAt: calculateAutoCloseAt(startsAt),
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
  logDatabaseError("Database seed failed", error);
  process.exitCode = 1;
});
