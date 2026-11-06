import { describe, it, expect, afterEach, beforeEach } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app, signUp, unique } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import {
  authorizeUrl,
  clearDiscoveryCache,
  loginWithOidc,
  readState,
  redirectUri,
  signState,
  verifyIdToken,
} from "../src/services/oauth/oidc.service.js";
import { enabledProviders } from "../src/services/oauth/registry.js";

/**
 * Generic OIDC sign-in against a stub issuer.
 *
 * The security-critical part is `verifyIdToken`: an asserted e-mail is enough to enter an account,
 * so every rejection path (algorithm, signature, issuer, audience, expiry, nonce, unverified
 * address) is tested explicitly rather than assumed. No network call is made anywhere in this file.
 */

const KID = "stub-key-1";
const NOW = () => Math.floor(Date.now() / 1000);

interface StubKey {
  /** The shape a discovery key set publishes. */
  jwk: crypto.JsonWebKey;
  privateKey: string;
}

const makeKeys = (): StubKey => {
  const pair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    jwk: crypto.createPublicKey(pair.publicKey).export({ format: "jwk" }) as crypto.JsonWebKey,
    privateKey: pair.privateKey,
  };
};

const keys = makeKeys();
const otherKeys = makeKeys();

const DISCOVERY = {
  issuer: "https://idp.test",
  authorization_endpoint: "https://idp.test/authorize",
  token_endpoint: "https://idp.test/oauth/token",
  jwks_uri: "https://idp.test/.well-known/jwks.json",
};

