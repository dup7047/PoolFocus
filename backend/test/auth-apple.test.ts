import "dotenv/config";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

// jose uses globalThis.crypto.subtle; expose Node 18's webcrypto.
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
import { users } from "../src/db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("Apple auth tests skipped (DATABASE_URL not set).");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const AUDIENCE = "com.example.PoolFocusTest";
const JWT_SECRET = "test-jwt-secret-must-be-at-least-32-chars-long-please";

// Build an RSA keypair to stand in for Apple's signing key. JWKS contains the
// public half; we sign tokens with the private half.
const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = "test-key-1";
publicJwk.use = "sig";
publicJwk.alg = "RS256";
const jwks: { keys: JWK[] } = { keys: [publicJwk] };

const verifier = new AppleTokenVerifier({ audience: AUDIENCE, jwks });
const jwt = new BackendJWT({ secret: JWT_SECRET });

const app = Fastify({ logger: false });
registerAppleAuthRoutes(app, db, verifier, jwt);
await app.ready();

const cleanupAppleIds: string[] = [];

interface MintOpts {
  sub?: string;
  audience?: string;
  issuer?: string;
  expiresInSec?: number;
  notBeforeSec?: number;
  email?: string;
  unsignedAlg?: string; // for malformed-token tests
}
async function mintAppleToken(opts: MintOpts = {}): Promise<string> {
  const sub = opts.sub ?? `001234.${Math.random().toString(36).slice(2, 12)}.0001`;
  cleanupAppleIds.push(sub);
  const aud = opts.audience ?? AUDIENCE;
  const iss = opts.issuer ?? "https://appleid.apple.com";
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.expiresInSec ?? 600);
  const builder = new SignJWT({
    sub,
    email: opts.email,
    email_verified: opts.email ? true : undefined,
    is_private_email: false
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1", typ: "JWT" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt(now)
    .setExpirationTime(exp);
  if (opts.notBeforeSec) builder.setNotBefore(opts.notBeforeSec);
  return builder.sign(privateKey);
}

let passed = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};

console.log("BackendJWT");
await test("sign + verify round-trip", async () => {
  const j = new BackendJWT({ secret: JWT_SECRET });
  const userId = "11111111-1111-1111-1111-111111111111";
  const { token, expiresAt } = await j.sign(userId);
  const payload = await j.verify(token);
  assert.equal(payload.sub, userId);
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
  assert.ok(new Date(expiresAt).getTime() > Date.now());
});
await test("verify rejects token signed by a different secret", async () => {
  const issuer = new BackendJWT({ secret: "the-original-secret-which-is-32-chars-long" });
  const checker = new BackendJWT({ secret: "a-totally-different-secret-which-is-32-chars" });
  const { token } = await issuer.sign("x");
  await assert.rejects(() => checker.verify(token));
});
await test("rejects too-short secret at construction", () => {
  assert.throws(() => new BackendJWT({ secret: "short" }), /at least 32 chars/);
  return Promise.resolve();
});

console.log("\n/auth/apple");

