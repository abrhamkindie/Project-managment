import { describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  cookieHeaders,
  cookieValue,
  PASSWORD,
  signIn,
  signUp,
  unique,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { hashSecret, randomToken } from "../src/lib/crypto.js";

/**
 * Session lifecycle over HTTP: cookie issuance, rotation, theft detection, logout, password
 * recovery and the durable budget that slows anyone hammering the credential endpoints.
 * The cookies are httpOnly, so supertest's cookie jar is the only holder — exactly like
 * the browser behind the Next.js proxy.
 */

describe("registration", () => {
  it("creates a user, a first organization and an httpOnly cookie pair", async () => {
    const email = `${unique("reg")}@orbita.test`;
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        firstName: "Ada",
        lastName: "Lovelace",
        organizationName: "Analytical Engines",
      })
      .expect(201);

    expect(res.body.user).toMatchObject({
      email,
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(res.body.organizations).toHaveLength(1);
    expect(res.body.organizations[0]).toMatchObject({
      name: "Analytical Engines",
      role: "admin",
      memberCount: 1,
    });

    const cookies = cookieHeaders(res);
    expect(
      cookies.some((c) => c.startsWith("orbita_at=") && c.includes("HttpOnly")),
    ).toBe(true);
    expect(
      cookies.some(
        (c) =>
          c.startsWith("orbita_rt=") &&
          c.includes("HttpOnly") &&
          c.includes("SameSite=Lax"),
      ),
    ).toBe(true);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.passwordHash!.startsWith("$2")).toBe(true);
    // The bootstrap workspace owns the org and lists the owner as admin.
    const membership = await prisma.organizationMember.findFirstOrThrow({
      where: { userId: stored.id },
    });
    expect(membership.role).toBe("admin");
  });

  it("rejects duplicate and malformed input with a validation envelope", async () => {
    const { email } = await signUp();
    await request(app)
      .post("/api/auth/register")
      .send({ email, password: PASSWORD, firstName: "Dup", lastName: "Licate" })
      .expect(409);

    const weak = await request(app)
      .post("/api/auth/register")
      .send({
        email: `${unique("weak")}@orbita.test`,
        password: "short",
        firstName: "x",
        lastName: "y",
      })
      .expect(400);
    expect(weak.body.error.code).toBe("bad_request");
    expect(JSON.stringify(weak.body.error.details)).toContain("password");
  });
});

describe("sign in and out", () => {
  it("accepts the right password and rejects the wrong one identically", async () => {
    const { email } = await signUp();
    await request(app)
      .post("/api/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    const bad = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "Wrong1password" })
      .expect(401);
    expect(bad.body.error.code).toBe("unauthorized");
    const missing = await request(app)
      .post("/api/auth/login")
      .send({ email: "ghost@orbita.test", password: PASSWORD })
      .expect(401);
    expect(missing.body.error.message).toBe(bad.body.error.message); // no user enumeration
  });

  it("protects /auth/me and honours logout", async () => {
    const workspace = await signUp();
    await workspace.agent.get("/api/auth/me").expect(200);
    await workspace.agent.post("/api/auth/logout").expect(200);
    await workspace.agent.get("/api/auth/me").expect(401);
    // Refresh was revoked by logout, so it cannot mint a new access token.
    await workspace.agent.post("/api/auth/refresh").expect(401);
  });

  it("reads a bearer token as well as a cookie", async () => {
    const workspace = await signUp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: workspace.email, password: PASSWORD })
      .expect(200);
    await request(app)
      .get("/api/auth/me")
      .set("authorization", `Bearer ${cookieValue(login, "orbita_at")}`)
      .expect(200);
  });

  it("updates the profile and changes the password", async () => {
    const workspace = await signUp();
    const patched = await workspace.agent
      .patch("/api/auth/profile")
      .send({
        firstName: "Grace",
        timezone: "Europe/Berlin",
        prefs: { emailDigest: false },
      })
      .expect(200);
    expect(patched.body.user).toMatchObject({
      firstName: "Grace",
      timezone: "Europe/Berlin",
    });
    expect(patched.body.user.prefs).toEqual({ emailDigest: false });
    expect(patched.body.organizations).toHaveLength(1);

    await workspace.agent
      .post("/api/auth/password")
      .send({
        currentPassword: "NotThePassword1",
        newPassword: "Fresh1password",
      })
      .expect(401);
    await workspace.agent
      .post("/api/auth/password")
      .send({ currentPassword: PASSWORD, newPassword: "Fresh1password" })
      .expect(200);

    // Changing the password invalidates live sessions: the user is logged out everywhere.
    await workspace.agent.get("/api/auth/me").expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ email: workspace.email, password: "Fresh1password" })
      .expect(200);
  });
});

