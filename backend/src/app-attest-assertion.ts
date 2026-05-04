import { decode as decodeCBOR } from "cbor-x";
import { createHash, createPublicKey, createVerify } from "node:crypto";

/**
 * Apple App Attest assertion validator. Implements the assertion-side of
 *  https://developer.apple.com/documentation/devicecheck/establishing_your_app_s_integrity
 *
 * An assertion CBOR has two fields:
 *   { signature: Buffer, authenticatorData: Buffer }
 *
 * The signature is over `SHA256(authenticatorData || clientDataHash)`,
 * verified with the EC P-256 public key we stored during attestation.
 *
 * authenticatorData layout (37 bytes):
 *   rpIdHash (32) | flags (1) | counter (4 BE)
 *
 * Counter must strictly exceed the last value we accepted for that key.
 */
export interface AssertionInput {
  /** CBOR-encoded assertion blob. */
  assertion: Buffer;
  /** Base64-encoded SubjectPublicKeyInfo from validation step. */
  publicKeyDerBase64: string;
  /** SHA-256 hash of the clientData (request body bytes, no assertion). */
  clientDataHash: Buffer;
  /** Expected RP ID hash, == SHA256(appId). */
  expectedRpIdHash: Buffer;
  /** Last counter value we accepted; assertion must have a strictly larger one. */
  lastCounter: number;
}

export interface AssertionResult {
  newCounter: number;
}

export class AppAttestAssertionError extends Error {
  constructor(message: string, public readonly stage: string) {
    super(`[${stage}] ${message}`);
    this.name = "AppAttestAssertionError";
  }
}

export function validateAssertion(input: AssertionInput): AssertionResult {
  let outer: { signature?: Buffer; authenticatorData?: Buffer };
  try {
    outer = decodeCBOR(input.assertion) as typeof outer;
  } catch (err) {
    throw new AppAttestAssertionError(`CBOR decode failed: ${(err as Error).message}`, "cbor");
  }
  if (!outer.signature || !outer.authenticatorData) {
    throw new AppAttestAssertionError("missing signature or authenticatorData", "cbor");
  }

  const authData = Buffer.from(outer.authenticatorData);
  const signature = Buffer.from(outer.signature);

  if (authData.length !== 37) {
    throw new AppAttestAssertionError(`authenticatorData expected 37 bytes, got ${authData.length}`, "authdata");
  }

  const rpIdHash = authData.subarray(0, 32);
  const counter = authData.readUInt32BE(33);

  if (!rpIdHash.equals(input.expectedRpIdHash)) {
    throw new AppAttestAssertionError("rpIdHash does not match expected app id", "rpid");
  }
  if (counter <= input.lastCounter) {
    throw new AppAttestAssertionError(
      `counter not monotonic (got ${counter}, last accepted ${input.lastCounter})`,
      "counter"
    );
  }

  // Verify the ECDSA-SHA256 signature over (authenticatorData || clientDataHash).
  const signedPayload = Buffer.concat([authData, input.clientDataHash]);
  const publicKey = createPublicKey({
    key: Buffer.from(input.publicKeyDerBase64, "base64"),
    format: "der",
    type: "spki"
  });
  const verifier = createVerify("SHA256");
  verifier.update(signedPayload);
  verifier.end();
  const ok = verifier.verify(publicKey, signature);
  if (!ok) {
    throw new AppAttestAssertionError("signature verification failed", "signature");
  }

  return { newCounter: counter };
}

/** SHA-256 of a request body for use as `clientDataHash`. */
export function clientDataHashOf(body: Buffer | string): Buffer {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  return createHash("sha256").update(buf).digest();
}
