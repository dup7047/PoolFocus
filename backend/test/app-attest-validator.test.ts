import "reflect-metadata";
import "dotenv/config";
import assert from "node:assert/strict";
import { encode as encodeCBOR } from "cbor-x";
import {
  createHash,
  generateKeyPairSync,
  KeyObject,
  sign as ecSign,
  verify as ecVerify
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as x509 from "@peculiar/x509";
import { webcrypto as nodeWebcrypto } from "node:crypto";
import { AppAttestValidationError, AppAttestValidator } from "../src/app-attest-validator.js";
import {
  AppAttestAssertionError,
  clientDataHashOf,
  validateAssertion
} from "../src/app-attest-assertion.js";

// peculiar/x509 needs a WebCrypto provider; Node 18+ exposes one.
const webcrypto = nodeWebcrypto as unknown as Crypto;
x509.cryptoProvider.set(webcrypto);

const APP_ID = "ABCDE12345.com.example.PoolFocusTest";
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
const AAGUID_PROD = Buffer.from("appattest\0\0\0\0\0\0\0", "ascii");
const AAGUID_DEV = Buffer.from("appattestdevelop", "ascii");

interface TestPKI {
  rootPem: string;
  x5cDer: Buffer[]; // [leaf, intermediate, root]
  ecKeyPair: { privateKey: KeyObject; publicKey: KeyObject };
}

// Build a 3-cert chain: root → intermediate → leaf credCert. The leaf's
// pubKey is an EC P-256 key we own (so we can also produce assertions).
// The leaf carries the Apple nonce OID extension. Caller can request
// brokenChain (intermediate signed by itself) or brokenNonce (wrong nonce).
async function buildTestPKI(opts: {
  authData: Buffer;
  challenge: Buffer;
  brokenChain?: boolean;
  brokenNonce?: boolean;
}): Promise<TestPKI> {
  // Test root
  const rootKeys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rootCert = await x509.X509CertificateGenerator.create({
    serialNumber: "01",
    subject: "CN=Test Root",
    issuer: "CN=Test Root",
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: rootKeys.publicKey,
    signingKey: rootKeys.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true)
    ]
  });

  // Intermediate
  const interKeys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const interCert = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=Test Intermediate",
    issuer: opts.brokenChain ? "CN=Test Intermediate" : "CN=Test Root",
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: interKeys.publicKey,
    // brokenChain → self-sign instead of being signed by the root
    signingKey: opts.brokenChain ? interKeys.privateKey : rootKeys.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true)
    ]
  });

  // Leaf credCert with our EC keypair as the SPKI, plus the Apple nonce OID.
  const leafKeysWebCrypto = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

  const clientDataHash = sha256(opts.challenge);
  const realNonce = sha256(Buffer.concat([opts.authData, clientDataHash]));
  const tamperedNonce = sha256(Buffer.from("not-the-right-nonce"));
  const nonce = opts.brokenNonce ? tamperedNonce : realNonce;

  // OID extnValue: SEQUENCE { [0] EXPLICIT OCTET STRING(nonce) }
  // Encode manually as DER so we don't fight peculiar/asn1 schema generics.
  const innerOctet = derOctetString(nonce);
  const explicitTag = derTag(0xa0, innerOctet); // [0] EXPLICIT
  const seq = derSequence(explicitTag);
  // Outer extnValue is OCTET STRING wrapping the sequence.
  const extnValue = seq; // peculiar wraps in OCTET STRING for us

  const leafCert = await x509.X509CertificateGenerator.create({
    serialNumber: "03",
    subject: "CN=Test CredCert",
    issuer: "CN=Test Intermediate",
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: leafKeysWebCrypto.publicKey,
    signingKey: interKeys.privateKey,
    extensions: [
      new x509.Extension("1.2.840.113635.100.8.2", false, extnValue.buffer.slice(extnValue.byteOffset, extnValue.byteOffset + extnValue.byteLength) as ArrayBuffer)
    ]
  });

  // Convert leaf EC keypair to Node KeyObjects so tests can sign assertions later.
  const leafPrivPkcs8 = await webcrypto.subtle.exportKey("pkcs8", leafKeysWebCrypto.privateKey);
  const leafPubSpki = await webcrypto.subtle.exportKey("spki", leafKeysWebCrypto.publicKey);
  const { createPrivateKey, createPublicKey } = await import("node:crypto");
  const ecPriv = createPrivateKey({ key: Buffer.from(leafPrivPkcs8), format: "der", type: "pkcs8" });
  const ecPub = createPublicKey({ key: Buffer.from(leafPubSpki), format: "der", type: "spki" });

  return {
    rootPem: rootCert.toString("pem"),
    x5cDer: [Buffer.from(leafCert.rawData), Buffer.from(interCert.rawData), Buffer.from(rootCert.rawData)],
    ecKeyPair: { privateKey: ecPriv, publicKey: ecPub }
  };
}

