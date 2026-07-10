import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { calculateAutoCloseAt } from "../lib/event-lifecycle.ts";
import {
  DEFAULT_WORKSPACE_HANDLE,
  DEFAULT_WORKSPACE_NAME,
} from "../lib/workspace.ts";
import { generateOrganizationPublicId } from "../lib/organization-public-id.ts";
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
        publicId: await generateUniqueWorkspacePublicId(db),
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
    const endsAt = calculateAutoCloseAt(startsAt);
    const insertedEvents = await db
      .insert(events)
      .values({
        workspaceId: workspace.id,
        name: "Poza Nutą",
        venue: "Domyślny lokal",
        startsAt,
        autoCloseAt: endsAt,
        endsAt,
        status: "active",
        isActivePublicEvent: true,
        songRequestsEnabled: false,
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

async function generateUniqueWorkspacePublicId(
  db: ReturnType<typeof drizzle>,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const publicId = generateOrganizationPublicId();
    const [existingWorkspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.publicId, publicId))
      .limit(1);

    if (!existingWorkspace) {
      return publicId;
    }
  }

  throw new Error("Could not generate a unique workspace public ID.");
}

seed().catch((error: unknown) => {
  logDatabaseError("Database seed failed", error);
  process.exitCode = 1;
});
