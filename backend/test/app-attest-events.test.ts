import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, sign as ecSign, webcrypto as nodeWebcrypto } from "node:crypto";
import { encode as encodeCBOR } from "cbor-x";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as x509 from "@peculiar/x509";
import { appAttestKeys } from "../src/db/schema.js";
import makeValidatorFixture from "./_attest-fixture-helper.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.log("skipped: DATABASE_URL not set"); process.exit(0); }

const webcrypto = nodeWebcrypto as unknown as Crypto;
x509.cryptoProvider.set(webcrypto);

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

const fixture = await makeValidatorFixture();
const APP_ID = fixture.appId;

// Spawn the server with APP_ATTEST_REQUIRED + APP_ATTEST_APP_ID set.
process.env.APP_ATTEST_APP_ID = APP_ID;
process.env.APP_ATTEST_REQUIRED = "true";
process.env.APP_ATTEST_ALLOW_DEV = "false";
process.env.LOG_LEVEL = "silent";

const Fastify = (await import("fastify")).default;
const { ChallengeStore, registerAppAttestRoutes } = await import("../src/app-attest.js");
const { AppAttestValidator } = await import("../src/app-attest-validator.js");
const {
  AppAttestAssertionError,
  clientDataHashOf,
  validateAssertion
} = await import("../src/app-attest-assertion.js");

const challenges = new ChallengeStore();
const validator = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fixture.rootPem] });

const app = Fastify({ logger: false });
app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (_req, body, done) => {
    const buf = body as Buffer;
    (_req as { rawBody?: Buffer }).rawBody = buf;
    try {
      done(null, buf.length === 0 ? {} : JSON.parse(buf.toString("utf8")));
    } catch (e) { done(e as Error, undefined); }
  }
);
registerAppAttestRoutes(app, db, challenges, validator);

// Reproduce the inline /challenge/events handler logic here for the test
// (we don't want to spin up the full server with TCP).
app.post("/challenge/events", async (req, reply) => {
  const keyId = req.headers["x-appattest-keyid"] as string | undefined;
  const assertionB64 = req.headers["x-appattest-assertion"] as string | undefined;
  if (!keyId || !assertionB64) { reply.code(401); return { error: "required" }; }
  const rows = await db.select().from(appAttestKeys).where(eq(appAttestKeys.keyId, keyId)).limit(1);
  const row = rows[0];
  if (!row || !row.publicKey) { reply.code(401); return { error: "unknown" }; }
  const rawBody = (req as { rawBody?: Buffer }).rawBody!;
  try {
    const result = validateAssertion({
      assertion: Buffer.from(assertionB64, "base64"),
      publicKeyDerBase64: row.publicKey,
      clientDataHash: clientDataHashOf(rawBody),
      expectedRpIdHash: sha256(Buffer.from(APP_ID, "utf8")),
      lastCounter: row.assertionCounter
    });
    await db.update(appAttestKeys).set({ assertionCounter: result.newCounter }).where(eq(appAttestKeys.keyId, keyId));
  } catch (err) {
    if (err instanceof AppAttestAssertionError) {
      reply.code(401); return { error: `assertion: ${err.stage}` };
    }
    throw err;
  }
  reply.code(202); return { ok: true };
});

await app.ready();

const cleanupKeyIds: string[] = [];
async function cleanup() {
  for (const id of cleanupKeyIds) {
    await db.delete(appAttestKeys).where(eq(appAttestKeys.keyId, id));
  }
  await app.close();
  await pool.end();
}

let passed = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};

console.log("/challenge/events with App Attest assertion enforcement");

