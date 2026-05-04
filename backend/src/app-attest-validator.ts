import { decode as decodeCBOR } from "cbor-x";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Apple App Attest attestation validator. Implements the algorithm from
 *   https://developer.apple.com/documentation/devicecheck/validating_apps_that_connect_to_your_server
 *
 * Each step here is unit-tested with synthetic fixtures (test root CA, our
 * own EC keypair, hand-built authData, hand-built certs with the Apple OID).
 * The single path that requires a real-device attestation to exercise is
 * "x5c chain rooted at the *Apple* App Attestation Root CA". That path is
 * exercised via test/fixtures/real-attestation.json if you drop a captured
 * attestation in there; otherwise that one test is skipped.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

// AAGUIDs Apple publishes for App Attest (16 bytes, ASCII + null padding).
const AAGUID_PROD = Buffer.from("appattest\0\0\0\0\0\0\0", "ascii");
const AAGUID_DEV = Buffer.from("appattestdevelop", "ascii");

// OID 1.2.840.113635.100.8.2 in DER: 06 09 2A 86 48 86 F7 63 64 08 02.
const NONCE_OID_DER = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);

export interface AppAttestValidatorOptions {
  /** "<TeamID>.<bundleId>", e.g. "ABCDE12345.com.example.MyApp" */
  appId: string;
  /** Roots to anchor the x5c chain at. Defaults to Apple's published root. */
  trustedRootsPEM?: string[];
  /** Permit attestations from development builds (`appattestdevelop` aaguid). */
  allowDevelopment?: boolean;
}

export interface ValidationResult {
  /** EC P-256 public key, DER-encoded SubjectPublicKeyInfo (base64). */
  publicKey: string;
  environment: "production" | "development";
  counter: number;
  /** SHA-256 of the public key — equals the keyId the client sent. */
  keyIdentifier: string;
}

export class AppAttestValidationError extends Error {
  constructor(message: string, public readonly stage: string) {
    super(`[${stage}] ${message}`);
    this.name = "AppAttestValidationError";
  }
}

export class AppAttestValidator {
  private readonly appIdHash: Buffer;
  private readonly trustedRoots: X509Certificate[];
  private readonly allowDevelopment: boolean;

  constructor(opts: AppAttestValidatorOptions) {
    this.appIdHash = sha256(Buffer.from(opts.appId, "utf8"));
    this.allowDevelopment = opts.allowDevelopment ?? false;
    const rootsPEM = opts.trustedRootsPEM ?? [defaultAppleRootPEM()];
    this.trustedRoots = rootsPEM.map((pem) => new X509Certificate(pem));
  }

  validate(input: { attestation: Buffer; keyId: string; challenge: string }): ValidationResult {
    const { attestation, keyId, challenge } = input;

    // 1. CBOR decode the outer attestation object.
    let outer: { fmt?: string; attStmt?: { x5c?: Buffer[]; receipt?: Buffer }; authData?: Buffer };
    try {
      outer = decodeCBOR(attestation) as typeof outer;
    } catch (err) {
      throw new AppAttestValidationError(`CBOR decode failed: ${(err as Error).message}`, "cbor");
    }
    if (outer.fmt !== "apple-appattest") {
      throw new AppAttestValidationError(`unexpected fmt: ${outer.fmt}`, "cbor");
    }
    if (!outer.attStmt?.x5c || outer.attStmt.x5c.length === 0) {
      throw new AppAttestValidationError("missing x5c", "cbor");
    }
    if (!outer.authData) {
      throw new AppAttestValidationError("missing authData", "cbor");
    }

    const authData = Buffer.from(outer.authData);
    const x5cDER = outer.attStmt.x5c.map((b) => Buffer.from(b));

    // 2. Validate the X.509 chain back to a trusted root.
    const credCert = this.verifyChain(x5cDER);

    // 3. Compute nonce = SHA256(authData || SHA256(challenge)) and
    //    verify it matches the OID 1.2.840.113635.100.8.2 extension.
    const clientDataHash = sha256(Buffer.from(challenge, "utf8"));
    const expectedNonce = sha256(Buffer.concat([authData, clientDataHash]));
    const certNonce = extractAppleNonceOID(credCert);
    if (!certNonce.equals(expectedNonce)) {
      throw new AppAttestValidationError("nonce mismatch (cert OID vs computed)", "nonce");
    }

    // 4. Parse authData byte structure.
    const parsed = parseAuthData(authData);

    // 5. Verify rpId hash == SHA256(appId).
    if (!parsed.rpIdHash.equals(this.appIdHash)) {
      throw new AppAttestValidationError("rpId hash does not match appId", "rpid");
    }

    // 6. Counter must be 0 on the attestation step.
    if (parsed.counter !== 0) {
      throw new AppAttestValidationError(`counter must be 0 on attestation; got ${parsed.counter}`, "counter");
    }

    // 7. aaguid must be production or (with opt-in) development.
    let environment: "production" | "development";
    if (parsed.aaguid.equals(AAGUID_PROD)) {
      environment = "production";
    } else if (parsed.aaguid.equals(AAGUID_DEV)) {
      if (!this.allowDevelopment) {
        throw new AppAttestValidationError("development aaguid not allowed", "aaguid");
      }
      environment = "development";
    } else {
      throw new AppAttestValidationError(`unrecognized aaguid: ${parsed.aaguid.toString("hex")}`, "aaguid");
    }

    // 8. Extract pubkey from credCert; verify SHA256(pubKey SPKI) == credentialId.
    const publicKeyDer = exportPublicKeyDER(credCert);
    const computedKeyIdentifier = sha256(publicKeyDer);
    if (!computedKeyIdentifier.equals(parsed.credentialId)) {
      throw new AppAttestValidationError("credentialId does not match SHA256(publicKey)", "keyid");
    }

    // 9. Verify the keyId the client sent matches the credentialId.
    const expectedKeyIdBuf = Buffer.from(keyId, "base64");
    if (!expectedKeyIdBuf.equals(parsed.credentialId)) {
      throw new AppAttestValidationError("client-supplied keyId does not match credentialId", "keyid");
    }

    return {
      publicKey: publicKeyDer.toString("base64"),
      environment,
      counter: parsed.counter,
      keyIdentifier: computedKeyIdentifier.toString("base64")
    };
  }