describe("refresh token rotation", () => {
  it("invalidates the presented token and keeps a session per device", async () => {
    const { email } = await signUp();
    const agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    const userId = login.body.user.id as string;
    const liveSessions = () =>
      prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    // signUp() already created one session (registration), this login adds a second.
    const before = await liveSessions();
    expect(before).toBe(2);

    await agent.post("/api/auth/refresh").expect(200);
    expect(await liveSessions()).toBe(before); // one revoked, one issued

    const sessions = await agent.get("/api/auth/sessions").expect(200);
    expect(sessions.body.items).toHaveLength(before);

    await agent.delete("/api/auth/sessions").expect(200);
    expect(await liveSessions()).toBe(0);
    await agent.get("/api/auth/me").expect(401);
  });

  it("treats a replayed refresh token as theft and revokes every session", async () => {
    const { email } = await signUp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    const userId = login.body.user.id as string;
    const stolen = `orbita_rt=${cookieValue(login, "orbita_rt")}`;

    await request(app)
      .post("/api/auth/refresh")
      .set("cookie", stolen)
      .expect(200);
    // Reuse of the token that was already rotated away.
    await request(app)
      .post("/api/auth/refresh")
      .set("cookie", stolen)
      .expect(401);
    expect(
      await prisma.refreshToken.count({ where: { userId, revokedAt: null } }),
    ).toBe(0);
  });

  it("refuses to refresh without a session", async () => {
    await request(app).post("/api/auth/refresh").expect(401);
  });
});

/**
 * Password recovery.
 *
 * The emailed link is the only place the raw token exists, so these tests seed a token row
 * directly (`hashSecret` is the same function the service uses) and drive the two endpoints from
 * there. What matters here is the shape of the answers: identical for an address that exists and
 * one that does not, single use, and no session left alive afterwards.
 */
describe("password recovery", () => {
  /** Issue a live link for `userId` and hand back the raw token only it knows. */
  async function seedResetToken(
    userId: string,
    secondsUntilExpiry = 300,
  ): Promise<string> {
    const raw = randomToken(32);
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashSecret(raw),
        expiresAt: new Date(Date.now() + secondsUntilExpiry * 1000),
      },
    });
    return raw;
  }

  it("answers the same whether or not the address exists, and keeps one live link per account", async () => {
    const workspace = await signUp();

    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: `${unique("ghost")}@orbita.test` })
      .expect(200);
    const known = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: workspace.email })
      .expect(200);
    expect(known.body).toEqual(unknown.body);
    expect(
      await prisma.passwordResetToken.count({
        where: { userId: workspace.userId },
      }),
    ).toBe(1);

    // A second request retires the first link, so a leaked one dies when the owner asks for a new one.
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: workspace.email })
      .expect(200);
    expect(
      await prisma.passwordResetToken.count({
        where: { userId: workspace.userId },
      }),
    ).toBe(2);
    expect(
      await prisma.passwordResetToken.count({
        where: { userId: workspace.userId, usedAt: null },
      }),
    ).toBe(1);

    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "not-an-email" })
      .expect(400);
  });

  it("issues nothing for an address that has no password to recover", async () => {
    // A Google-only profile and a deactivated account both take the identical answer, so the
    // endpoint cannot be used to find out which of the two an address is.
    const googleOnly = await prisma.user.create({
      data: {
        email: `${unique("googleonly")}@orbita.test`,
        firstName: "Google",
        lastName: "Only",
        googleId: unique("gid"),
      },
      select: { id: true, email: true },
    });
    const dormant = await prisma.user.create({
      data: {
        email: `${unique("dormant")}@orbita.test`,
        firstName: "Left",
        lastName: "Building",
        passwordHash: "not-a-real-hash",
        isActive: false,
      },
      select: { id: true, email: true },
    });

    for (const account of [googleOnly, dormant]) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: account.email })
        .expect(200);
      expect(res.body.message).toMatch(/If that address/);
      expect(
        await prisma.passwordResetToken.count({
          where: { userId: account.id },
        }),
      ).toBe(0);
    }
  });

  it("validates a link before the form is filled in", async () => {
    const workspace = await signUp();
    const token = await seedResetToken(workspace.userId);

    const live = await request(app)
      .get("/api/auth/password-reset")
      .query({ token })
      .expect(200);
    expect(live.body.valid).toBe(true);
    // Masked: enough for a person to recognise their own address, not a directory.
    expect(live.body.email).toMatch(/\*\*\*@/);

    // A well-formed token that was never issued: the answer is the same shape as an expired
    // one, so the screen cannot tell an attacker whether their guess was close.
    const forged = await request(app)
      .get("/api/auth/password-reset")
      .query({ token: randomToken(32) })
      .expect(200);
    expect(forged.body.valid).toBe(false);
    expect(forged.body.email).toBeUndefined();

    const expired = await seedResetToken(workspace.userId, -10);
    const stale = await request(app)
      .get("/api/auth/password-reset")
      .query({ token: expired })
      .expect(200);
    expect(stale.body.valid).toBe(false);

    // Garbage that cannot be a token is refused by validation rather than looked up.
    await request(app).get("/api/auth/password-reset").expect(400);
    await request(app)
      .get("/api/auth/password-reset")
      .query({ token: "short" })
      .expect(400);
  });

  it("changes the password, revokes every session and can only be used once", async () => {
    const workspace = await signUp();
    const otherDevice = await signIn(workspace.email);
    const token = await seedResetToken(workspace.userId);
    const newPassword = "Recovered1password";

    const done = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: newPassword })
      .expect(200);
    expect(done.body.ok).toBe(true);
    // The response itself carries no session either way up.
    expect(
      cookieHeaders(done).some(
        (c) => c.startsWith("atlas_at=;") || c.startsWith("atlas_rt=;"),
      ),
    ).toBe(true);

    // Same token again: consumed before the write, so a double submit cannot reset twice.
    const replay = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "Another1password" })
      .expect(400);
    expect(replay.body.error.message).toMatch(/invalid or has expired/);

    expect(
      await prisma.refreshToken.count({
        where: { userId: workspace.userId, revokedAt: null },
      }),
    ).toBe(0);
    // The access token is stateless and short-lived, so what must die is the ability to renew it.
    await otherDevice.post("/api/auth/refresh").expect(401);

    const fresh = await request(app)
      .post("/api/auth/login")
      .send({ email: workspace.email, password: newPassword })
      .expect(200);
    expect(fresh.body.user.email).toBe(workspace.email);
    await request(app)
      .post("/api/auth/login")
      .send({ email: workspace.email, password: PASSWORD })
      .expect(401);
  });

  it("refuses a weak password and an unknown token", async () => {
    const workspace = await signUp();
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "never-issued", password: "Recovered1password" })
      .expect(400);
    const token = await seedResetToken(workspace.userId);
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "short" })
      .expect(400);
    // The weak attempt did not consume the link, so the real one still works.
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "Recovered1password" })
      .expect(200);
  });
});

