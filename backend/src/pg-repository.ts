import { and, eq, inArray, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  ChallengeDay,
  ChallengeEntry,
  ChallengeEntryStatus,
  ScreenTimeEvent,
  ScreenTimeEventType
} from "./models.js";
import {
  challengeDays as challengeDaysTable,
  challengeEntries as challengeEntriesTable,
  screenTimeEvents as screenTimeEventsTable,
  type ChallengeDayRow,
  type ChallengeEntryRow,
  type ScreenTimeEventRow
} from "./db/schema.js";
import { Repository } from "./repository.js";

export class PgRepository implements Repository {
  constructor(private readonly db: NodePgDatabase) {}

  async getChallengeDay(id: string): Promise<ChallengeDay | undefined> {
    const rows = await this.db
      .select()
      .from(challengeDaysTable)
      .where(eq(challengeDaysTable.id, id))
      .limit(1);
    return rows[0] ? rowToChallengeDay(rows[0]) : undefined;
  }

  async getEntryByDayAndUser(
    challengeDayID: string,
    userID: string
  ): Promise<ChallengeEntry | undefined> {
    const rows = await this.db
      .select()
      .from(challengeEntriesTable)
      .where(
        and(
          eq(challengeEntriesTable.challengeDayId, challengeDayID),
          eq(challengeEntriesTable.userId, userID)
        )
      )
      .limit(1);
    return rows[0] ? rowToEntry(rows[0]) : undefined;
  }

  async upsertEntry(entry: ChallengeEntry): Promise<ChallengeEntry> {
    const values = {
      id: entry.id,
      challengeDayId: entry.challengeDayID,
      userId: entry.userID,
      displayName: entry.displayName,
      status: entry.status,
      selectionVersionHash: entry.selectionVersionHash ?? null,
      forfeitedAt: entry.forfeitedAt ? new Date(entry.forfeitedAt) : null,
      completedAt: entry.completedAt ? new Date(entry.completedAt) : null,
      pointsAwarded: entry.pointsAwarded
    };

    const [row] = await this.db
      .insert(challengeEntriesTable)
      .values(values)
      .onConflictDoUpdate({
        target: [challengeEntriesTable.challengeDayId, challengeEntriesTable.userId],
        set: {
          displayName: values.displayName,
          status: values.status,
          selectionVersionHash: values.selectionVersionHash,
          forfeitedAt: values.forfeitedAt,
          completedAt: values.completedAt,
          pointsAwarded: values.pointsAwarded,
          updatedAt: sql`now()`
        }
      })
      .returning();
    return rowToEntry(row);
  }

  async appendEvent(event: ScreenTimeEvent): Promise<ScreenTimeEvent> {
    const receivedAt = event.receivedAt ? new Date(event.receivedAt) : new Date();
    const values = {
      entryId: event.entryID,
      deviceId: event.deviceID,
      clientEventId: event.id,
      type: event.type,
      selectionVersionHash: event.selectionVersionHash ?? null,
      clientOccurredAt: new Date(event.clientOccurredAt),
      receivedAt
    };

    const inserted = await this.db
      .insert(screenTimeEventsTable)
      .values(values)
      .onConflictDoNothing({
        target: [screenTimeEventsTable.entryId, screenTimeEventsTable.clientEventId]
      })
      .returning();

    if (inserted[0]) {
      return rowToEvent(inserted[0]);
    }

    // Conflict: row already existed — fetch and return it.
    const existing = await this.db
      .select()
      .from(screenTimeEventsTable)
      .where(
        and(
          eq(screenTimeEventsTable.entryId, event.entryID),
          eq(screenTimeEventsTable.clientEventId, event.id)
        )
      )
      .limit(1);
    return rowToEvent(existing[0]);
  }

  async entriesForChallenge(challengeDayID: string): Promise<ChallengeEntry[]> {
    const rows = await this.db
      .select()
      .from(challengeEntriesTable)
      .where(eq(challengeEntriesTable.challengeDayId, challengeDayID));
    return rows.map(rowToEntry);
  }

  async eventsForEntries(entryIDs: Set<string>): Promise<ScreenTimeEvent[]> {
    if (entryIDs.size === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(screenTimeEventsTable)
      .where(inArray(screenTimeEventsTable.entryId, [...entryIDs]));
    return rows.map(rowToEvent);
  }
}

function rowToChallengeDay(row: ChallengeDayRow): ChallengeDay {
  return {
    id: row.id,
    poolID: row.poolId,
    challengeStartUTC: row.challengeStartUtc.toISOString(),
    challengeEndUTC: row.challengeEndUtc.toISOString(),
    status: row.status as ChallengeDay["status"]
  };
}

function rowToEntry(row: ChallengeEntryRow): ChallengeEntry {
  return {
    id: row.id,
    challengeDayID: row.challengeDayId,
    userID: row.userId,
    displayName: row.displayName,
    status: row.status as ChallengeEntryStatus,
    selectionVersionHash: row.selectionVersionHash ?? undefined,
    forfeitedAt: row.forfeitedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    pointsAwarded: row.pointsAwarded
  };
}

function rowToEvent(row: ScreenTimeEventRow): ScreenTimeEvent {
  return {
    id: row.clientEventId,
    entryID: row.entryId,
    deviceID: row.deviceId,
    type: row.type as ScreenTimeEventType,
    selectionVersionHash: row.selectionVersionHash ?? undefined,
    clientOccurredAt: row.clientOccurredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString()
  };
}