  private verifyChain(x5c: Buffer[]): X509Certificate {
    const certs = x5c.map((der) => new X509Certificate(der));

    // Walk the chain: certs[i] must be signed by certs[i+1].publicKey.
    for (let i = 0; i < certs.length - 1; i++) {
      const ok = certs[i].verify(certs[i + 1].publicKey);
      if (!ok) {
        throw new AppAttestValidationError(`chain link ${i}→${i + 1} signature invalid`, "x5c");
      }
    }

    // The last cert in the chain must match (or be signed by) one of our trusted roots.
    const top = certs[certs.length - 1];
    const matched = this.trustedRoots.some((root) => {
      // Same cert? (e.g. root included in x5c)
      if (Buffer.compare(top.raw, root.raw) === 0) return true;
      try {
        return top.verify(root.publicKey);
      } catch {
        return false;
      }
    });
    if (!matched) {
      throw new AppAttestValidationError("chain does not anchor at a trusted root", "x5c");
    }

    return certs[0];
  }
}

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

interface ParsedAuthData {
  rpIdHash: Buffer;
  flags: number;
  counter: number;
  aaguid: Buffer;
  credentialId: Buffer;
  credentialPublicKey: Buffer;
}

function parseAuthData(buf: Buffer): ParsedAuthData {
  if (buf.length < 37) {
    throw new AppAttestValidationError(`authData too short: ${buf.length}`, "authdata");
  }
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf.readUInt8(32);
  const counter = buf.readUInt32BE(33);
  if (buf.length < 37 + 18) {
    throw new AppAttestValidationError("authData missing attested credential data", "authdata");
  }
  const aaguid = buf.subarray(37, 37 + 16);
  const credIdLen = buf.readUInt16BE(37 + 16);
  const credIdStart = 37 + 16 + 2;
  if (buf.length < credIdStart + credIdLen) {
    throw new AppAttestValidationError("authData truncated before credentialId", "authdata");
  }
  const credentialId = buf.subarray(credIdStart, credIdStart + credIdLen);
  const credentialPublicKey = buf.subarray(credIdStart + credIdLen);
  return { rpIdHash, flags, counter, aaguid, credentialId, credentialPublicKey };
}

/**
 * Extract the Apple App Attest nonce extension from a cert by walking its
 * DER bytes. The extension structure inside the Extensions sequence is:
 *   SEQUENCE {
 *     OBJECT IDENTIFIER 1.2.840.113635.100.8.2  -- our marker
 *     [critical BOOLEAN]                        -- optional
 *     OCTET STRING { SEQUENCE { [0] OCTET STRING(nonce) } }
 *   }
 */
