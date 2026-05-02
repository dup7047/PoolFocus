import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { poolMembers, pools, users } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}

const APPLE_USER_ID = "dev.local.001";

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

try {
  // Idempotent: bail if the dev seed already exists
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.appleUserId, APPLE_USER_ID))
    .limit(1);

  if (existing.length > 0) {
    console.log(`Seed: dev user ${existing[0].id} already exists, skipping.`);
    process.exit(0);
  }

  const [user] = await db
    .insert(users)
    .values({
      appleUserId: APPLE_USER_ID,
      displayName: "Dev User",
      email: "dev@local.test"
    })
    .returning();

  const [createdPool] = await db
    .insert(pools)
    .values({
      name: "Friends Focus",
      ownerUserId: user.id,
      timezone: "America/New_York"
    })
    .returning();

  const [membership] = await db
    .insert(poolMembers)
    .values({
      poolId: createdPool.id,
      userId: user.id,
      role: "owner"
    })
    .returning();

  console.log(
    `Seed: user=${user.id}  pool=${createdPool.id}  membership=${membership.id}`
  );
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
