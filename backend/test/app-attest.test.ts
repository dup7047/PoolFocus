import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify from "fastify";
import pg from "pg";
import { ChallengeStore, registerAppAttestRoutes } from "../src/app-attest.js";
import { appAttestKeys } from "../src/db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("App Attest tests skipped (DATABASE_URL not set).");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const challenges = new ChallengeStore();
const app = Fastify({ logger: false });
registerAppAttestRoutes(app, db, challenges);

const testKeyIds: string[] = [];

const fakeKeyId = (): string => {
  const id = randomBytes(32).toString("base64");
  testKeyIds.push(id);
  return id;
};
const fakeAttestation = () => randomBytes(512).toString("base64");

try {
  await app.ready();

  // ---- ChallengeStore unit-level checks ---------------------------------
  {
    const store = new ChallengeStore(60_000);
    const issued = store.issue();
    assert.match(issued.challenge, /^[A-Za-z0-9_-]+$/, "challenge is base64url");
    assert.equal(store.consume(issued.challenge), true, "first consume succeeds");
    assert.equal(store.consume(issued.challenge), false, "replay rejected");
    assert.equal(store.consume("not-a-real-challenge"), false, "unknown challenge rejected");

    // Expired challenge.
    const t0 = 1_000_000;
    const expired = store.issue(t0);
    assert.equal(store.consume(expired.challenge, t0 + 60_001), false, "expired challenge rejected");
  }

  // ---- HTTP: GET /auth/attest/challenge -----------------------------------
  const challengeRes = await app.inject({ method: "GET", url: "/auth/attest/challenge" });
  assert.equal(challengeRes.statusCode, 200, "challenge endpoint returns 200");
  const challengeBody = challengeRes.json() as { challenge: string; expiresAt: string };
  assert.ok(challengeBody.challenge && challengeBody.challenge.length >= 32, "challenge present");
  assert.ok(!Number.isNaN(Date.parse(challengeBody.expiresAt)), "expiresAt parses");

  // ---- POST /auth/attest happy path ---------------------------------------
  const keyId = fakeKeyId();
  const attestation = fakeAttestation();
  const attestRes = await app.inject({
    method: "POST",
    url: "/auth/attest",
    payload: { keyId, attestation, challenge: challengeBody.challenge }
  });
  assert.equal(attestRes.statusCode, 201, `expected 201, got ${attestRes.statusCode}: ${attestRes.body}`);
  const attestBody = attestRes.json() as { id: string; status: string };
  assert.equal(attestBody.status, "created");

  const dbRow = await db
    .select()
    .from(appAttestKeys)
    .where(eq(appAttestKeys.keyId, keyId))
    .limit(1);
  assert.equal(dbRow.length, 1, "row persisted");
  assert.equal(dbRow[0].attestation, attestation);
  assert.equal(dbRow[0].validatedAt, null, "validatedAt is null until 6.1b");
  assert.equal(dbRow[0].publicKey, null, "publicKey is null until 6.1b");

  // ---- Replay rejection: same challenge can't be reused -------------------
  const replay = await app.inject({
    method: "POST",
    url: "/auth/attest",
    payload: { keyId: fakeKeyId(), attestation: fakeAttestation(), challenge: challengeBody.challenge }
  });
  assert.equal(replay.statusCode, 401, "replayed challenge rejected with 401");

  // ---- Re-attestation: same keyId + a fresh challenge → updates row -------
  const fresh = (await app.inject({ method: "GET", url: "/auth/attest/challenge" })).json() as { challenge: string };
  const newAttestation = fakeAttestation();
  const reAttest = await app.inject({
    method: "POST",
    url: "/auth/attest",
    payload: { keyId, attestation: newAttestation, challenge: fresh.challenge }
  });
  assert.equal(reAttest.statusCode, 200, "re-attest returns 200 (update)");
  const reAttestBody = reAttest.json() as { status: string };
  assert.equal(reAttestBody.status, "updated");
  const updated = await db.select().from(appAttestKeys).where(eq(appAttestKeys.keyId, keyId)).limit(1);
  assert.equal(updated[0].attestation, newAttestation, "attestation overwritten on re-attest");

  // ---- Validation errors --------------------------------------------------
  const noKey = await app.inject({ method: "POST", url: "/auth/attest", payload: { attestation: "x", challenge: "y" } });
  assert.equal(noKey.statusCode, 400);
  const huge = await app.inject({
    method: "POST",
    url: "/auth/attest",
    payload: { keyId: "x".repeat(257), attestation: "y", challenge: "z" }
  });
  assert.equal(huge.statusCode, 413, "oversized keyId rejected");

  // ===== With validator wired (proves /auth/attest enforces validation) =====
  // Build a real synthetic attestation using the same machinery as the
  // validator unit test, then POST it through the HTTP endpoint and verify
  // the row gets validated_at + public_key set.
  const { default: makeValidatorFixture } = await import("./_attest-fixture-helper.js");
  const validated = await makeValidatorFixture();

  const validatorApp = Fastify({ logger: false });
  const challenges2 = new ChallengeStore();
  const { AppAttestValidator } = await import("../src/app-attest-validator.js");
  registerAppAttestRoutes(
    validatorApp,
    db,
    challenges2,
    new AppAttestValidator({
      appId: validated.appId,
      trustedRootsPEM: [validated.rootPem]
    })
  );
  await validatorApp.ready();

  const ch = (await validatorApp.inject({ method: "GET", url: "/auth/attest/challenge" })).json() as { challenge: string };
  // Re-build attestation with the server-issued challenge bound into it.
  const real = await validated.buildWithChallenge(ch.challenge);
  const post = await validatorApp.inject({
    method: "POST",
    url: "/auth/attest",
    payload: {
      keyId: real.keyId.toString("base64"),
      attestation: real.attestation.toString("base64"),
      challenge: ch.challenge
    }
  });
  testKeyIds.push(real.keyId.toString("base64"));
  assert.equal(post.statusCode, 201, `POST attest with real validation: ${post.body}`);
  const postBody = post.json() as { validated: boolean };
  assert.equal(postBody.validated, true, "endpoint reports validated:true");

  const dbRowReal = await db
    .select()
    .from(appAttestKeys)
    .where(eq(appAttestKeys.keyId, real.keyId.toString("base64")))
    .limit(1);
  assert.ok(dbRowReal[0].publicKey && dbRowReal[0].publicKey.length > 0, "publicKey persisted");
  assert.equal(dbRowReal[0].environment, "production");
  assert.notEqual(dbRowReal[0].validatedAt, null);

  // Tampered attestation → 401
  const ch2 = (await validatorApp.inject({ method: "GET", url: "/auth/attest/challenge" })).json() as { challenge: string };
  const real2 = await validated.buildWithChallenge(ch2.challenge);
  const tamperedAttestation = Buffer.from(real2.attestation);
  tamperedAttestation[10] ^= 0xff;
  const bad = await validatorApp.inject({
    method: "POST",
    url: "/auth/attest",
    payload: {
      keyId: real2.keyId.toString("base64"),
      attestation: tamperedAttestation.toString("base64"),
      challenge: ch2.challenge
    }
  });
  assert.equal(bad.statusCode, 401, `tampered attestation should be rejected: ${bad.body}`);

  await validatorApp.close();

  console.log("App Attest tests passed");
} finally {
  // Cleanup any test rows we inserted, then close.
  for (const id of testKeyIds) {
    await db.delete(appAttestKeys).where(eq(appAttestKeys.keyId, id));
  }
  await app.close();
  await pool.end();
}