await test("happy path: valid token → 200 + user upserted + JWT verifiable", async () => {
  const sub = `001234.${Math.random().toString(36).slice(2, 14)}.0001`;
  cleanupAppleIds.push(sub);
  const token = await mintAppleToken({ sub, email: "test1@example.com" });
  const r = await app.inject({
    method: "POST", url: "/auth/apple",
    payload: {
      identityToken: token,
      fullName: { givenName: "Ada", familyName: "Lovelace" }
    }
  });
  assert.equal(r.statusCode, 200, `body=${r.body}`);
  const body = r.json() as { token: string; user: { id: string; displayName: string; email: string } };
  assert.match(body.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  // Backend JWT decodes with the same secret.
  const decoded = await jwt.verify(body.token);
  assert.equal(decoded.sub, body.user.id);

  // Row persisted.
  const row = await db.select().from(users).where(eq(users.appleUserId, sub)).limit(1);
  assert.equal(row[0].displayName, "Ada Lovelace");
  assert.equal(row[0].email, "test1@example.com");
  assert.equal(row[0].id, body.user.id);
});

await test("idempotent: second sign-in returns the same user.id", async () => {
  const sub = `001234.${Math.random().toString(36).slice(2, 14)}.0002`;
  cleanupAppleIds.push(sub);
  const t1 = await mintAppleToken({ sub, email: "test2@example.com" });
  const r1 = await app.inject({ method: "POST", url: "/auth/apple", payload: { identityToken: t1, fullName: { givenName: "Linus" } } });
  assert.equal(r1.statusCode, 200);
  const body1 = r1.json() as { user: { id: string } };

  // Second sign-in: Apple stops sending email/name. Our row should keep them.
  const t2 = await mintAppleToken({ sub });
  const r2 = await app.inject({ method: "POST", url: "/auth/apple", payload: { identityToken: t2 } });
  assert.equal(r2.statusCode, 200);
  const body2 = r2.json() as { user: { id: string; displayName: string; email: string } };
  assert.equal(body2.user.id, body1.user.id, "same user id across sign-ins");
  assert.equal(body2.user.displayName, "Linus", "displayName preserved on second sign-in");
  assert.equal(body2.user.email, "test2@example.com", "email preserved on second sign-in");
});

await test("rejects: expired token → 401", async () => {
  const token = await mintAppleToken({ expiresInSec: -60 });
  const r = await app.inject({ method: "POST", url: "/auth/apple", payload: { identityToken: token } });
  assert.equal(r.statusCode, 401, `body=${r.body}`);
});

await test("rejects: wrong issuer → 401", async () => {
  const token = await mintAppleToken({ issuer: "https://example.evil/iss" });
  const r = await app.inject({ method: "POST", url: "/auth/apple", payload: { identityToken: token } });
  assert.equal(r.statusCode, 401);
});

await test("rejects: wrong audience → 401", async () => {
  const token = await mintAppleToken({ audience: "com.somebody.else" });
  const r = await app.inject({ method: "POST", url: "/auth/apple", payload: { identityToken: token } });
  assert.equal(r.statusCode, 401);
});

await test("rejects: signed by a different private key → 401", async () => {
  const evil = await generateKeyPair("RS256", { extractable: true });
  const sub = `001234.${Math.random().toString(36).slice(2, 14)}.0003`;
  cleanupAppleIds.push(sub);
  const token = await new SignJWT({ sub })
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1", typ: "JWT" })
    .setIssuer("https://appleid.apple.com")
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(evil.privateKey);
  const r = await app.inject({ method: "POST", url: "/auth/apple", payload: { identityToken: token } });
  assert.equal(r.statusCode, 401);
});

await test("rejects: kid not in JWKS → 401", async () => {
  const sub = `001234.${Math.random().toString(36).slice(2, 14)}.0004`;
  cleanupAppleIds.push(sub);
  const token = await new SignJWT({ sub })
    .setProtectedHeader({ alg: "RS256", kid: "unknown-kid", typ: "JWT" })
    .setIssuer("https://appleid.apple.com")
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(privateKey);
  const r = await app.inject({ method: "POST", url: "/auth/apple", payload: { identityToken: token } });
  assert.equal(r.statusCode, 401);
});

await test("rejects: malformed JWT → 401", async () => {
  const r = await app.inject({ method: "POST", url: "/auth/apple", payload: { identityToken: "not.a.real.jwt" } });
  assert.equal(r.statusCode, 401);
});

await test("rejects: missing identityToken → 400", async () => {
  const r = await app.inject({ method: "POST", url: "/auth/apple", payload: {} });
  assert.equal(r.statusCode, 400);
});

await test("rejects: oversized identityToken → 413", async () => {
  const r = await app.inject({ method: "POST", url: "/auth/apple", payload: { identityToken: "x".repeat(20000) } });
  assert.equal(r.statusCode, 413);
});

console.log(`\nApple auth tests: ${passed}/13 passed`);

// Cleanup
for (const sub of cleanupAppleIds) {
  await db.delete(users).where(eq(users.appleUserId, sub));
}
await app.close();
await pool.end();
if (process.exitCode) process.exit(process.exitCode);
