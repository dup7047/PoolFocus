import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
