import "reflect-metadata";
import { encode as encodeCBOR } from "cbor-x";
import { createHash, KeyObject, webcrypto as nodeWebcrypto } from "node:crypto";
import * as x509 from "@peculiar/x509";

const webcrypto = nodeWebcrypto as unknown as Crypto;
x509.cryptoProvider.set(webcrypto);

const APP_ID = "ABCDE12345.com.example.PoolFocusTest";
const AAGUID_PROD = Buffer.from("appattest\0\0\0\0\0\0\0", "ascii");

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

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

interface BuildOpts {
  challenge: string;
}
interface Built {
  attestation: Buffer;
  keyId: Buffer;
  ecPrivateKey: KeyObject;
  ecPublicKeyDer: Buffer;
}

interface FixtureBundle {
  appId: string;
  rootPem: string;
  buildWithChallenge: (challenge: string) => Promise<Built>;
}

/**
 * Builds a stable test PKI (root + intermediate signed by root) and returns a
 * factory that can build attestations bound to any server-issued challenge,
 * sharing the same root + intermediate so the chain stays valid across calls.
 */
export default async function makeValidatorFixture(): Promise<FixtureBundle> {
  // Stable root + intermediate.
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
    issuer: "CN=Test Root",
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: interKeys.publicKey,
    signingKey: rootKeys.privateKey
  });

  return {
    appId: APP_ID,
    rootPem: rootCert.toString("pem"),
    buildWithChallenge: async (challenge: string): Promise<Built> => {
      // Fresh leaf keypair per attestation.
      const leafKeys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const leafPubSpki = await webcrypto.subtle.exportKey("spki", leafKeys.publicKey);
      const leafPubDer = Buffer.from(leafPubSpki);
      const credentialId = sha256(leafPubDer);

      const rpIdHash = sha256(Buffer.from(APP_ID, "utf8"));
      const flags = Buffer.from([0x40]);
      const counter = Buffer.alloc(4);
      const credIdLen = Buffer.alloc(2);
      credIdLen.writeUInt16BE(credentialId.length, 0);
      const cosePub = encodeCBOR({});
      const authData = Buffer.concat([rpIdHash, flags, counter, AAGUID_PROD, credIdLen, credentialId, cosePub]);

      const challengeHash = sha256(Buffer.from(challenge, "utf8"));
      const nonce = sha256(Buffer.concat([authData, challengeHash]));
      const innerOctet = derOctetString(nonce);
      const explicitTag = derTag(0xa0, innerOctet);
      const seq = derSequence(explicitTag);

      const leafCert = await x509.X509CertificateGenerator.create({
        serialNumber: "03",
        subject: "CN=Test CredCert",
        issuer: "CN=Test Intermediate",
        notBefore: new Date(Date.now() - 60_000),
        notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
        publicKey: leafKeys.publicKey,
        signingKey: interKeys.privateKey,
        extensions: [
          new x509.Extension(
            "1.2.840.113635.100.8.2",
            false,
            seq.buffer.slice(seq.byteOffset, seq.byteOffset + seq.byteLength) as ArrayBuffer
          )
        ]
      });

      const attestation = Buffer.from(
        encodeCBOR({
          fmt: "apple-appattest",
          attStmt: {
            x5c: [
              Buffer.from(leafCert.rawData),
              Buffer.from(interCert.rawData),
              Buffer.from(rootCert.rawData)
            ],
            receipt: Buffer.from([])
          },
          authData
        })
      );

      const leafPrivPkcs8 = await webcrypto.subtle.exportKey("pkcs8", leafKeys.privateKey);
      const { createPrivateKey } = await import("node:crypto");
      const ecPriv = createPrivateKey({ key: Buffer.from(leafPrivPkcs8), format: "der", type: "pkcs8" });

      return { attestation, keyId: credentialId, ecPrivateKey: ecPriv, ecPublicKeyDer: leafPubDer };
    }
  };
}
