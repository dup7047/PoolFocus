import "dotenv/config";
import { webcrypto } from "node:crypto";
// jose (used by /auth/apple) needs globalThis.crypto; Node <19 doesn't expose it.
if (!(globalThis as { crypto?: unknown }).crypto) {
  (globalThis as { crypto?: unknown }).crypto = webcrypto;
}
import { eq } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { ChallengeStore, registerAppAttestRoutes } from "./app-attest.js";
import {
  AppAttestAssertionError,
  clientDataHashOf,
  validateAssertion
} from "./app-attest-assertion.js";
import { AppAttestValidator } from "./app-attest-validator.js";
import { AppleTokenVerifier, registerAppleAuthRoutes } from "./auth-apple.js";
import { BackendJWT } from "./auth-jwt.js";
import {
  appAttestKeys as appAttestKeysTable,
  challengeDays as challengeDaysTable,
  devices as devicesTable,
  pools as poolsTable,
  users as usersTable
} from "./db/schema.js";
import { ChallengeEventRequest, ChallengeReadinessRequest } from "./models.js";
import { PgRepository } from "./pg-repository.js";
import { InMemoryRepository, Repository } from "./repository.js";
import { awardPoints, finalizeEntries, leaderboard } from "./scoring.js";
import { createHash } from "node:crypto";

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

const challengeStore = new ChallengeStore();

// 6.1b/6.2 wiring: build a validator iff APP_ATTEST_APP_ID is configured.
// In dev/test you can leave it unset and the /auth/attest endpoint will
// persist attestations without validating (matches 6.1a behavior).
const appAttestAppId = process.env.APP_ATTEST_APP_ID;
const appAttestRequired = process.env.APP_ATTEST_REQUIRED === "true";
const appAttestValidator = appAttestAppId
  ? new AppAttestValidator({
      appId: appAttestAppId,
      allowDevelopment: process.env.APP_ATTEST_ALLOW_DEV === "true"
    })
  : undefined;
const expectedRpIdHash = appAttestAppId
  ? createHash("sha256").update(Buffer.from(appAttestAppId, "utf8")).digest()
  : undefined;

registerAppAttestRoutes(app, db, challengeStore, appAttestValidator);

// 2.2 wiring: Apple Sign-In + backend JWT issuance.
const appleAudience = process.env.APPLE_AUDIENCE;
const jwtSecret = process.env.JWT_SECRET;
const backendJwt = jwtSecret ? new BackendJWT({ secret: jwtSecret }) : undefined;
const requireAuth = backendJwt?.preHandler();
if (db && appleAudience && backendJwt) {
  const verifier = new AppleTokenVerifier({ audience: appleAudience });
  registerAppleAuthRoutes(app, db, verifier, backendJwt);
}

// Capture raw body so /challenge/events can compute clientDataHash for assertion verification.
app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (req, body, done) => {
    (req as { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, body.length === 0 ? {} : JSON.parse((body as Buffer).toString("utf8")));
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

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
  { preHandler: requireAuth ? [requireAuth] : [] },
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

app.post<{
  Body: ChallengeEventRequest;
  Headers: { "x-appattest-keyid"?: string; "x-appattest-assertion"?: string };
}>(
  "/challenge/events",
  { preHandler: requireAuth ? [requireAuth] : [] },
  async (request, reply) => {
    const keyId = request.headers["x-appattest-keyid"];
    const assertionB64 = request.headers["x-appattest-assertion"];

    if (appAttestRequired && (!keyId || !assertionB64)) {
      reply.code(401);
      return { error: "App Attest assertion required" };
    }

    if (keyId && assertionB64) {
      if (!db || !expectedRpIdHash) {
        reply.code(503);
        return { error: "App Attest enforcement requires DATABASE_URL + APP_ATTEST_APP_ID" };
      }
      const rows = await db
        .select()
        .from(appAttestKeysTable)
        .where(eq(appAttestKeysTable.keyId, keyId))
        .limit(1);
      const row = rows[0];
      if (!row || !row.publicKey) {
        reply.code(401);
        return { error: "unknown or unvalidated keyId" };
      }
      const rawBody = (request as { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        reply.code(400);
        return { error: "rawBody not captured (server misconfigured)" };
      }
      try {
        const result = validateAssertion({
          assertion: Buffer.from(assertionB64, "base64"),
          publicKeyDerBase64: row.publicKey,
          clientDataHash: clientDataHashOf(rawBody),
          expectedRpIdHash,
          lastCounter: row.assertionCounter
        });
        await db
          .update(appAttestKeysTable)
          .set({ assertionCounter: result.newCounter })
          .where(eq(appAttestKeysTable.keyId, keyId));
      } catch (err) {
        if (err instanceof AppAttestAssertionError) {
          request.log.warn({ stage: err.stage, msg: err.message }, "assertion failed");
          reply.code(401);
          return { error: `assertion failed: ${err.stage}` };
        }
        throw err;
      }
    }

    const event = await repository.appendEvent(request.body.event);
    reply.code(202);
    return { event };
  }
);

app.get<{ Params: { challengeDayID: string } }>(
  "/challenge/leaderboard/:challengeDayID",
  { preHandler: requireAuth ? [requireAuth] : [] },
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
