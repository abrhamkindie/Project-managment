import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { BadRequest, Conflict, Unauthorized } from "../domain/errors.js";
import {
  hashPassword,
  hashSecret,
  randomToken,
  uniqueSlug,
  verifyPassword,
} from "../lib/crypto.js";
import { addSeconds } from "../lib/time.js";
import {
  createSession,
  revokeAllSessions,
  type SessionTokens,
} from "./session.js";
import { presentUser } from "./presenters.js";
import { env } from "../config/env.js";
import { mails, sendMail } from "./mailer.js";
import type {
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from "../domain/schemas.js";
import type { OrgRole } from "../domain/enums.js";

/**
 * Account creation and sign-in. Registering also bootstraps the first organization so a
 * new user lands in a working workspace instead of an empty screen.
 */

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export interface Authenticated {
  userId: string;
  tokens: SessionTokens;
}

/**
 * Password step of sign-in. The two arms are exclusive by type: when a second factor is required
 * there is no session to hand out, so a caller cannot accidentally use one that was never issued.
 */
export type LoginResult =
  | { userId: string; mfaRequired: false; tokens: SessionTokens }
  | { userId: string; mfaRequired: true; tokens: null };

export async function register(
  input: RegisterInput,
  meta: SessionMeta,
): Promise<Authenticated> {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) throw new Conflict("An account with this email already exists");

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(input.password),
      firstName: input.firstName,
      lastName: input.lastName,
    },
  });

  const orgName =
    input.organizationName?.trim() || `${input.firstName}'s workspace`;
  const slug = await uniqueSlug(orgName, async (candidate) =>
    Boolean(
      await prisma.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      }),
    ),
  );

  await prisma.organization.create({
    data: {
      name: orgName,
      slug,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "admin" } },
    },
  });

  // Fire-and-forget welcome email — must never block or fail registration.
  void sendMail(
    mails.welcome({
      to: email,
      firstName: input.firstName,
      orgName,
      link: `${env.WEB_URL}/w/${slug}/dashboard`,
    }),
  );

  const tokens = await createSession(user.id, meta);
  return { userId: user.id, tokens };
}

export async function login(
  input: LoginInput,
  meta: SessionMeta,
): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });
  // Same message and a constant-ish path for unknown vs wrong password: no user enumeration.
  if (!user) {
    await verifyPassword(
      input.password,
      "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin",
    );
    throw new Unauthorized("Incorrect email or password");
  }
  if (!(await verifyPassword(input.password, user.passwordHash ?? ""))) {
    throw new Unauthorized("Incorrect email or password");
  }
  if (!user.isActive) {
    throw new Unauthorized("This account has been deactivated");
  }

  // Two-factor is decided *before* a session exists: a password alone must never be enough to
  // obtain a refresh token, not even one the caller would then be told to trade in.
  if (user.mfaEnabled) {
    logger.info({ userId: user.id }, "login paused for two-factor");
    return { userId: user.id, tokens: null, mfaRequired: true };
  }

  const tokens = await createSession(user.id, meta);
  return { userId: user.id, tokens, mfaRequired: false };
}

export async function profile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      memberships: {
        include: {
          org: {
            select: {
              id: true,
              name: true,
              slug: true,
              ownerId: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const orgIds = user.memberships.map((m) => m.orgId);
  const counts = orgIds.length
    ? await prisma.organizationMember.groupBy({
      by: ["orgId"],
      where: { orgId: { in: orgIds } },
      _count: { _all: true },
    })
    : [];
  const countByOrg = new Map(counts.map((c) => [c.orgId, c._count._all]));

  return {
    user: {
      ...presentUser(user),
      prefs: safePrefs(user.prefs),
    },
    organizations: user.memberships.map((m) => ({
      ...m.org,
      role: m.role as OrgRole,
      memberCount: countByOrg.get(m.orgId) ?? 0,
    })),
    unreadNotifications: await prisma.notification.count({
      where: { userId, readAt: null },
    }),
  };
}

function safePrefs(raw: string): Record<string, boolean> {
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const { prefs, ...rest } = input;
  const current = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
  });
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...rest,
      // Merged, so a client can PATCH a single preference without wiping the others.
      ...(prefs
        ? { prefs: JSON.stringify({ ...safePrefs(current.prefs), ...prefs }) }
        : {}),
    },
  });
  return presentUser(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash ?? ""))) {
    throw new Unauthorized("Current password is incorrect");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  // Rotating the password invalidates every existing session.
  await revokeAllSessions(userId);
}

// ------------------------------------------------------------------ password reset

/** Shown once a reset lands, and never varied by account state. */
const RESET_REQUESTED = {
  ok: true as const,
  message: "If that address has an ZORQEN password, a reset link is on its way",
};

/** `a***@domain.com` — enough for a human to recognise the address, not a full reveal. */
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 1)}***@${domain}`;
}

/**
 * Step 1 of the reset flow. Resolves identically for an unknown address, a deactivated
 * account and a Google-only profile, so this endpoint cannot enumerate accounts; the
 * budget that would slow a scripted enumeration lives in `credentialLimit`.
 */
export async function requestPasswordReset(
  email: string,
): Promise<typeof RESET_REQUESTED> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, isActive: true, passwordHash: true },
  });
  if (!user?.isActive || !user.passwordHash) return RESET_REQUESTED;

  const raw = randomToken(32);
  const minutes = env.PASSWORD_RESET_TTL_MINUTES;

  // One live link per account: issuing a newer one must retire whatever was emailed before.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashSecret(raw),
      expiresAt: addSeconds(new Date(), minutes * 60),
    },
  });

  await sendMail(
    mails.passwordReset({
      to: user.email,
      link: `${env.WEB_URL}/reset-password?token=${encodeURIComponent(raw)}`,
      minutes,
    }),
  );
  return RESET_REQUESTED;
}

/** Lets the reset screen say "this link has expired" before the user types a new password. */
export async function passwordResetState(token: string) {
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { user: { select: { email: true, isActive: true } } },
  });
  const usable =
    !!stored &&
    !stored.usedAt &&
    stored.expiresAt.getTime() > Date.now() &&
    stored.user.isActive;
  return {
    valid: usable,
    ...(usable ? { email: maskEmail(stored!.user.email) } : {}),
  };
}

/**
 * Step 2. The token row is consumed before the password is written, so a replayed link
 * (double submit, proxy retry) fails instead of resetting twice.
 *
 * Every refresh token is revoked, which is what actually locks an attacker out: the access
 * cookie is a stateless JWT with no session row behind it, so one already issued keeps
 * working until it expires on its own (ACCESS_TOKEN_TTL) but can never be renewed.
 */
export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  const invalid = new BadRequest(
    "This reset link is invalid or has expired. Request a new one.",
  );
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: {
      user: {
        select: { id: true, email: true, firstName: true, isActive: true },
      },
    },
  });
  if (
    !stored ||
    stored.usedAt ||
    stored.expiresAt.getTime() < Date.now() ||
    !stored.user.isActive
  ) { throw invalid; }

  const consumed = await prisma.passwordResetToken.updateMany({
    where: { id: stored.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) throw invalid;

  await prisma.user.update({
    where: { id: stored.userId },
    data: { passwordHash: await hashPassword(password) },
  });
  await Promise.all([
    revokeAllSessions(stored.userId),
    // Retire any other outstanding link for this account.
    prisma.passwordResetToken.updateMany({
      where: { userId: stored.userId, id: { not: stored.id }, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  void sendMail(
    mails.passwordChanged({
      to: stored.user.email,
      firstName: stored.user.firstName,
    }),
  );
}
