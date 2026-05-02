import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  challengeDays as challengeDaysTable,
  devices as devicesTable,
  pools as poolsTable,
  users as usersTable
} from "../src/db/schema.js";
import { PgRepository } from "../src/pg-repository.js";
import { awardPoints, finalizeEntries, leaderboard } from "../src/scoring.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("PG integration tests skipped (DATABASE_URL not set).");
  process.exit(0);
}

const client = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(client);
const repo = new PgRepository(db);

const appleId = `it.${randomUUID()}`;
const start = new Date();
const end = new Date(start.getTime() + 60 * 60 * 1000);

try {
  // --- fixtures ---
  const [user] = await db
    .insert(usersTable)
    .values({ appleUserId: appleId, displayName: "IT User" })
    .returning();
  const [pool] = await db
    .insert(poolsTable)
    .values({ name: "IT Pool", ownerUserId: user.id })
    .returning();
  const [device] = await db
    .insert(devicesTable)
    .values({ userId: user.id, deviceIdentifier: `dev-${randomUUID()}` })
    .returning();
  const [challengeDay] = await db
    .insert(challengeDaysTable)
    .values({
      poolId: pool.id,
      challengeStartUtc: start,
      challengeEndUtc: end,
      status: "active"
    })
    .returning();

  // --- getChallengeDay ---
  const fetchedDay = await repo.getChallengeDay(challengeDay.id);
  assert.ok(fetchedDay, "getChallengeDay returns row");
  assert.equal(fetchedDay.poolID, pool.id);
  assert.equal(fetchedDay.status, "active");

  const missingDay = await repo.getChallengeDay(randomUUID());
  assert.equal(missingDay, undefined, "missing challenge day returns undefined");

  // --- upsertEntry: insert ---
  const entryID = randomUUID();
  const inserted = await repo.upsertEntry({
    id: entryID,
    challengeDayID: challengeDay.id,
    userID: user.id,
    displayName: "IT User",
    status: "ready",
    selectionVersionHash: "v1",
    pointsAwarded: 0
  });
  assert.equal(inserted.status, "ready");
  assert.equal(inserted.challengeDayID, challengeDay.id);

  // --- getEntryByDayAndUser ---
  const found = await repo.getEntryByDayAndUser(challengeDay.id, user.id);
  assert.ok(found, "getEntryByDayAndUser returns the inserted row");
  assert.equal(found.id, inserted.id);

  // --- upsertEntry: update via (challengeDay, user) conflict ---
  // Pass a *different* id; the unique index should still resolve to the existing row.
  const updated = await repo.upsertEntry({
    id: randomUUID(),
    challengeDayID: challengeDay.id,
    userID: user.id,
    displayName: "IT User",
    status: "active",
    selectionVersionHash: "v2",
    pointsAwarded: 7
  });
  assert.equal(updated.id, inserted.id, "upsert preserves the original row id");
  assert.equal(updated.status, "active");
  assert.equal(updated.selectionVersionHash, "v2");
  assert.equal(updated.pointsAwarded, 7);

  // --- appendEvent + dedupe ---
  const clientEventId = `evt-${randomUUID()}`;
  const ev1 = await repo.appendEvent({
    id: clientEventId,
    entryID: inserted.id,
    deviceID: device.id,
    type: "shield_unlock",
    selectionVersionHash: "v2",
    clientOccurredAt: new Date(start.getTime() + 5 * 60 * 1000).toISOString()
  });
  assert.equal(ev1.id, clientEventId);

  const ev2 = await repo.appendEvent({
    id: clientEventId,
    entryID: inserted.id,
    deviceID: device.id,
    type: "shield_unlock",
    clientOccurredAt: new Date(start.getTime() + 5 * 60 * 1000).toISOString()
  });
  assert.equal(ev2.id, clientEventId, "dedupe returns existing event");
  assert.equal(ev2.receivedAt, ev1.receivedAt, "dedupe preserves original receivedAt");

  const events = await repo.eventsForEntries(new Set([inserted.id]));
  assert.equal(events.length, 1, "exactly one event after dedupe");

  // --- entriesForChallenge ---
  const entries = await repo.entriesForChallenge(challengeDay.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, inserted.id);

  // --- Round-trip through scoring engine ---
  const finalized = finalizeEntries({
    entries,
    events,
    challengeStartUTC: start.toISOString(),
    challengeEndUTC: end.toISOString(),
    finalizedAt: end.toISOString()
  });
  assert.equal(finalized[0].status, "forfeited", "shield_unlock forces forfeit");

  const awarded = awardPoints({
    entries: finalized,
    challengeStartUTC: start.toISOString(),
    challengeEndUTC: end.toISOString()
  });
  assert.equal(awarded[0].pointsAwarded, 0);

  const board = leaderboard({
    entries: awarded,
    challengeStartUTC: start.toISOString(),
    challengeEndUTC: end.toISOString()
  });
  assert.equal(board.length, 1);
  assert.equal(board[0].rank, 1);

  // Persist scoring result back through the repo.
  for (const entry of awarded) {
    await repo.upsertEntry(entry);
  }
  const persisted = await repo.entriesForChallenge(challengeDay.id);
  assert.equal(persisted[0].status, "forfeited");
  assert.equal(persisted[0].pointsAwarded, 0);
  assert.ok(persisted[0].forfeitedAt, "forfeitedAt set in DB");

  console.log("PgRepository integration tests passed");
} finally {
  // Cleanup: pools.owner_user_id is ON DELETE RESTRICT, so delete pools first
  // (cascades to challenge_days → entries → events). Then delete the user
  // (cascades to devices).
  const owned = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.appleUserId, appleId))
    .limit(1);
  if (owned[0]) {
    await db.delete(poolsTable).where(eq(poolsTable.ownerUserId, owned[0].id));
    await db.delete(usersTable).where(eq(usersTable.id, owned[0].id));
  }
  await client.end();
}
