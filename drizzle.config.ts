import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { assertLocalDatabaseTarget } from "./src/lib/local-target.ts";

config({ path: ".env.admin.local", quiet: true });

const databaseUrl = process.env.DIRECT_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["public"],
  ...(databaseUrl
    ? {
        dbCredentials: {
          url: assertLocalDatabaseTarget(databaseUrl),
        },
      }
    : {}),
});
