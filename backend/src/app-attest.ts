import { eq } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { appAttestKeys } from "./db/schema.js";
import {
  AppAttestValidationError,
  AppAttestValidator,
  ValidationResult
} from "./app-attest-validator.js";

/**
 * In-process challenge store. Each challenge is a 32-byte random base64url
 * string with a 5-minute TTL. After successful attestation the challenge is
 * marked consumed so it can't be replayed.
 *
 * For 6.1a this is intentionally in-memory: a server restart drops outstanding
 * challenges, which forces clients to fetch a fresh one. 6.1b can swap this
 * for a Postgres-backed store if we need cross-instance durability.
 */
export class ChallengeStore {
  private readonly ttlMs: number;
  private readonly issued = new Map<string, { issuedAt: number; consumed: boolean }>();

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  issue(now: number = Date.now()): { challenge: string; expiresAt: string } {
    this.gc(now);
    const challenge = randomBytes(32).toString("base64url");
    this.issued.set(challenge, { issuedAt: now, consumed: false });
    return {
      challenge,
      expiresAt: new Date(now + this.ttlMs).toISOString()
    };
  }

  /** Returns true iff the challenge was previously issued, unexpired, and unconsumed. Marks it consumed. */
  consume(challenge: string, now: number = Date.now()): boolean {
    this.gc(now);
    const record = this.issued.get(challenge);
    if (!record) return false;
    if (record.consumed) return false;
    if (now - record.issuedAt > this.ttlMs) return false;
    record.consumed = true;
    return true;
  }

  /** Test helper. */
  size(): number {
    return this.issued.size;
  }

  private gc(now: number): void {
    for (const [key, record] of this.issued) {
      if (now - record.issuedAt > this.ttlMs) {
        this.issued.delete(key);
      }
    }
  }
}

interface AttestBody {
  keyId?: unknown;
  attestation?: unknown;
  challenge?: unknown;
}

export function registerAppAttestRoutes(
  app: FastifyInstance,
  db: NodePgDatabase | undefined,
  challenges: ChallengeStore,
  validator?: AppAttestValidator
): void {
  app.get("/auth/attest/challenge", async (_req, reply) => {
    if (!db) {
      reply.code(503);
      return { error: "Postgres not configured" };
    }
    return challenges.issue();
  });

  app.post<{ Body: AttestBody }>("/auth/attest", async (req, reply) => {
    if (!db) {
      reply.code(503);
      return { error: "Postgres not configured" };
    }
    const body = req.body ?? {};
    const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
    const attestation = typeof body.attestation === "string" ? body.attestation : "";
    const challenge = typeof body.challenge === "string" ? body.challenge : "";

    if (!keyId || !attestation || !challenge) {
      reply.code(400);
      return { error: "keyId, attestation, and challenge are required" };
    }
    // App Attest keyIds are 32-byte SHA256 digests, base64-encoded → 44 chars.
    // Attestations are CBOR blobs, base64-encoded; expect at least a few hundred bytes.
    if (keyId.length > 256 || attestation.length > 32 * 1024) {
      reply.code(413);
      return { error: "payload too large" };
    }

    if (!challenges.consume(challenge)) {
      reply.code(401);
      return { error: "challenge invalid, already used, or expired" };
    }

    // 6.1b: validate the attestation.
    let validation: ValidationResult | undefined;
    if (validator) {
      try {
        validation = validator.validate({
          attestation: Buffer.from(attestation, "base64"),
          keyId,
          challenge
        });
      } catch (err) {
        if (err instanceof AppAttestValidationError) {
          req.log.warn({ stage: err.stage, msg: err.message }, "app-attest validation failed");
          reply.code(401);
          return { error: `attestation validation failed: ${err.stage}` };
        }
        throw err;
      }
    }

    // Idempotent insert: same keyId from a re-attestation is a no-op.
    const existing = await db
      .select({ id: appAttestKeys.id })
      .from(appAttestKeys)
      .where(eq(appAttestKeys.keyId, keyId))
      .limit(1);

    const validatedFields = validation
      ? {
          publicKey: validation.publicKey,
          environment: validation.environment,
          validatedAt: new Date(),
          assertionCounter: 0
        }
      : {};

    if (existing[0]) {
      await db
        .update(appAttestKeys)
        .set({ attestation, challenge, ...validatedFields })
        .where(eq(appAttestKeys.keyId, keyId));
      reply.code(200);
      return { id: existing[0].id, status: "updated", validated: !!validation };
    }

    const [row] = await db
      .insert(appAttestKeys)
      .values({ keyId, attestation, challenge, ...validatedFields })
      .returning({ id: appAttestKeys.id });
    reply.code(201);
    return { id: row.id, status: "created", validated: !!validation };
  });
}
