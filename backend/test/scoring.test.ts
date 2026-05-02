import assert from "node:assert/strict";
import { ChallengeEntry, ScreenTimeEvent } from "../src/models.js";
import { awardPoints, finalizeEntries, leaderboard } from "../src/scoring.js";

const start = "2026-04-27T12:00:00.000Z";
const end = "2026-04-28T12:00:00.000Z";

const entry: ChallengeEntry = {
  id: "entry-1",
  challengeDayID: "day-1",
  userID: "user-1",
  displayName: "Ari",
  status: "active",
  selectionVersionHash: "v1",
  pointsAwarded: 0
};

const event: ScreenTimeEvent = {
  id: "event-1",
  entryID: "entry-1",
  deviceID: "device-1",
  type: "shield_unlock",
  selectionVersionHash: "v1",
  clientOccurredAt: "2026-04-27T12:10:00.000Z",
  receivedAt: "2026-04-27T12:11:00.000Z"
};

const finalized = finalizeEntries({
  entries: [entry],
  events: [event],
  challengeStartUTC: start,
  challengeEndUTC: end,
  finalizedAt: end
});

assert.equal(finalized[0].status, "forfeited");
assert.equal(finalized[0].forfeitedAt, event.receivedAt);

const coWinners = finalizeEntries({
  entries: [
    { ...entry, id: "entry-2", displayName: "Bo", status: "ready" },
    { ...entry, id: "entry-3", displayName: "Cy", status: "active" }
  ],
  events: [],
  challengeStartUTC: start,
  challengeEndUTC: end,
  finalizedAt: end
});

const awarded = awardPoints({
  entries: coWinners,
  challengeStartUTC: start,
  challengeEndUTC: end
});

assert.deepEqual(awarded.map((winner) => winner.pointsAwarded), [10, 10]);
assert.equal(leaderboard({ entries: awarded, challengeStartUTC: start, challengeEndUTC: end }).every((row) => row.isCoWinner), true);

console.log("Backend scoring tests passed");