function extractAppleNonceOID(cert: X509Certificate): Buffer {
  const der = Buffer.from(cert.raw);
  const idx = indexOfBuffer(der, NONCE_OID_DER);
  if (idx < 0) {
    throw new AppAttestValidationError("cert missing Apple nonce OID", "nonce");
  }
  // After the OID, optionally a BOOLEAN (critical), then an OCTET STRING wrapping
  // the value. Find the next OCTET STRING tag (0x04) after the OID.
  let cursor = idx + NONCE_OID_DER.length;
  // Skip optional BOOLEAN (tag 0x01, len 0x01, val 0x00 or 0xff).
  if (der[cursor] === 0x01 && der[cursor + 1] === 0x01) {
    cursor += 3;
  }
  if (der[cursor] !== 0x04) {
    throw new AppAttestValidationError("OID extnValue is not OCTET STRING", "nonce");
  }
  const outer = readDERLength(der, cursor + 1);
  const outerStart = cursor + 1 + outer.headerBytes;
  const outerEnd = outerStart + outer.length;
  // Inside outer OCTET STRING: SEQUENCE { [0] EXPLICIT OCTET STRING(nonce) }
  if (der[outerStart] !== 0x30) {
    throw new AppAttestValidationError("inner is not SEQUENCE", "nonce");
  }
  const seqLen = readDERLength(der, outerStart + 1);
  let inner = outerStart + 1 + seqLen.headerBytes;
  // Walk SEQUENCE children. Look for the deepest 32-byte OCTET STRING.
  const candidates: Buffer[] = [];
  while (inner < outerEnd) {
    const tag = der[inner];
    const lenInfo = readDERLength(der, inner + 1);
    const valStart = inner + 1 + lenInfo.headerBytes;
    const valEnd = valStart + lenInfo.length;
    // Recurse into constructed types or context-specific tags.
    if ((tag & 0x20) !== 0 || (tag & 0xc0) === 0x80) {
      collectOctetStrings(der.subarray(valStart, valEnd), candidates);
    } else if (tag === 0x04 && lenInfo.length === 32) {
      candidates.push(Buffer.from(der.subarray(valStart, valEnd)));
    }
    inner = valEnd;
  }
  if (candidates.length === 0) {
    throw new AppAttestValidationError("no 32-byte OCTET STRING in nonce extension", "nonce");
  }
  return candidates[candidates.length - 1];
}

function collectOctetStrings(buf: Buffer, out: Buffer[]) {
  let i = 0;
  while (i < buf.length) {
    if (i + 2 > buf.length) break;
    const tag = buf[i];
    const lenInfo = readDERLength(buf, i + 1);
    if (lenInfo.headerBytes < 0) break;
    const start = i + 1 + lenInfo.headerBytes;
    const end = start + lenInfo.length;
    if (end > buf.length) break;
    if (tag === 0x04 && lenInfo.length === 32) {
      out.push(Buffer.from(buf.subarray(start, end)));
    }
    if ((tag & 0x20) !== 0 || (tag & 0xc0) === 0x80) {
      collectOctetStrings(buf.subarray(start, end), out);
    }
    i = end;
  }
}

function readDERLength(buf: Buffer, at: number): { length: number; headerBytes: number } {
  const first = buf[at];
  if (first === undefined) return { length: 0, headerBytes: -1 };
  if ((first & 0x80) === 0) {
    return { length: first, headerBytes: 1 };
  }
  const numBytes = first & 0x7f;
  if (numBytes === 0 || numBytes > 4) {
    return { length: 0, headerBytes: -1 };
  }
  let len = 0;
  for (let i = 0; i < numBytes; i++) {
    len = (len << 8) | buf[at + 1 + i];
  }
  return { length: len, headerBytes: 1 + numBytes };
}

function indexOfBuffer(haystack: Buffer, needle: Buffer): number {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

function exportPublicKeyDER(cert: X509Certificate): Buffer {
  return cert.publicKey.export({ format: "der", type: "spki" }) as Buffer;
}

let cachedAppleRoot: string | undefined;
function defaultAppleRootPEM(): string {
  if (cachedAppleRoot) return cachedAppleRoot;
  const candidates = [
    join(__dirname, "secrets/AppAttest_RootCA.pem"),
    join(__dirname, "../src/secrets/AppAttest_RootCA.pem"),
    join(__dirname, "../../src/secrets/AppAttest_RootCA.pem")
  ];
  for (const p of candidates) {
    try {
      cachedAppleRoot = readFileSync(p, "utf8");
      return cachedAppleRoot;
    } catch {
      /* try next */
    }
  }
  throw new Error("Apple App Attest Root CA PEM not found at src/secrets/AppAttest_RootCA.pem.");
}

export { X509Certificate };
