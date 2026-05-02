import http, { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { ChallengeEventRequest, ChallengeReadinessRequest } from "./models.js";
import { InMemoryRepository } from "./repository.js";
import { awardPoints, finalizeEntries, leaderboard } from "./scoring.js";

const repository = new InMemoryRepository();

seedDevelopmentData(repository);

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { ok: true, mode: "non-cash-mvp" });
    }

    if (request.method === "POST" && request.url === "/challenge/readiness") {
      const body = await parseJSON<ChallengeReadinessRequest>(request);
      const existingEntry = [...repository.entries.values()].find(
        (entry) => entry.challengeDayID === body.challengeDayID && entry.userID === "development-user"
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

      return json(response, 200, { entry });
    }

    if (request.method === "POST" && request.url === "/challenge/events") {
      const body = await parseJSON<ChallengeEventRequest>(request);
      const event = repository.appendEvent(body.event);
      return json(response, 202, { event });
    }

    if (request.method === "GET" && request.url?.startsWith("/challenge/leaderboard/")) {
      const challengeDayID = request.url.split("/").at(-1);
      if (!challengeDayID) {
        return json(response, 400, { error: "Missing challengeDayID" });
      }

      const challengeDay = repository.challengeDays.get(challengeDayID);
      if (!challengeDay) {
        return json(response, 404, { error: "Challenge day not found" });
      }

      const entries = repository.entriesForChallenge(challengeDayID);
      const events = repository.eventsForEntries(new Set(entries.map((entry) => entry.id)));
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

      return json(response, 200, {
        challengeDayID,
        generatedAt: new Date().toISOString(),
        entries: awarded,
        rows: leaderboard({
          entries: awarded,
          challengeStartUTC: challengeDay.challengeStartUTC,
          challengeEndUTC: challengeDay.challengeEndUTC
        })
      });
    }

    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
});

server.listen(8080, () => {
  console.log("PoolFocus MVP backend listening on http://localhost:8080");
});

function json(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}

async function parseJSON<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

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