// --- DER helpers (only what we need for the OID extension) ---
function derLength(len: number): Uint8Array {
  if (len < 128) return new Uint8Array([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) { bytes.unshift(n & 0xff); n >>>= 8; }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}
function derOctetString(value: Uint8Array | Buffer): Uint8Array {
  const v = value instanceof Buffer ? new Uint8Array(value) : value;
  const len = derLength(v.length);
  const out = new Uint8Array(1 + len.length + v.length);
  out[0] = 0x04; out.set(len, 1); out.set(v, 1 + len.length);
  return out;
}
function derSequence(value: Uint8Array): Uint8Array {
  const len = derLength(value.length);
  const out = new Uint8Array(1 + len.length + value.length);
  out[0] = 0x30; out.set(len, 1); out.set(value, 1 + len.length);
  return out;
}
function derTag(tag: number, value: Uint8Array): Uint8Array {
  const len = derLength(value.length);
  const out = new Uint8Array(1 + len.length + value.length);
  out[0] = tag; out.set(len, 1); out.set(value, 1 + len.length);
  return out;
}

function buildAuthData(opts: {
  appId?: string;
  counter?: number;
  aaguid?: Buffer;
  credentialId: Buffer;
  rpIdHashOverride?: Buffer;
}): Buffer {
  const appId = opts.appId ?? APP_ID;
  const rpIdHash = opts.rpIdHashOverride ?? sha256(Buffer.from(appId, "utf8"));
  const flags = Buffer.from([0x40]);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(opts.counter ?? 0, 0);
  const aaguid = opts.aaguid ?? AAGUID_PROD;
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(opts.credentialId.length, 0);
  const cosePub = encodeCBOR({});
  return Buffer.concat([rpIdHash, flags, counter, aaguid, credIdLen, opts.credentialId, cosePub]);
}

async function buildAttestation(opts: {
  appId?: string;
  challenge?: Buffer;
  counter?: number;
  aaguid?: Buffer;
  brokenChain?: boolean;
  brokenNonce?: boolean;
  rpIdHashOverride?: Buffer;
}): Promise<{
  attestation: Buffer;
  rootPem: string;
  keyId: Buffer;
  challenge: Buffer;
  ecPrivateKey: KeyObject;
  ecPublicKeyDer: Buffer;
}> {
  const challenge = opts.challenge ?? Buffer.from("the-challenge", "utf8");
  // Round 1: build cert chain just to get the leaf pubkey → credentialId.
  const placeholder = Buffer.alloc(37 + 16 + 2 + 32 + 2);
  const tmp = await buildTestPKI({ authData: placeholder, challenge });
  const leafPubDer = tmp.ecKeyPair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const credentialId = sha256(leafPubDer);

  const authData = buildAuthData({
    appId: opts.appId,
    counter: opts.counter ?? 0,
    aaguid: opts.aaguid,
    credentialId,
    rpIdHashOverride: opts.rpIdHashOverride
  });

  // Round 2: rebuild PKI with the real authData so the OID nonce binds to it.
  // We must re-use the same EC keypair so credentialId still matches.
  // To do that, we'll import the previous leaf private key into webcrypto
  // and pass it back. But that's complex; simpler: regenerate, accept that
  // the second leaf has a *different* keypair. Since credentialId is a hash
  // of the leaf pubkey, we recompute it after building round 2's PKI.
  const pki = await buildTestPKI({
    authData,
    challenge,
    brokenChain: opts.brokenChain,
    brokenNonce: opts.brokenNonce
  });
  const leaf2PubDer = pki.ecKeyPair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const credentialId2 = sha256(leaf2PubDer);

  // Re-derive authData with the round-2 credentialId so the nonce we just
  // committed in the cert OID actually matches.
  // BUT: the OID nonce was computed over `authData` (round 1's credentialId).
  // We need authData to use credentialId2 AND the OID nonce to be
  // SHA256(authData2 || SHA256(challenge)). Round 2's PKI was built with
  // round 1's authData. So the nonce will *not* match.
  //
  // Solution: pull credentialId2 out, build authData2, then build PKI **again**
  // with authData2 → consistent. Regenerates the EC keypair a third time, so
  // credentialId changes again. This converges only by fixing the leaf keypair.
  //
  // Workaround: pass an explicit `authData` AND tell buildTestPKI which leaf
  // pubkey to use. Simpler: do a final pass that re-builds PKI with the
  // pre-determined credentialId by reusing the keypair from round 2.

  const finalAuthData = buildAuthData({
    appId: opts.appId,
    counter: opts.counter ?? 0,
    aaguid: opts.aaguid,
    credentialId: credentialId2,
    rpIdHashOverride: opts.rpIdHashOverride
  });

  // Reuse pki.ecKeyPair: build a new leaf with the same key + recomputed nonce.
  const challengeHash = sha256(challenge);
  const finalNonce = sha256(Buffer.concat([finalAuthData, challengeHash]));
  const finalNonceUsed = opts.brokenNonce ? sha256(Buffer.from("not-the-right-nonce")) : finalNonce;

  const innerOctet = derOctetString(finalNonceUsed);
  const explicitTag = derTag(0xa0, innerOctet);
  const seq = derSequence(explicitTag);
  const extnValue = seq; // peculiar wraps in OCTET STRING for us

  // Re-create the leaf cert using the existing keypair from `pki`.
  const leafKeysAsCryptoKey = await importKeyPairToWebCrypto(pki.ecKeyPair);

  // Re-create root + intermediate too — we'll use pki's chain but re-issue
  // the leaf with the corrected nonce. To keep the chain consistent, we
  // need the intermediate's *private* key as well, which `buildTestPKI`
  // didn't return. Easiest: re-run the whole PKI build but force the leaf
  // keypair. So extend buildTestPKI to take an optional leafKeyPair.
  const finalPki = await buildTestPKIWithLeafKey({
    authData: finalAuthData,
    challenge,
    brokenChain: opts.brokenChain,
    brokenNonce: opts.brokenNonce,
    leafKeysWebCrypto: leafKeysAsCryptoKey
  });

  const attestation = encodeCBOR({
    fmt: "apple-appattest",
    attStmt: { x5c: finalPki.x5cDer, receipt: Buffer.from([]) },
    authData: finalAuthData
  });

  return {
    attestation,
    rootPem: finalPki.rootPem,
    keyId: credentialId2,
    challenge,
    ecPrivateKey: pki.ecKeyPair.privateKey,
    ecPublicKeyDer: leaf2PubDer
  };
}

async function importKeyPairToWebCrypto(kp: { privateKey: KeyObject; publicKey: KeyObject }) {
  const privDer = kp.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  const pubDer = kp.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privAB = privDer.buffer.slice(privDer.byteOffset, privDer.byteOffset + privDer.byteLength) as ArrayBuffer;
  const pubAB = pubDer.buffer.slice(pubDer.byteOffset, pubDer.byteOffset + pubDer.byteLength) as ArrayBuffer;
  const priv = await webcrypto.subtle.importKey("pkcs8", privAB, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const pub = await webcrypto.subtle.importKey("spki", pubAB, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  return { privateKey: priv, publicKey: pub };
}

async function buildTestPKIWithLeafKey(opts: {
  authData: Buffer;
  challenge: Buffer;
  brokenChain?: boolean;
  brokenNonce?: boolean;
  leafKeysWebCrypto: { privateKey: CryptoKey; publicKey: CryptoKey };
}): Promise<TestPKI> {
  const rootKeys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rootCert = await x509.X509CertificateGenerator.create({
    serialNumber: "01",
    subject: "CN=Test Root",
    issuer: "CN=Test Root",
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: rootKeys.publicKey,
    signingKey: rootKeys.privateKey
  });
  const interKeys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const interCert = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=Test Intermediate",
    issuer: opts.brokenChain ? "CN=Test Intermediate" : "CN=Test Root",
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: interKeys.publicKey,
    signingKey: opts.brokenChain ? interKeys.privateKey : rootKeys.privateKey
  });

  const challengeHash = sha256(opts.challenge);
  const realNonce = sha256(Buffer.concat([opts.authData, challengeHash]));
  const nonce = opts.brokenNonce ? sha256(Buffer.from("not-the-right-nonce")) : realNonce;
  const innerOctet = derOctetString(nonce);
  const explicitTag = derTag(0xa0, innerOctet);
  const seq = derSequence(explicitTag);
  const extnValue = seq; // peculiar wraps in OCTET STRING for us

  const leafCert = await x509.X509CertificateGenerator.create({
    serialNumber: "03",
    subject: "CN=Test CredCert",
    issuer: "CN=Test Intermediate",
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: opts.leafKeysWebCrypto.publicKey,
    signingKey: interKeys.privateKey,
    extensions: [new x509.Extension("1.2.840.113635.100.8.2", false, extnValue.buffer.slice(extnValue.byteOffset, extnValue.byteOffset + extnValue.byteLength) as ArrayBuffer)]
  });

  const leafPrivPkcs8 = await webcrypto.subtle.exportKey("pkcs8", opts.leafKeysWebCrypto.privateKey);
  const leafPubSpki = await webcrypto.subtle.exportKey("spki", opts.leafKeysWebCrypto.publicKey);
  const { createPrivateKey, createPublicKey } = await import("node:crypto");
  const ecPriv = createPrivateKey({ key: Buffer.from(leafPrivPkcs8), format: "der", type: "pkcs8" });
  const ecPub = createPublicKey({ key: Buffer.from(leafPubSpki), format: "der", type: "spki" });

  return {
    rootPem: rootCert.toString("pem"),
    x5cDer: [Buffer.from(leafCert.rawData), Buffer.from(interCert.rawData), Buffer.from(rootCert.rawData)],
    ecKeyPair: { privateKey: ecPriv, publicKey: ecPub }
  };
}

// ===================== TESTS =====================

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
    process.exitCode = 1;
  }
};