describe("credential limiting", () => {
  /**
   * The budget on the password endpoints is a durable counter, not an in-memory one, so these
   * tests drive it through its own bucket row instead of sending a million requests: that row
   * is what survives a restart and what every replica shares, which is the entire point.
   */
  const spend = async (bucket: string) => {
    // The key embeds the request ip, so let the middleware create it rather than guess it.
    const rows = await prisma.rateLimitBucket.findMany({
      where: { bucketKey: { startsWith: `${bucket}:` } },
    });
    expect(rows.length).toBeGreaterThan(0);
    // The address goes in hashed, so a readable bucket table cannot become a user list.
    await prisma.rateLimitBucket.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { count: env.CREDENTIAL_RATE_LIMIT },
    });
    return rows;
  };

  const cleanup = async () => {
    // Sequential because every write here goes through one SQLite connection in tests.
    await prisma.rateLimitBucket.deleteMany({
      where: { bucketKey: { startsWith: "login:" } },
    });
    await prisma.rateLimitBucket.deleteMany({
      where: { bucketKey: { startsWith: "pw-forgot:" } },
    });
  };

  it("refuses an address once its window budget is spent", async () => {
    const workspace = await signUp();
    await request(app)
      .post("/api/auth/login")
      .send({ email: workspace.email, password: "Wrong1password" })
      .expect(401);

    const rows = await spend("login");
    expect(rows.every((row) => !row.bucketKey.includes(workspace.email))).toBe(
      true,
    );

    const blocked = await request(app)
      .post("/api/auth/login")
      .send({ email: workspace.email, password: PASSWORD })
      .expect(429);
    expect(blocked.body.error.code).toBe("too_many_requests");
    // Counting happens before authentication, so a correct password is refused too — which is
    // the behaviour a credential-stuffing run has to hit.

    await cleanup();
    // Not cosmetic: the rest of the suite reuses these endpoints inside the same window.
    await request(app)
      .post("/api/auth/login")
      .send({ email: workspace.email, password: PASSWORD })
      .expect(200);
  });

  it("gives each endpoint its own budget", async () => {
    const workspace = await signUp();
    await request(app)
      .post("/api/auth/login")
      .send({ email: workspace.email, password: "Wrong1password" })
      .expect(401);
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: workspace.email })
      .expect(200);

    await spend("login");
    await request(app)
      .post("/api/auth/login")
      .send({ email: workspace.email, password: PASSWORD })
      .expect(429);

    // One spent bucket must not lock the product: recovery stays reachable.
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: workspace.email })
      .expect(200);

    await spend("pw-forgot");
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: workspace.email })
      .expect(429);
    await cleanup();
  });
});