try {
  // Bootstrap: do a real attest first to plant a keyId + publicKey.
  const ch = (await app.inject({ method: "GET", url: "/auth/attest/challenge" })).json() as { challenge: string };
  const built = await fixture.buildWithChallenge(ch.challenge);
  cleanupKeyIds.push(built.keyId.toString("base64"));

  const attestResp = await app.inject({
    method: "POST", url: "/auth/attest",
    payload: { keyId: built.keyId.toString("base64"), attestation: built.attestation.toString("base64"), challenge: ch.challenge }
  });
  assert.equal(attestResp.statusCode, 201, `attest: ${attestResp.body}`);

  const stored = await db.select().from(appAttestKeys).where(eq(appAttestKeys.keyId, built.keyId.toString("base64"))).limit(1);
  assert.ok(stored[0].publicKey, "publicKey should be set after validation");

  // Helper: build an assertion bound to a given (rawBody, counter).
  const rpIdHash = sha256(Buffer.from(APP_ID, "utf8"));
  function buildAssertion(opts: { rawBody: Buffer; counter: number }) {
    const flags = Buffer.from([0x00]);
    const counter = Buffer.alloc(4); counter.writeUInt32BE(opts.counter, 0);
    const authenticatorData = Buffer.concat([rpIdHash, flags, counter]);
    const cdh = sha256(opts.rawBody);
    const sig = ecSign("SHA256", Buffer.concat([authenticatorData, cdh]), built.ecPrivateKey);
    return encodeCBOR({ signature: Buffer.from(sig), authenticatorData });
  }

  await test("missing assertion → 401", async () => {
    const r = await app.inject({ method: "POST", url: "/challenge/events", payload: { event: { id: "x" } } });
    assert.equal(r.statusCode, 401);
  });

  await test("happy: assertion bound to body succeeds", async () => {
    const body = { event: { id: "evt-1", entryID: "e", deviceID: "d", type: "shield_unlock", clientOccurredAt: new Date().toISOString() } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const assertion = buildAssertion({ rawBody, counter: 1 });
    const r = await app.inject({
      method: "POST", url: "/challenge/events",
      headers: {
        "x-appattest-keyid": built.keyId.toString("base64"),
        "x-appattest-assertion": Buffer.from(assertion).toString("base64"),
        "content-type": "application/json"
      },
      payload: rawBody
    });
    assert.equal(r.statusCode, 202, `body=${r.body}`);
  });

  await test("counter not monotonic → 401", async () => {
    const body = { event: { id: "evt-2" } };
    const rawBody = Buffer.from(JSON.stringify(body));
    // Counter is now stored as 1; reuse 1 → must reject.
    const assertion = buildAssertion({ rawBody, counter: 1 });
    const r = await app.inject({
      method: "POST", url: "/challenge/events",
      headers: {
        "x-appattest-keyid": built.keyId.toString("base64"),
        "x-appattest-assertion": Buffer.from(assertion).toString("base64"),
        "content-type": "application/json"
      },
      payload: rawBody
    });
    assert.equal(r.statusCode, 401);
    assert.match(r.body, /counter/);
  });

  await test("tampered body → 401", async () => {
    const body = { event: { id: "evt-3" } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const assertion = buildAssertion({ rawBody, counter: 2 });
    // Send a different body than the assertion was bound to.
    const r = await app.inject({
      method: "POST", url: "/challenge/events",
      headers: {
        "x-appattest-keyid": built.keyId.toString("base64"),
        "x-appattest-assertion": Buffer.from(assertion).toString("base64"),
        "content-type": "application/json"
      },
      payload: Buffer.from(JSON.stringify({ event: { id: "evt-tampered" } }))
    });
    assert.equal(r.statusCode, 401);
    assert.match(r.body, /signature/);
  });

  await test("unknown keyId → 401", async () => {
    const body = { event: { id: "evt-4" } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const assertion = buildAssertion({ rawBody, counter: 99 });
    const r = await app.inject({
      method: "POST", url: "/challenge/events",
      headers: {
        "x-appattest-keyid": Buffer.alloc(32, 0xaa).toString("base64"),
        "x-appattest-assertion": Buffer.from(assertion).toString("base64"),
        "content-type": "application/json"
      },
      payload: rawBody
    });
    assert.equal(r.statusCode, 401);
    assert.match(r.body, /unknown/);
  });

  console.log(`\n/challenge/events tests: ${passed}/5 passed`);
} finally {
  await cleanup();
}