console.log("AppAttestValidator");

await test("happy path", async () => {
  const fix = await buildAttestation({});
  const v = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fix.rootPem] });
  const r = v.validate({
    attestation: fix.attestation,
    keyId: fix.keyId.toString("base64"),
    challenge: fix.challenge.toString("utf8")
  });
  assert.equal(r.environment, "production");
  assert.equal(r.counter, 0);
  assert.equal(r.publicKey, fix.ecPublicKeyDer.toString("base64"));
  assert.equal(r.keyIdentifier, fix.keyId.toString("base64"));
});

await test("development aaguid: rejected by default, accepted when allowed", async () => {
  const fix = await buildAttestation({ aaguid: AAGUID_DEV });
  const strict = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fix.rootPem] });
  assert.throws(
    () => strict.validate({ attestation: fix.attestation, keyId: fix.keyId.toString("base64"), challenge: fix.challenge.toString("utf8") }),
    (e: Error) => e instanceof AppAttestValidationError && e.stage === "aaguid"
  );
  const lenient = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fix.rootPem], allowDevelopment: true });
  const r = lenient.validate({ attestation: fix.attestation, keyId: fix.keyId.toString("base64"), challenge: fix.challenge.toString("utf8") });
  assert.equal(r.environment, "development");
});

await test("rejects: tampered nonce in cert OID", async () => {
  const fix = await buildAttestation({ brokenNonce: true });
  const v = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fix.rootPem] });
  assert.throws(
    () => v.validate({ attestation: fix.attestation, keyId: fix.keyId.toString("base64"), challenge: fix.challenge.toString("utf8") }),
    (e: Error) => e instanceof AppAttestValidationError && e.stage === "nonce"
  );
});

