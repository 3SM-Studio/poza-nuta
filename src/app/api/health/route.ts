import { sql } from "drizzle-orm";

import { getDb } from "../../../server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HealthStatus = {
  status: "ok" | "degraded";
  databaseUrlConfigured: boolean;
  databaseQuerySucceeded: boolean;
};

function healthResponse(body: HealthStatus, status: 200 | 503) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL);

  if (!databaseUrlConfigured) {
    return healthResponse(
      {
        status: "degraded",
        databaseUrlConfigured: false,
        databaseQuerySucceeded: false,
      },
      503,
    );
  }

  try {
    await getDb().execute(sql`select 1`);

    return healthResponse(
      {
        status: "ok",
        databaseUrlConfigured: true,
        databaseQuerySucceeded: true,
      },
      200,
    );
  } catch {
    return healthResponse(
      {
        status: "degraded",
        databaseUrlConfigured: true,
        databaseQuerySucceeded: false,
      },
      503,
    );
  }
}
