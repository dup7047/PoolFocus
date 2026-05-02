import type { Config } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // drizzle-kit generate doesn't need a live DB but drizzle-kit migrate does.
  // Don't throw at import time; let the relevant command surface the missing env.
  console.warn("DATABASE_URL is not set; drizzle-kit commands that touch the DB will fail.");
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl ?? "postgres://invalid"
  },
  strict: true,
  verbose: true
} satisfies Config;
