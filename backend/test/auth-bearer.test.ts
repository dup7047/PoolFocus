import "dotenv/config";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!(globalThis as { crypto?: unknown }).crypto) {
  (globalThis as { crypto?: unknown }).crypto = webcrypto;
}
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify from "fastify";
import { SignJWT } from "jose";
import pg from "pg";
import { BackendJWT } from "../src/auth-jwt.js";
import {
  challengeDays as challengeDaysTable,
  devices as devicesTable,
  pools as poolsTable,
  users as usersTable
} from "../src/db/schema.js";
import { PgRepository } from "../src/pg-repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.log("skipped: DATABASE_URL not set"); process.exit(0); }

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const SECRET = "auth-bearer-test-secret-which-is-clearly-32-chars-long";
const jwt = new BackendJWT({ secret: SECRET });
const requireAuth = jwt.preHandler();
const repository = new PgRepository(db);

// Build a tiny Fastify app with one protected route, mirroring server.ts.
const app = Fastify({ logger: false });
app.post(
  "/challenge/readiness",
  { preHandler: [requireAuth] },
  async (req) => {
    const userID = (req.body as { userID?: string }).userID!;
    const challengeDayID = (req.body as { challengeDayID?: string }).challengeDayID!;
    const entry = await repository.upsertEntry({
      id: "00000000-0000-0000-0000-000000000000",
      challengeDayID,
      userID,
      displayName: "T",
      status: "ready",
      pointsAwarded: 0
    });
    return { entry, callerSubject: (req as { userId?: string }).userId };
  }
);
await app.ready();

// Bootstrap minimal fixtures so the protected handler can do real work.
const cleanupAppleId = `bearer.${Math.random().toString(36).slice(2, 10)}`;
const [user] = await db
  .insert(usersTable)
  .values({ appleUserId: cleanupAppleId, displayName: "B" })
  .returning();
const [poolRow] = await db
  .insert(poolsTable)
  .values({ name: "T", ownerUserId: user.id })
  .returning();
await db.insert(devicesTable).values({ userId: user.id, deviceIdentifier: "d" });
const [day] = await db
  .insert(challengeDaysTable)
  .values({ poolId: poolRow.id, challengeStartUtc: new Date(), challengeEndUtc: new Date(Date.now()+3600_000) })
  .returning();

let passed = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};

console.log("Bearer-token enforcement on protected routes");

await test("missing Authorization header → 401", async () => {
  const r = await app.inject({
    method: "POST", url: "/challenge/readiness",
    payload: { userID: user.id, challengeDayID: day.id, deviceID: "d", selectionVersionHash: "v1" }
  });
  assert.equal(r.statusCode, 401);
  assert.match(r.body, /missing Bearer/);
});

await test("malformed Authorization (not 'Bearer ...') → 401", async () => {
  const r = await app.inject({
    method: "POST", url: "/challenge/readiness",
    headers: { authorization: "Basic abc" },
    payload: { userID: user.id, challengeDayID: day.id, deviceID: "d", selectionVersionHash: "v1" }
  });
  assert.equal(r.statusCode, 401);
});

await test("tampered JWT → 401", async () => {
  const { token } = await jwt.sign(user.id);
  const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  const r = await app.inject({
    method: "POST", url: "/challenge/readiness",
    headers: { authorization: `Bearer ${tampered}` },
    payload: { userID: user.id, challengeDayID: day.id, deviceID: "d", selectionVersionHash: "v1" }
  });
  assert.equal(r.statusCode, 401);
  assert.match(r.body, /invalid or expired/);
});

await test("expired JWT → 401", async () => {
  const expired = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("poolfocus-backend")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(new TextEncoder().encode(SECRET));
  const r = await app.inject({
    method: "POST", url: "/challenge/readiness",
    headers: { authorization: `Bearer ${expired}` },
    payload: { userID: user.id, challengeDayID: day.id, deviceID: "d", selectionVersionHash: "v1" }
  });
  assert.equal(r.statusCode, 401);
  assert.match(r.body, /invalid or expired/);
});

await test("JWT signed by a different secret → 401", async () => {
  const evil = new BackendJWT({ secret: "a-different-secret-that-is-still-32-chars-long-yep" });
  const { token } = await evil.sign(user.id);
  const r = await app.inject({
    method: "POST", url: "/challenge/readiness",
    headers: { authorization: `Bearer ${token}` },
    payload: { userID: user.id, challengeDayID: day.id, deviceID: "d", selectionVersionHash: "v1" }
  });
  assert.equal(r.statusCode, 401);
});

await test("valid JWT → 200 + handler sees userId", async () => {
  const { token } = await jwt.sign(user.id);
  const r = await app.inject({
    method: "POST", url: "/challenge/readiness",
    headers: { authorization: `Bearer ${token}` },
    payload: { userID: user.id, challengeDayID: day.id, deviceID: "d", selectionVersionHash: "v1" }
  });
  assert.equal(r.statusCode, 200, `body=${r.body}`);
  const body = r.json() as { callerSubject: string };
  assert.equal(body.callerSubject, user.id);
});

console.log(`\nBearer auth tests: ${passed}/6 passed`);

// Cleanup
await db.delete(poolsTable).where(eq(poolsTable.id, poolRow.id));
await db.delete(usersTable).where(eq(usersTable.id, user.id));
await app.close();
await pool.end();
if (process.exitCode) process.exit(process.exitCode);
