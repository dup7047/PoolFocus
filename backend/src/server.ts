import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  challengeDays as challengeDaysTable,
  devices as devicesTable,
  pools as poolsTable,
  users as usersTable
} from "./db/schema.js";
import { ChallengeEventRequest, ChallengeReadinessRequest } from "./models.js";
import { PgRepository } from "./pg-repository.js";
import { InMemoryRepository, Repository } from "./repository.js";
import { awardPoints, finalizeEntries, leaderboard } from "./scoring.js";

const isProduction = process.env.NODE_ENV === "production";

const databaseUrl = process.env.DATABASE_URL;
let pool: pg.Pool | undefined;
let db: NodePgDatabase | undefined;
let repository: Repository;
if (databaseUrl) {
  pool = new pg.Pool({ connectionString: databaseUrl });
  db = drizzle(pool);
  repository = new PgRepository(db);
} else {
  const memory = new InMemoryRepository();
  seedInMemoryFixtures(memory);
  repository = memory;
}

const app = Fastify({
  genReqId: () => randomUUID(),
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport: isProduction
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname"
          }
        }
  }
});

app.get("/health", async () => ({
  ok: true,
  mode: "non-cash-mvp",
  storage: db ? "postgres" : "memory"
}));

// Dev convenience: ensures today's challenge_day exists for the seeded pool and
// returns the IDs needed to round-trip through readiness/leaderboard.
// Postgres-only.
app.post("/dev/bootstrap", async (_request, reply) => {
  if (!db) {
    reply.code(503);
    return { error: "Postgres not configured" };
  }

  const ctx = await loadDevContext(db);
  if (!ctx) {
    reply.code(409);
    return {
      error: "Seed missing. Run `npm run seed` first."
    };
  }

  const start = startOfTodayUTC();
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const existing = await db
    .select()
    .from(challengeDaysTable)
    .where(eq(challengeDaysTable.poolId, ctx.poolID))
    .limit(1);

  let challengeDayID: string;
  if (existing[0] && existing[0].challengeStartUtc.getTime() === start.getTime()) {
    challengeDayID = existing[0].id;
  } else {
    const [created] = await db
      .insert(challengeDaysTable)
      .values({
        poolId: ctx.poolID,
        challengeStartUtc: start,
        challengeEndUtc: end,
        status: "active"
      })
      .returning();
    challengeDayID = created.id;
  }

  return {
    userID: ctx.userID,
    poolID: ctx.poolID,
    deviceID: ctx.deviceID,
    challengeDayID
  };
});

app.post<{ Body: ChallengeReadinessRequest & { userID?: string; displayName?: string } }>(
  "/challenge/readiness",
  async (request, reply) => {
    const body = request.body;
    const userID = body.userID;
    if (!userID) {
      reply.code(400);
      return { error: "userID required" };
    }

    const existing = await repository.getEntryByDayAndUser(body.challengeDayID, userID);
    const entry = await repository.upsertEntry({
      id: existing?.id ?? randomUUID(),
      challengeDayID: body.challengeDayID,
      userID,
      displayName: body.displayName ?? existing?.displayName ?? "Player",
      status: "ready",
      selectionVersionHash: body.selectionVersionHash,
      pointsAwarded: existing?.pointsAwarded ?? 0
    });

    return { entry };
  }
);

app.post<{ Body: ChallengeEventRequest }>(
  "/challenge/events",
  async (request, reply) => {
    const event = await repository.appendEvent(request.body.event);
    reply.code(202);
    return { event };
  }
);

app.get<{ Params: { challengeDayID: string } }>(
  "/challenge/leaderboard/:challengeDayID",
  async (request, reply) => {
    const { challengeDayID } = request.params;
    const challengeDay = await repository.getChallengeDay(challengeDayID);
    if (!challengeDay) {
      reply.code(404);
      return { error: "Challenge day not found" };
    }

    const entries = await repository.entriesForChallenge(challengeDayID);
    const events = await repository.eventsForEntries(
      new Set(entries.map((entry) => entry.id))
    );
    const finalized = finalizeEntries({
      entries,
      events,
      challengeStartUTC: challengeDay.challengeStartUTC,
      challengeEndUTC: challengeDay.challengeEndUTC,
      finalizedAt: new Date().toISOString()
    });
    const awarded = awardPoints({
      entries: finalized,
      challengeStartUTC: challengeDay.challengeStartUTC,
      challengeEndUTC: challengeDay.challengeEndUTC
    });
    for (const entry of awarded) {
      await repository.upsertEntry(entry);
    }

    return {
      challengeDayID,
      generatedAt: new Date().toISOString(),
      entries: awarded,
      rows: leaderboard({
        entries: awarded,
        challengeStartUTC: challengeDay.challengeStartUTC,
        challengeEndUTC: challengeDay.challengeEndUTC
      })
    };
  }
);

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

app
  .listen({ port, host })
  .then(() => {
    app.log.info(
      { storage: db ? "postgres" : "memory" },
      `PoolFocus MVP backend listening on http://${host}:${port}`
    );
  })
  .catch((error) => {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  });

const shutdown = async () => {
  await app.close();
  await pool?.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

interface DevContext {
  userID: string;
  poolID: string;
  deviceID: string;
}

async function loadDevContext(database: NodePgDatabase): Promise<DevContext | undefined> {
  const [user] = await database
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.appleUserId, "dev.local.001"))
    .limit(1);
  if (!user) return undefined;

  const [pool] = await database
    .select({ id: poolsTable.id })
    .from(poolsTable)
    .where(eq(poolsTable.ownerUserId, user.id))
    .limit(1);
  if (!pool) return undefined;

  const existingDevice = await database
    .select({ id: devicesTable.id })
    .from(devicesTable)
    .where(eq(devicesTable.userId, user.id))
    .limit(1);
  let deviceID: string;
  if (existingDevice[0]) {
    deviceID = existingDevice[0].id;
  } else {
    const [created] = await database
      .insert(devicesTable)
      .values({ userId: user.id, deviceIdentifier: "dev-local-device" })
      .returning({ id: devicesTable.id });
    deviceID = created.id;
  }

  return { userID: user.id, poolID: pool.id, deviceID };
}

function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function seedInMemoryFixtures(store: InMemoryRepository): void {
  const poolID = "development-pool";
  const challengeDayID = "development-challenge-day";
  const now = new Date();
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  store.pools.set(poolID, {
    id: poolID,
    name: "Friends Focus",
    ownerUserID: "development-user",
    timezoneIdentifier: "America/New_York",
    privateInviteCode: "FOCUS"
  });

  store.challengeDays.set(challengeDayID, {
    id: challengeDayID,
    poolID,
    challengeStartUTC: now.toISOString(),
    challengeEndUTC: end.toISOString(),
    status: "active"
  });
}
