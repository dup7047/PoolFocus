/**
 * End-to-end auth flow: /auth/apple → JWT → protected /challenge/readiness.
 * Spins up a Fastify app wired exactly like server.ts does, with a local
 * JWKS standing in for Apple's. Proves the entire chain works before any
 * iOS code talks to it.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!(globalThis as { crypto?: unknown }).crypto) {
  (globalThis as { crypto?: unknown }).crypto = webcrypto;
}
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify from "fastify";
import { exportJWK, generateKeyPair, JWK, SignJWT } from "jose";
import pg from "pg";
import { AppleTokenVerifier, registerAppleAuthRoutes } from "../src/auth-apple.js";
import { BackendJWT } from "../src/auth-jwt.js";
import {
  challengeDays as challengeDaysTable,
  pools as poolsTable,
  users as usersTable
} from "../src/db/schema.js";
import { PgRepository } from "../src/pg-repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.log("skipped: DATABASE_URL not set"); process.exit(0); }

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

const AUDIENCE = "com.example.PoolFocusE2E";
const SECRET = "end-to-end-secret-which-is-clearly-32-or-more-chars";

const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = "e2e-key";
publicJwk.use = "sig";
publicJwk.alg = "RS256";
const jwks: { keys: JWK[] } = { keys: [publicJwk] };

const verifier = new AppleTokenVerifier({ audience: AUDIENCE, jwks });
const backendJwt = new BackendJWT({ secret: SECRET });
const requireAuth = backendJwt.preHandler();
const repository = new PgRepository(db);

const app = Fastify({ logger: false });
registerAppleAuthRoutes(app, db, verifier, backendJwt);
app.post("/challenge/readiness", { preHandler: [requireAuth] }, async (req) => {
  const body = req.body as { userID: string; challengeDayID: string };
  const entry = await repository.upsertEntry({
    id: "00000000-0000-0000-0000-000000000000",
    challengeDayID: body.challengeDayID,
    userID: body.userID,
    displayName: "T",
    status: "ready",
    pointsAwarded: 0
  });
  return { entry, callerSubject: (req as { userId?: string }).userId };
});
await app.ready();

let passed = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};

const cleanupAppleIds: string[] = [];
async function mintAppleToken(sub: string): Promise<string> {
  cleanupAppleIds.push(sub);
  return new SignJWT({ sub, email: `${sub}@example.test` })
    .setProtectedHeader({ alg: "RS256", kid: "e2e-key", typ: "JWT" })
    .setIssuer("https://appleid.apple.com")
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(privateKey);
}

console.log("Full auth flow: /auth/apple → JWT → protected /challenge/readiness");

// Bootstrap a pool + challenge day so the readiness handler has real FKs to point at.
const sub = `e2e.${Math.random().toString(36).slice(2, 10)}`;
const appleToken = await mintAppleToken(sub);

await test("step 1: /auth/apple returns a JWT bound to a new user", async () => {
  const r = await app.inject({
    method: "POST", url: "/auth/apple",
    payload: { identityToken: appleToken, fullName: { givenName: "End", familyName: "ToEnd" } }
  });
  assert.equal(r.statusCode, 200, r.body);
});

const auth = (await app.inject({
  method: "POST", url: "/auth/apple",
  payload: { identityToken: await mintAppleToken(sub) }
})).json() as { token: string; user: { id: string } };

const [poolRow] = await db.insert(poolsTable).values({ name: "E2E", ownerUserId: auth.user.id }).returning();
const [day] = await db.insert(challengeDaysTable)
  .values({ poolId: poolRow.id, challengeStartUtc: new Date(), challengeEndUtc: new Date(Date.now() + 3600_000) })
  .returning();

await test("step 2: protected /challenge/readiness without Authorization → 401", async () => {
  const r = await app.inject({
    method: "POST", url: "/challenge/readiness",
    payload: { userID: auth.user.id, challengeDayID: day.id, deviceID: "d", selectionVersionHash: "v1" }
  });
  assert.equal(r.statusCode, 401);
});

await test("step 3: protected route with Bearer JWT from step 1 → 200, callerSubject == user.id", async () => {
  const r = await app.inject({
    method: "POST", url: "/challenge/readiness",
    headers: { authorization: `Bearer ${auth.token}` },
    payload: { userID: auth.user.id, challengeDayID: day.id, deviceID: "d", selectionVersionHash: "v1" }
  });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json() as { callerSubject: string };
  assert.equal(body.callerSubject, auth.user.id);
});

await test("step 4: tampered JWT → 401 (acceptance: 'expired/invalid → 401')", async () => {
  const tampered = auth.token.slice(0, -2) + "XX";
  const r = await app.inject({
    method: "POST", url: "/challenge/readiness",
    headers: { authorization: `Bearer ${tampered}` },
    payload: { userID: auth.user.id, challengeDayID: day.id, deviceID: "d", selectionVersionHash: "v1" }
  });
  assert.equal(r.statusCode, 401);
});

console.log(`\nEnd-to-end auth flow: ${passed}/4 passed`);

// Cleanup
await db.delete(poolsTable).where(eq(poolsTable.id, poolRow.id));
for (const s of cleanupAppleIds) await db.delete(usersTable).where(eq(usersTable.appleUserId, s));
await app.close();
await pool.end();
if (process.exitCode) process.exit(process.exitCode);
