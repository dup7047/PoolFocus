import { jwtVerify, SignJWT } from "jose";

/**
 * Backend session JWT (HS256, 30-day expiry). Subject is the user.id (UUID).
 * Single shared secret — fine for single-instance v1; rotate by changing the
 * env var, which invalidates all outstanding tokens.
 */
const ISSUER = "poolfocus-backend";
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface BackendJWTPayload {
  sub: string; // user.id
  iss: string;
  iat: number;
  exp: number;
}

export class BackendJWT {
  private readonly secret: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(opts: { secret: string; ttlSeconds?: number }) {
    if (!opts.secret || opts.secret.length < 32) {
      throw new Error("BackendJWT requires a secret of at least 32 chars");
    }
    this.secret = new TextEncoder().encode(opts.secret);
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  async sign(userId: string): Promise<{ token: string; expiresAt: string }> {
    const now = Math.floor(Date.now() / 1000);
    const expSec = now + this.ttlSeconds;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(expSec)
      .sign(this.secret);
    return { token, expiresAt: new Date(expSec * 1000).toISOString() };
  }

  async verify(token: string): Promise<BackendJWTPayload> {
    const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER });
    if (!payload.sub) throw new Error("missing sub");
    return payload as unknown as BackendJWTPayload;
  }
}
