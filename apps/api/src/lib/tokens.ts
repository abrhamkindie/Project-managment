import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { Unauthorized } from "../domain/errors.js";

export interface AccessTokenClaims {
  sub: string;
  email: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    // seconds, taken from the same knob that sets the cookie Max-Age
    expiresIn: env.ACCESS_TOKEN_SECONDS,
    issuer: "orbita-api",
    audience: "orbita-web",
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: "orbita-api",
      audience: "orbita-web",
    });
    if (typeof decoded === "string" || !decoded.sub)
      throw new Error("malformed");
    return { sub: decoded.sub, email: (decoded as AccessTokenClaims).email };
  } catch {
    throw new Unauthorized("Session expired or invalid");
  }
}

/** Used by the Socket.IO handshake, which shares the access-token cookie. */
export function tokenFromAuthorizationHeader(
  header?: string | null,
): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}
