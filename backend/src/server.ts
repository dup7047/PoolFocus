import "dotenv/config";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { ChallengeEventRequest, ChallengeReadinessRequest } from "./models.js";
import { InMemoryRepository } from "./repository.js";
import { awardPoints, finalizeEntries, leaderboard } from "./scoring.js";

const repository = new InMemoryRepository();
seedDevelopmentData(repository);

const isProduction = process.env.NODE_ENV === "production";

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

app.get("/health", async () => ({ ok: true, mode: "non-cash-mvp" }));

app.post<{ Body: ChallengeReadinessRequest }>(
  "/challenge/readiness",
  async (request) => {
    const body = request.body;
    const existingEntry = [...repository.entries.values()].find(
      (entry) =>
        entry.challengeDayID === body.challengeDayID &&
        entry.userID === "development-user"
    );

    const entry = repository.upsertEntry({
      id: existingEntry?.id ?? randomUUID(),
      challengeDayID: body.challengeDayID,
      userID: "development-user",
      displayName: "You",
      status: "ready",
      selectionVersionHash: body.selectionVersionHash,
      pointsAwarded: 0
    });

    return { entry };
  }
);

app.post<{ Body: ChallengeEventRequest }>(
  "/challenge/events",
  async (request, reply) => {
    const body = request.body;
    const event = repository.appendEvent(body.event);
    reply.code(202);
    return { event };
  }
);

app.get<{ Params: { challengeDayID: string } }>(
  "/challenge/leaderboard/:challengeDayID",
  async (request, reply) => {
    const { challengeDayID } = request.params;
    const challengeDay = repository.challengeDays.get(challengeDayID);
    if (!challengeDay) {
      reply.code(404);
      return { error: "Challenge day not found" };
    }

    const entries = repository.entriesForChallenge(challengeDayID);
    const events = repository.eventsForEntries(
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
    awarded.forEach((entry) => repository.upsertEntry(entry));

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
    app.log.info(`PoolFocus MVP backend listening on http://${host}:${port}`);
  })
  .catch((error) => {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  });

function seedDevelopmentData(store: InMemoryRepository): void {
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