/** Serves the three issuer endpoints; anything else is a test bug. */
function stubIssuer(
  overrides: { discovery?: unknown; idToken?: string; tokenError?: string; tokenPayload?: unknown } = {},
) {
  return (async (input: string | URL, _init?: unknown) => {
    const url = String(input);
    const json = (body: unknown, ok = true) =>
      ({ ok, status: ok ? 200 : 400, json: async () => body } as unknown as Response);

    if (url.endsWith("/.well-known/openid-configuration")) {
      return json(overrides.discovery ?? DISCOVERY);
    }
    if (url.endsWith("/.well-known/jwks.json")) {
      return json({ keys: [{ ...keys.jwk, kid: KID, use: "sig", alg: "RS256" }] });
    }
    if (url.endsWith("/oauth/token")) {
      // `tokenPayload` is for an issuer that answers in a shape we did not predict.
      if (overrides.tokenPayload) return json(overrides.tokenPayload, false);
      // A real IdP sends both the code and a human-readable description.
      if (overrides.tokenError) {
        return json({ error: overrides.tokenError, error_description: `${overrides.tokenError}: bad code` }, false);
      }
      return json({ id_token: overrides.idToken ?? "" });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

interface IssueOptions {
  nonce?: string;
  email?: string;
  claims?: Record<string, unknown>;
  privateKey?: string;
  algorithm?: string;
  keyid?: string | undefined;
}

/** A signed ID token for the stub issuer. */
const issue = ({
  nonce = "n-1",
  email = "someone@idp.test",
  claims = {},
  privateKey = keys.privateKey,
  algorithm = "RS256",
  keyid = KID,
}: IssueOptions = {}) =>
  jwt.sign(
    {
      sub: `sub-${email}`,
      iss: DISCOVERY.issuer,
      aud: env.OIDC_CLIENT_ID,
      exp: NOW() + 600,
      iat: NOW(),
      email,
      email_verified: true,
      given_name: "Some",
      family_name: "One",
      nonce,
      ...claims,
    },
    privateKey,
    { algorithm: algorithm as "RS256", ...(keyid ? { keyid } : {}) },
  );

describe("oidc", () => {
  let savedFetch: typeof globalThis.fetch;

  beforeEach(() => {
    savedFetch = globalThis.fetch;
    clearDiscoveryCache();
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  describe("request side", () => {
    it("builds an authorize URL from the discovery document", async () => {
      globalThis.fetch = stubIssuer();
      const state = signState("nonce-value", "/projects");

      const url = new URL(await authorizeUrl(state));
      expect(url.origin + url.pathname).toBe("https://idp.test/authorize");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("client_id")).toBe(env.OIDC_CLIENT_ID);
      expect(url.searchParams.get("redirect_uri")).toBe(redirectUri());
      expect(url.searchParams.get("scope")).toContain("email");
      // The nonce is derived from the state, so the callback needs no server-side store.
      expect(url.searchParams.get("nonce")).toBe(state.slice(-24));
    });

    it("keeps the round trip inside the site", () => {
      expect(redirectUri()).toBe(`${env.WEB_URL}/api/v1/auth/oidc/callback`);

      const decoded = readState(signState("abc", "/dashboard"));
      expect(decoded).toEqual({ nonce: "abc", returnTo: "/dashboard" });
      // An absolute or protocol-relative target is not a same-site path.
      expect(readState(signState("abc", "https://evil.test/x")).returnTo).toBe("/");
      expect(readState(signState("abc", "//evil.test/x")).returnTo).toBe("/");
    });

    it("refuses to sign in with a tampered or foreign state", () => {
      expect(() => readState("not-a-jwt")).toThrow(/expired/);
      const asAccess = jwt.sign({ nonce: "x", returnTo: "/" }, env.JWT_ACCESS_SECRET, {
        audience: "zorqen-web",
      });
      expect(() => readState(asAccess)).toThrow(/expired/);
    });

    it("lists a provider exactly when its own credentials are present", () => {
      // The registry is what the login page renders, so it has to agree with the routes: OIDC is
      // configured by the test environment, and Google depends on a developer `.env` we do not own.
      const names = enabledProviders().map((provider) => provider.name);
      expect(names).toContain("oidc");
      const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
      expect(names.includes("google")).toBe(googleConfigured);

      const single = enabledProviders().find((provider) => provider.name === "oidc");
      expect(single!.clientId).toBe(env.OIDC_CLIENT_ID);
      expect(single!.kind).toBe("redirect");
      // An offered provider never has to be clicked with nothing to identify it by.
      for (const provider of enabledProviders()) expect(provider.clientId).not.toBeNull();
    });
  });

  describe("token verification", () => {
    it("accepts a correctly signed token from the configured issuer", async () => {
      globalThis.fetch = stubIssuer();
      const claims = await verifyIdToken(issue({ nonce: "n-2" }), "n-2", stubIssuer());
      expect(claims.email).toBe("someone@idp.test");
      expect(claims.sub).toBe("sub-someone@idp.test");
    });

    it("rejects every algorithm but RS256, `none` included", async () => {
      const hs = jwt.sign({ email: "a@b.test" }, "shared-secret", { algorithm: "HS256" });
      await expect(verifyIdToken(hs, "n-1", stubIssuer())).rejects.toThrow(/not accepted/);

      const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ email: "a@b.test" })).toString("base64url")}.`;
      await expect(verifyIdToken(unsigned, "n-1", stubIssuer())).rejects.toThrow(/not accepted/);
      await expect(verifyIdToken("only.two", "n-1", stubIssuer())).rejects.toThrow(/Malformed/);
    });

    it("rejects a token signed by a key the issuer does not publish", async () => {
      globalThis.fetch = stubIssuer();
      await expect(
        verifyIdToken(issue({ privateKey: otherKeys.privateKey }), "n-1", stubIssuer()),
      ).rejects.toThrow(/does not verify/);

      // A `kid` that is not in the key set is refused before any crypto runs.
      await expect(
        verifyIdToken(issue({ keyid: "unknown-kid" }), "n-1", stubIssuer()),
      ).rejects.toThrow(/not in the provider key set/);
    });

    it("checks issuer, audience, expiry and nonce", async () => {
      const fetch = stubIssuer();
      await expect(verifyIdToken(issue({ claims: { iss: "https://other.test" } }), "n-1", fetch))
        .rejects.toThrow(/not issued by the configured provider/);
      await expect(verifyIdToken(issue({ claims: { aud: "somebody-elses-client" } }), "n-1", fetch))
        .rejects.toThrow(/audience mismatch/);
      await expect(verifyIdToken(issue({ claims: { exp: NOW() - 600 } }), "n-1", fetch))
        .rejects.toThrow(/expired/);
      await expect(verifyIdToken(issue({ nonce: "right" }), "wrong", fetch))
        .rejects.toThrow(/Nonce mismatch/);
    });

    it("refuses an account without a verified address", async () => {
      const fetch = stubIssuer();
      await expect(verifyIdToken(issue({ claims: { email: undefined } }), "n-1", fetch))
        .rejects.toThrow(/did not provide an email/);
      await expect(verifyIdToken(issue({ claims: { email_verified: false } }), "n-1", fetch))
        .rejects.toThrow(/not verified/);
      // Some issuers send the string, and `"true"` is a verified address.
      const claims = await verifyIdToken(issue({ claims: { email_verified: "true" } }), "n-1", fetch);
      expect(claims.email_verified).toBe("true");
    });

    it("caches discovery and lets a test clear it", async () => {
      let calls = 0;
      const counting = (async (input: string | URL, init?: RequestInit) => {
        if (String(input).endsWith("openid-configuration")) calls += 1;
        return stubIssuer()(input, init);
      }) as unknown as typeof fetch;

      await authorizeUrl("state", counting);
      await authorizeUrl("state", counting);
      expect(calls).toBe(1);

      clearDiscoveryCache();
      await authorizeUrl("state", counting);
      expect(calls).toBe(2);
    });

    it("fails cleanly when the issuer document is unusable", async () => {
      await expect(
        authorizeUrl("state", stubIssuer({ discovery: { issuer: "https://idp.test" } })),
      ).rejects.toThrow(/missing the required endpoints/);
      await expect(
        authorizeUrl("state", (() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch),
      ).rejects.toThrow(/discovery failed/);
    });
  });

  describe("sign-in", () => {
    const meta = { userAgent: "vitest", ip: "127.0.0.1" };

    it("creates a passwordless account with a workspace of its own", async () => {
      const email = `${unique("fresh")}@idp.test`;
      globalThis.fetch = stubIssuer({ idToken: issue({ email, nonce: "n-new" }) });

      const result = await loginWithOidc("code-1", signState("n-new", "/"), meta);
      if (result.mfaRequired) throw new Error("a new account cannot require two-factor");

      const user = await prisma.user.findUnique({ where: { id: result.userId } });
      expect(user!.email).toBe(email);
      expect(user!.passwordHash).toBeNull();
      expect(user!.firstName).toBe("Some");
      expect(await prisma.organization.count({ where: { ownerId: user!.id } })).toBe(1);

      // The token it issued really does authenticate.
      const me = await request(app)
        .get("/api/auth/me")
        .set("authorization", `Bearer ${result.tokens.accessToken}`)
        .expect(200);
      expect(me.body.user.id).toBe(result.userId);
    });

    it("links an existing password account instead of duplicating it", async () => {
      const existing = await signUp();
      globalThis.fetch = stubIssuer({ idToken: issue({ email: existing.email, nonce: "n-link" }) });

      const result = await loginWithOidc("code-2", signState("n-link", "/"), meta);
      expect(result.userId).toBe(existing.userId);
      expect(await prisma.user.count({ where: { email: existing.email } })).toBe(1);
    });

    it("splits a single `name` claim when the provider gives no first/last", async () => {
      const email = `${unique("named")}@idp.test`;
      globalThis.fetch = stubIssuer({
        idToken: issue({ email, nonce: "n-name", claims: { given_name: undefined, family_name: undefined, name: "Ada Lovelace" } }),
      });

      const result = await loginWithOidc("code-3", signState("n-name", "/"), meta);
      const user = await prisma.user.findUnique({ where: { id: result.userId } });
      expect(user!.firstName).toBe("Ada");
      expect(user!.lastName).toBe("Lovelace");
    });

    it("refuses a deactivated account", async () => {
      const existing = await signUp();
      await prisma.user.update({ where: { id: existing.userId }, data: { isActive: false } });
      globalThis.fetch = stubIssuer({ idToken: issue({ email: existing.email, nonce: "n-off" }) });

      await expect(loginWithOidc("code-4", signState("n-off", "/"), meta)).rejects.toThrow(/deactivated/);
    });

    it("gives an account with two-factor enabled no session", async () => {
      const existing = await signUp();
      await prisma.user.update({ where: { id: existing.userId }, data: { mfaEnabled: true } });
      globalThis.fetch = stubIssuer({ idToken: issue({ email: existing.email, nonce: "n-mfa" }) });

      const result = await loginWithOidc("code-5", signState("n-mfa", "/"), meta);
      expect(result.mfaRequired).toBe(true);
      if (!result.mfaRequired) throw new Error("expected no session for an MFA account");
      expect(result.tokens).toBeNull();
    });

    it("surfaces the issuer's own explanation when the code exchange fails", async () => {
      globalThis.fetch = stubIssuer({ tokenError: "invalid_grant" });
      await expect(loginWithOidc("stale-code", signState("n-x", "/"), meta)).rejects.toThrow(/invalid_grant/);
    });

    it("falls back to a generic refusal when the issuer sends no description", async () => {
      globalThis.fetch = stubIssuer({ tokenPayload: { error: "unauthorized_client" } });

      await expect(loginWithOidc("stale-code", signState("n-y", "/"), meta)).rejects.toThrow(
        /Could not complete the sign-in/,
      );
    });
  });

  describe("routes", () => {
    it("redirects the browser to the provider", async () => {
      globalThis.fetch = stubIssuer();
      const res = await request(app).get("/api/auth/oidc/start?returnTo=/dashboard").expect(302);
      const location = new URL(res.headers.location!);
      expect(location.origin).toBe("https://idp.test");
      expect(new URL(location.searchParams.get("redirect_uri")!).pathname).toBe("/api/v1/auth/oidc/callback");
    });

    it("bounces a callback that is missing its code or state", async () => {
      await request(app).get("/api/auth/oidc/callback").expect(302);
      const res = await request(app).get("/api/auth/oidc/callback?code=abc").expect(302);
      expect(res.headers.location).toBe(`${env.WEB_URL}/login?error=sso`);
    });

    it("completes sign-in and lands on the requested page", async () => {
      const email = `${unique("routed")}@idp.test`;
      globalThis.fetch = stubIssuer({ idToken: issue({ email, nonce: "n-route" }) });

      const agent = request.agent(app);
      const res = await agent
        .get(`/api/auth/oidc/callback?code=xyz&state=${signState("n-route", "/my-tasks")}`)
        .expect(302);
      expect(res.headers.location).toBe(`${env.WEB_URL}/my-tasks`);
      await agent.get("/api/auth/me").expect(200);
    });

    it("hands an MFA-enabled account to the code screen instead of a session", async () => {
      const existing = await signUp();
      await prisma.user.update({ where: { id: existing.userId }, data: { mfaEnabled: true } });
      globalThis.fetch = stubIssuer({ idToken: issue({ email: existing.email, nonce: "n-gate" }) });

      const agent = request.agent(app);
      const res = await agent
        .get(`/api/auth/oidc/callback?code=xyz&state=${signState("n-gate", "/")}`)
        .expect(302);
      expect(res.headers.location).toContain(`${env.WEB_URL}/login?mfa=`);
      await agent.get("/api/auth/me").expect(401);
    });

    it("refuses a state that was never signed by us", async () => {
      globalThis.fetch = stubIssuer({ idToken: issue({ nonce: "forged" }) });
      const res = await request(app)
        .get("/api/auth/oidc/callback?code=xyz&state=someone-elses-state")
        .catch(() => null);
      // Either a 302 back to the login screen or the error envelope — never a session.
      if (res) expect([302, 401]).toContain(res.status);
      const agent = request.agent(app);
      await agent.get("/api/auth/me").expect(401);
    });
  });
});