await test("rejects: tampered challenge", async () => {
  const fix = await buildAttestation({});
  const v = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fix.rootPem] });
  assert.throws(
    () => v.validate({ attestation: fix.attestation, keyId: fix.keyId.toString("base64"), challenge: "different-challenge" }),
    (e: Error) => e instanceof AppAttestValidationError && e.stage === "nonce"
  );
});

await test("rejects: chain not anchored at trusted root", async () => {
  const fix = await buildAttestation({});
  const v = new AppAttestValidator({ appId: APP_ID }); // default: real Apple root
  assert.throws(
    () => v.validate({ attestation: fix.attestation, keyId: fix.keyId.toString("base64"), challenge: fix.challenge.toString("utf8") }),
    (e: Error) => e instanceof AppAttestValidationError && e.stage === "x5c"
  );
});

await test("rejects: broken intermediate signature", async () => {
  const fix = await buildAttestation({ brokenChain: true });
  const v = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fix.rootPem] });
  assert.throws(
    () => v.validate({ attestation: fix.attestation, keyId: fix.keyId.toString("base64"), challenge: fix.challenge.toString("utf8") }),
    (e: Error) => e instanceof AppAttestValidationError && e.stage === "x5c"
  );
});

await test("rejects: counter non-zero on attestation", async () => {
  const fix = await buildAttestation({ counter: 1 });
  const v = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fix.rootPem] });
  assert.throws(
    () => v.validate({ attestation: fix.attestation, keyId: fix.keyId.toString("base64"), challenge: fix.challenge.toString("utf8") }),
    (e: Error) => e instanceof AppAttestValidationError && e.stage === "counter"
  );
});

