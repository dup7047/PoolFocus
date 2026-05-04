import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Reusable timestamp helpers — UTC-stored, ISO-emitted by drizzle.
const createdAt = () =>
  timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`);

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`);

export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  appleUserId: text("apple_user_id").notNull().unique(),
  displayName: text("display_name"),
  email: text("email").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const devices = pgTable(
  "devices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceIdentifier: text("device_identifier").notNull(),
    platform: text("platform").notNull().default("ios"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex("devices_user_device_identifier_unique").on(
      t.userId,
      t.deviceIdentifier
    )
  ]
);

export const pools = pgTable("pools", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    // restrict: don't allow deleting a user who still owns a pool
    .references(() => users.id, { onDelete: "restrict" }),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const poolMembers = pgTable(
  "pool_members",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    poolId: uuid("pool_id")
      .notNull()
      .references(() => pools.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`)
  },
  (t) => [
    uniqueIndex("pool_members_pool_user_unique").on(t.poolId, t.userId)
  ]
);

export const poolInvites = pgTable("pool_invites", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  poolId: uuid("pool_id")
    .notNull()
    .references(() => pools.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null"
  }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  consumedByUserId: uuid("consumed_by_user_id").references(() => users.id, {
    onDelete: "set null"
  }),
  createdAt: createdAt()
});

export const challengeDays = pgTable("challenge_days", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  poolId: uuid("pool_id")
    .notNull()
    .references(() => pools.id, { onDelete: "cascade" }),
  challengeStartUtc: timestamp("challenge_start_utc", { withTimezone: true }).notNull(),
  challengeEndUtc: timestamp("challenge_end_utc", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const challengeEntries = pgTable(
  "challenge_entries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    challengeDayId: uuid("challenge_day_id")
      .notNull()
      .references(() => challengeDays.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("pending_config"),
    selectionVersionHash: text("selection_version_hash"),
    forfeitedAt: timestamp("forfeited_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    pointsAwarded: integer("points_awarded").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex("challenge_entries_day_user_unique").on(t.challengeDayId, t.userId)
  ]
);

export const screenTimeEvents = pgTable(
  "screen_time_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => challengeEntries.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    clientEventId: text("client_event_id").notNull(),
    type: text("type").notNull(),
    selectionVersionHash: text("selection_version_hash"),
    clientOccurredAt: timestamp("client_occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`)
  },
  (t) => [
    uniqueIndex("screen_time_events_entry_client_event_unique").on(
      t.entryId,
      t.clientEventId
    )
  ]
);

// App Attest: Apple-issued public-key attestation that a key was generated on
// genuine Apple hardware running our app. Persisted pre-auth (we don't have a
// user yet at first launch). Validation of the CBOR attestation + X.509 chain
// happens in chunk 6.1b; until then `validatedAt` and `publicKey` stay null.
export const appAttestKeys = pgTable("app_attest_keys", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  keyId: text("key_id").notNull().unique(),
  attestation: text("attestation").notNull(),
  challenge: text("challenge").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  // Public key (DER-encoded SPKI, base64) extracted from the credential
  // certificate during 6.1b validation. Used for verifying assertions in 6.2.
  publicKey: text("public_key"),
  // App Attest environment from the attestation (`appattest` for production,
  // `appattestdevelop` for development builds).
  environment: text("environment"),
  // Last assertion counter we accepted. Strictly monotonic; an incoming
  // assertion with counter <= this value is rejected as a replay.
  assertionCounter: integer("assertion_counter").notNull().default(0)
});

export type AppAttestKeyRow = typeof appAttestKeys.$inferSelect;
export type NewAppAttestKey = typeof appAttestKeys.$inferInsert;

export type ChallengeDayRow = typeof challengeDays.$inferSelect;
export type NewChallengeDay = typeof challengeDays.$inferInsert;
export type ChallengeEntryRow = typeof challengeEntries.$inferSelect;
export type NewChallengeEntry = typeof challengeEntries.$inferInsert;
export type ScreenTimeEventRow = typeof screenTimeEvents.$inferSelect;
export type NewScreenTimeEvent = typeof screenTimeEvents.$inferInsert;

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PoolRow = typeof pools.$inferSelect;
export type NewPool = typeof pools.$inferInsert;
export type PoolMemberRow = typeof poolMembers.$inferSelect;
export type NewPoolMember = typeof poolMembers.$inferInsert;
export type PoolInviteRow = typeof poolInvites.$inferSelect;
export type NewPoolInvite = typeof poolInvites.$inferInsert;
export type DeviceRow = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
