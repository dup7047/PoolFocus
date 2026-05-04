import { eq, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { FastifyInstance } from "fastify";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey
} from "jose";
import { users as usersTable } from "./db/schema.js";
import { BackendJWT } from "./auth-jwt.js";

const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");
const APPLE_ISSUER = "https://appleid.apple.com";

export interface AppleVerifierOptions {
  /** Apple Service ID / bundle id we expect tokens to be for. */
  audience: string;
  /** Pre-built JWKS (test-only). If omitted, fetches Apple's live JWKS. */
  jwks?: { keys: JWK[] };
}

export interface AppleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
}

export class AppleTokenVerifier {
  private readonly audience: string;
  private readonly getKey: JWTVerifyGetKey;

  constructor(opts: AppleVerifierOptions) {
    this.audience = opts.audience;
    this.getKey = opts.jwks
      ? createLocalJWKSet(opts.jwks)
      : createRemoteJWKSet(APPLE_JWKS_URL, {
          // jose handles its own caching + per-kid refresh; cooldown limits
          // the rate at which we'll re-fetch on cache miss.
          cooldownDuration: 30_000,
          cacheMaxAge: 10 * 60_000
        });
  }

  async verify(idToken: string): Promise<AppleClaims> {
    const { payload } = await jwtVerify(idToken, this.getKey, {
      issuer: APPLE_ISSUER,
      audience: this.audience
    });
    if (!payload.sub) throw new Error("Apple token missing sub");
    const claims = payload as JWTPayload & AppleClaims;
    return {
      sub: claims.sub,
      email: claims.email,
      email_verified: claims.email_verified,
      is_private_email: claims.is_private_email
    };
  }
}

interface AppleSignInBody {
  identityToken?: unknown;
  fullName?: unknown;
  email?: unknown;
}

interface FullName {
  givenName?: string;
  familyName?: string;
}

function parseFullName(raw: unknown): FullName | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { givenName?: unknown; familyName?: unknown };
  const givenName = typeof r.givenName === "string" ? r.givenName.trim() : undefined;
  const familyName = typeof r.familyName === "string" ? r.familyName.trim() : undefined;
  if (!givenName && !familyName) return undefined;
  return { givenName, familyName };
}

function formatDisplayName(name: FullName): string {
  return [name.givenName, name.familyName].filter(Boolean).join(" ");
}

export function registerAppleAuthRoutes(
  app: FastifyInstance,
  db: NodePgDatabase | undefined,
  verifier: AppleTokenVerifier,
  jwt: BackendJWT
): void {
  app.post<{ Body: AppleSignInBody }>("/auth/apple", async (req, reply) => {
    if (!db) {
      reply.code(503);
      return { error: "Postgres not configured" };
    }
    const body = req.body ?? {};
    const identityToken = typeof body.identityToken === "string" ? body.identityToken : "";
    if (!identityToken) {
      reply.code(400);
      return { error: "identityToken required" };
    }
    if (identityToken.length > 16 * 1024) {
      reply.code(413);
      return { error: "identityToken too large" };
    }

    let claims: AppleClaims;
    try {
      claims = await verifier.verify(identityToken);
    } catch (err) {
      const code = err instanceof joseErrors.JOSEError ? err.code : "verify_failed";
      req.log.warn({ code, msg: (err as Error).message }, "apple token verification failed");
      reply.code(401);
      return { error: `apple token rejected: ${code}` };
    }

    const fullName = parseFullName(body.fullName);
    const displayNameFromBody = fullName ? formatDisplayName(fullName) : undefined;
    const emailFromBody = typeof body.email === "string" && body.email.includes("@")
      ? body.email.trim()
      : undefined;
    // Apple's identityToken includes `email` only on the very first sign-in
    // for that Apple ID. Trust body.email if provided, then fall back.
    const email = emailFromBody ?? (typeof claims.email === "string" ? claims.email : undefined);

    // Upsert by apple_user_id. Don't overwrite displayName/email if they're
    // already set: subsequent sign-ins from Apple won't include name/email.
    const [user] = await db
      .insert(usersTable)
      .values({
        appleUserId: claims.sub,
        displayName: displayNameFromBody ?? null,
        email: email ?? null
      })
      .onConflictDoUpdate({
        target: usersTable.appleUserId,
        set: {
          displayName: sql`COALESCE(${usersTable.displayName}, EXCLUDED.display_name)`,
          email: sql`COALESCE(${usersTable.email}, EXCLUDED.email)`,
          updatedAt: sql`now()`
        }
      })
      .returning();

    const issued = await jwt.sign(user.id);
    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      user: { id: user.id, displayName: user.displayName, email: user.email }
    };
  });
}

/** Convenience for tests that need to round-trip the verifier against /auth/apple's user lookup. */
export async function findUserByAppleId(
  db: NodePgDatabase,
  appleSub: string
): Promise<{ id: string; displayName: string | null; email: string | null } | undefined> {
  const rows = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      email: usersTable.email
    })
    .from(usersTable)
    .where(eq(usersTable.appleUserId, appleSub))
    .limit(1);
  return rows[0];
}
