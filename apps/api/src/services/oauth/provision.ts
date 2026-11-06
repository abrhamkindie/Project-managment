import { prisma } from '../../lib/prisma.js';
import { uniqueSlug } from '../../lib/crypto.js';
import { Unauthorized } from '../../domain/errors.js';
import { env } from '../../config/env.js';
import { createSession, type SessionTokens } from '../session.js';
import { mails, sendMail } from '../mailer.js';
import type { OrgRole } from '../../domain/enums.js';
import type { SessionMeta } from '../auth.service.js';

/**
 * Turning a verified identity-provider profile into a logged-in account.
 *
 * Every SSO provider ends in this same three-way decision, so it lives once here:
 *  1. the provider subject is already attached to an account — sign in;
 *  2. the e-mail is registered (a password account, or one opened through another provider) —
 *     link the provider to it, which is what lets people move to SSO without losing their work;
 *  3. nobody — create the account and give it a workspace, so the first screen is a board.
 *
 * Rule 2 is only safe while the provider has confirmed the address: `provision` therefore takes an
 * already-verified profile and never re-checks it, keeping "who asserted the e-mail" a provider
 * question rather than something this file has to remember.
 */

export interface IdentityProfile {
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
    /** Provider subject, attached to the account when a column exists for it. */
    externalId?: { field: 'googleId'; value: string };
}

/**
 * Same contract as the password step: an account with two-factor enabled gets no session from an
 * SSO login either, so a stolen IdP token is not a way around a factor the user switched on.
 */
export type ProvisionResult =
    | { userId: string; mfaRequired: false; tokens: SessionTokens }
    | { userId: string; mfaRequired: true; tokens: null };

async function findByExternalId(ref: IdentityProfile['externalId']) {
    if (!ref) return null;
    if (ref.field === 'googleId') return prisma.user.findUnique({ where: { googleId: ref.value } });
    return null;
}

/** Brand-new accounts get a workspace to land in, exactly like password sign-up. */
async function bootstrapWorkspace(user: { id: string; firstName: string }, email: string) {
    const orgName = `${user.firstName}'s workspace`;
    const slug = await uniqueSlug(orgName, async (candidate) =>
        Boolean(await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } })),
    );
    await prisma.organization.create({
        data: { name: orgName, slug, ownerId: user.id, members: { create: { userId: user.id, role: 'admin' as OrgRole } } },
    });
    void sendMail(mails.welcome({ to: email, firstName: user.firstName, orgName, link: `${env.WEB_URL}/w/${slug}/dashboard` }));
}

export async function provisionFromIdentity(profile: IdentityProfile, meta: SessionMeta): Promise<ProvisionResult> {
    const email = profile.email.toLowerCase();

    let user = await findByExternalId(profile.externalId);

    if (!user) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            user = await prisma.user.update({
                where: { id: existing.id },
                data: {
                    ...(profile.externalId?.field === 'googleId' ? { googleId: profile.externalId.value } : {}),
                    avatarUrl: existing.avatarUrl ?? profile.avatarUrl ?? null,
                },
            });
        } else {
            user = await prisma.user.create({
                data: {
                    email,
                    firstName: profile.firstName,
                    lastName: profile.lastName,
                    avatarUrl: profile.avatarUrl ?? null,
                    ...(profile.externalId?.field === 'googleId' ? { googleId: profile.externalId.value } : {}),
                    // No `passwordHash`: this account can only be entered through its provider.
                },
            });
            await bootstrapWorkspace(user, email);
        }
    }

    if (!user.isActive) throw new Unauthorized('This account has been deactivated');
    if (user.mfaEnabled) return { userId: user.id, mfaRequired: true, tokens: null };
    return { userId: user.id, mfaRequired: false, tokens: await createSession(user.id, meta) };
}
