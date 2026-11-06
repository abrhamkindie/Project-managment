import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import {
  app,
  signIn,
  signUp,
  cookieHeaders,
  PASSWORD,
  type Workspace,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { signChallenge } from "../src/services/mfa.service.js";

/**
 * Two-factor sign-in.
 *
 * The property worth testing is the split: the password step must not produce a session, and the
 * verification step must not accept anything but a current code or an unused backup code.
 */

describe("mfa", () => {
  let owner: Workspace;
  let secret = "";

  beforeAll(async () => {
    owner = await signUp();
  });

  /** Enroll the account and hand back its secret plus one printable backup code. */
  const enroll = async () => {
    const setup = await owner.agent.post("/api/auth/mfa/setup").expect(200);
    secret = setup.body.secret as string;
    expect(setup.body.otpauthUrl).toContain("secret=");

    const enabled = await owner.agent
      .post("/api/auth/mfa/enable")
      .send({ code: setup.body.currentCode })
      .expect(200);
    return enabled.body.recoveryCodes as string[];
  };

  it("starts disabled and reports a pending setup while a seed exists", async () => {
    const before = await owner.agent.get("/api/auth/mfa").expect(200);
    expect(before.body).toEqual({
      enabled: false,
      pendingSetup: false,
      recoveryCodesLeft: 0,
    });

    await owner.agent.post("/api/auth/mfa/setup").expect(200);
    const mid = await owner.agent.get("/api/auth/mfa").expect(200);
    expect(mid.body.enabled).toBe(false);
    expect(mid.body.pendingSetup).toBe(true);
  });

  it("refuses to enable on a code that does not match the seed", async () => {
    await owner.agent.post("/api/auth/mfa/setup").expect(200);
    const denied = await owner.agent
      .post("/api/auth/mfa/enable")
      .send({ code: "000000" });
    expect(denied.status).toBe(400);

    const status = await owner.agent.get("/api/auth/mfa").expect(200);
    expect(status.body.enabled).toBe(false);
  });

  it("enables on a valid code, hands out single-use backup codes, and stores the seed encrypted", async () => {
    const codes = await enroll();
    expect(codes).toHaveLength(8);

    const status = await owner.agent.get("/api/auth/mfa").expect(200);
    expect(status.body.enabled).toBe(true);
    expect(status.body.recoveryCodesLeft).toBe(8);

    const row = await prisma.user.findUnique({ where: { id: owner.userId } });
    // `v1.<iv>.<data>.<tag>`: the seed is not readable from the row.
    expect(row!.mfaSecret!.split(".")).toHaveLength(4);
    expect(row!.mfaSecret).not.toContain(secret);
    expect(row!.mfaEnabled).toBe(true);
  });

  it("pauses the password step without a session, then completes sign-in on a valid code", async () => {
    await enroll();

    const agent = request.agent(app);
    const first = await agent
      .post("/api/auth/login")
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);
    expect(first.body.mfaRequired).toBe(true);
    expect(first.body.challenge.length).toBeGreaterThan(20);
    // This is the whole point of the feature: no cookies before the second factor.
    expect(cookieHeaders(first)).toEqual([]);

    // The challenge is not an access token.
    const impersonated = await request(app)
      .get("/api/auth/me")
      .set("authorization", `Bearer ${first.body.challenge}`);
    expect(impersonated.status).toBe(401);

    const wrong = await agent
      .post("/api/auth/mfa/verify")
      .send({ challenge: first.body.challenge, code: "123456" });
    expect(wrong.status).toBe(401);

    const verified = await agent
      .post("/api/auth/mfa/verify")
      .send({ challenge: first.body.challenge, code: authenticator.generate(secret) })
      .expect(200);
    expect(cookieHeaders(verified).join(" ")).toContain("HttpOnly");
    expect(verified.body.user.id).toBe(owner.userId);

    await agent.get("/api/auth/me").expect(200);
  });

  it("accepts a backup code once and then reports one fewer left", async () => {
    const codes = await enroll();
    const agent = await signIn(owner.email);
    const login = await agent
      .post("/api/auth/login")
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);

    await agent
      .post("/api/auth/mfa/verify")
      .send({ challenge: login.body.challenge, code: codes[0] })
      .expect(200);

    const status = await agent.get("/api/auth/mfa").expect(200);
    expect(status.body.recoveryCodesLeft).toBe(7);

    // Replaying a spent code must fail, and formatting differences alone must not.
    const second = await agent
      .post("/api/auth/login")
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);
    const replay = await agent
      .post("/api/auth/mfa/verify")
      .send({ challenge: second.body.challenge, code: codes[0] });
    expect(replay.status).toBe(401);

    const third = await agent
      .post("/api/auth/login")
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);
    await agent
      .post("/api/auth/mfa/verify")
      .send({ challenge: third.body.challenge, code: codes[1].toLowerCase().replace("-", "- ") })
      .expect(200);
  });

  it("rejects a challenge for an account that has not enrolled", async () => {
    const outsider = await signUp();
    const res = await request(app)
      .post("/api/auth/mfa/verify")
      .send({ challenge: signChallenge(outsider.userId), code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/not enabled/);
  });

  it("regenerates the backup set on request", async () => {
    const codes = await enroll();
    const rotated = await owner.agent
      .post("/api/auth/mfa/recovery-codes")
      .expect(200);
    expect(rotated.body.recoveryCodes).toHaveLength(8);
    expect(rotated.body.recoveryCodes).not.toEqual(codes);

    const status = await owner.agent.get("/api/auth/mfa").expect(200);
    expect(status.body.recoveryCodesLeft).toBe(8);
  });

  it("needs the password to switch two-factor off again", async () => {
    await enroll();

    const denied = await owner.agent
      .post("/api/auth/mfa/disable")
      .send({ password: "WrongPass1!" });
    expect(denied.status).toBe(400);

    const status = await owner.agent.get("/api/auth/mfa").expect(200);
    expect(status.body.enabled).toBe(true);

    await owner.agent
      .post("/api/auth/mfa/disable")
      .send({ password: PASSWORD })
      .expect(200);

    const after = await prisma.user.findUnique({ where: { id: owner.userId } });
    expect(after!.mfaEnabled).toBe(false);
    expect(after!.mfaSecret).toBeNull();
    expect(await prisma.otpRecoveryCode.count({ where: { userId: owner.userId } })).toBe(0);

    // Sign-in goes straight back to a session.
    const agent = await signIn(owner.email);
    await agent.get("/api/auth/me").expect(200);
  });

  it("refuses to let an API token re-shape the account's second factor", async () => {
    const minted = await owner.agent
      .post("/api/auth/tokens")
      .send({ name: "no-mfa", scopes: ["*"] })
      .expect(201);
    const headers = { authorization: `Bearer ${minted.body.token}` };

    const unauthorized = request(app);
    await unauthorized
      .post("/api/auth/mfa/setup")
      .set(headers)
      .expect(403);
    await unauthorized
      .post("/api/auth/mfa/disable")
      .set({ ...headers, "content-type": "application/json" })
      .send({ password: PASSWORD })
      .expect(403);
  });
});