await test("rejects: rpIdHash for wrong app id", async () => {
  const wrong = sha256(Buffer.from("OTHER.com.evil", "utf8"));
  const fix = await buildAttestation({ rpIdHashOverride: wrong });
  const v = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fix.rootPem] });
  assert.throws(
    () => v.validate({ attestation: fix.attestation, keyId: fix.keyId.toString("base64"), challenge: fix.challenge.toString("utf8") }),
    (e: Error) => e instanceof AppAttestValidationError && e.stage === "rpid"
  );
});

await test("rejects: client-supplied keyId does not match credentialId", async () => {
  const fix = await buildAttestation({});
  const v = new AppAttestValidator({ appId: APP_ID, trustedRootsPEM: [fix.rootPem] });
  assert.throws(
    () => v.validate({ attestation: fix.attestation, keyId: Buffer.alloc(32, 0xff).toString("base64"), challenge: fix.challenge.toString("utf8") }),
    (e: Error) => e instanceof AppAttestValidationError && e.stage === "keyid"
  );
});

await test("rejects: malformed CBOR", async () => {
  const v = new AppAttestValidator({ appId: APP_ID });
  assert.throws(
    () => v.validate({ attestation: Buffer.from([0xff, 0x00]), keyId: "x", challenge: "y" }),
    (e: Error) => e instanceof AppAttestValidationError && e.stage === "cbor"
  );
});

const realFixturePath = new URL("./fixtures/real-attestation.json", import.meta.url);
if (existsSync(realFixturePath)) {
  await test("real device attestation validates against Apple root CA", () => {
    const f = JSON.parse(readFileSync(realFixturePath, "utf8")) as { attestation: string; keyId: string; challenge: string; appId: string };
    const v = new AppAttestValidator({ appId: f.appId });
    const r = v.validate({ attestation: Buffer.from(f.attestation, "base64"), keyId: f.keyId, challenge: f.challenge });
    assert.ok(r.publicKey.length > 0);
    assert.equal(r.counter, 0);
  });
} else {
  console.log("  - real-attestation fixture absent (skipped — drop one in test/fixtures/real-attestation.json to enable)");
}

// ===================== 6.2: ASSERTION =====================

console.log("validateAssertion (6.2)");

function buildAssertion(opts: {
  privateKey: KeyObject;
  appId?: string;
  counter: number;
  clientDataHash: Buffer;
  tamperPayload?: boolean;
  rpIdHashOverride?: Buffer;
}): Buffer {
  const appId = opts.appId ?? APP_ID;
  const rpIdHash = opts.rpIdHashOverride ?? sha256(Buffer.from(appId, "utf8"));
  const flags = Buffer.from([0x00]);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(opts.counter, 0);
  const authenticatorData = Buffer.concat([rpIdHash, flags, counter]);
  const signed = Buffer.concat([authenticatorData, opts.clientDataHash]);
  const sig = ecSign("SHA256", signed, opts.privateKey);
  const finalSig = opts.tamperPayload ? Buffer.from(sig).map((b) => b ^ 0xff) : sig;
  return encodeCBOR({ signature: Buffer.from(finalSig), authenticatorData });
}

const assertionKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const assertionPubDer = (assertionKeys.publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64");
const expectedRpIdHash = sha256(Buffer.from(APP_ID, "utf8"));
const requestBody = JSON.stringify({ event: { id: "abc", payload: "x" } });
const cdh = clientDataHashOf(requestBody);

await test("happy path: valid assertion with monotonic counter", () => {
  const a = buildAssertion({ privateKey: assertionKeys.privateKey, counter: 1, clientDataHash: cdh });
  const r = validateAssertion({ assertion: a, publicKeyDerBase64: assertionPubDer, clientDataHash: cdh, expectedRpIdHash, lastCounter: 0 });
  assert.equal(r.newCounter, 1);
});
await test("rejects: counter not monotonic", () => {
  const a = buildAssertion({ privateKey: assertionKeys.privateKey, counter: 5, clientDataHash: cdh });
  assert.throws(
    () => validateAssertion({ assertion: a, publicKeyDerBase64: assertionPubDer, clientDataHash: cdh, expectedRpIdHash, lastCounter: 5 }),
    (e: Error) => e instanceof AppAttestAssertionError && e.stage === "counter"
  );
});
await test("rejects: tampered request body", () => {
  const a = buildAssertion({ privateKey: assertionKeys.privateKey, counter: 2, clientDataHash: cdh });
  const tampered = clientDataHashOf(requestBody + "extra");
  assert.throws(
    () => validateAssertion({ assertion: a, publicKeyDerBase64: assertionPubDer, clientDataHash: tampered, expectedRpIdHash, lastCounter: 1 }),
    (e: Error) => e instanceof AppAttestAssertionError && e.stage === "signature"
  );
});
await test("rejects: corrupted signature", () => {
  const a = buildAssertion({ privateKey: assertionKeys.privateKey, counter: 2, clientDataHash: cdh, tamperPayload: true });
  assert.throws(
    () => validateAssertion({ assertion: a, publicKeyDerBase64: assertionPubDer, clientDataHash: cdh, expectedRpIdHash, lastCounter: 1 }),
    (e: Error) => e instanceof AppAttestAssertionError && e.stage === "signature"
  );
});
await test("rejects: rpIdHash for wrong app", () => {
  const wrong = sha256(Buffer.from("OTHER.com.evil", "utf8"));
  const a = buildAssertion({ privateKey: assertionKeys.privateKey, counter: 2, clientDataHash: cdh, rpIdHashOverride: wrong });
  assert.throws(
    () => validateAssertion({ assertion: a, publicKeyDerBase64: assertionPubDer, clientDataHash: cdh, expectedRpIdHash, lastCounter: 1 }),
    (e: Error) => e instanceof AppAttestAssertionError && e.stage === "rpid"
  );
});
await test("rejects: signed by a different key", () => {
  const evil = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const a = buildAssertion({ privateKey: evil.privateKey, counter: 2, clientDataHash: cdh });
  assert.throws(
    () => validateAssertion({ assertion: a, publicKeyDerBase64: assertionPubDer, clientDataHash: cdh, expectedRpIdHash, lastCounter: 1 }),
    (e: Error) => e instanceof AppAttestAssertionError && e.stage === "signature"
  );
});
await test("rejects: malformed CBOR", () => {
  assert.throws(
    () => validateAssertion({ assertion: Buffer.from([0xff]), publicKeyDerBase64: assertionPubDer, clientDataHash: cdh, expectedRpIdHash, lastCounter: 0 }),
    (e: Error) => e instanceof AppAttestAssertionError && e.stage === "cbor"
  );
});
await test("ecVerify sanity check", () => {
  const data = Buffer.from("ping");
  const sig = ecSign("SHA256", data, assertionKeys.privateKey);
  assert.equal(ecVerify("SHA256", data, assertionKeys.publicKey, sig), true);
});

console.log(`\nAppAttestValidator + Assertion: ${passed} tests ${process.exitCode ? "FAILED" : "passed"}`);
if (process.exitCode) process.exit(process.exitCode);
