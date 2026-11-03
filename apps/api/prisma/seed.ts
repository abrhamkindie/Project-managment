/**
 * Demo seed for Atlas.
 *
 * The data is generated from a fixed-seed LCG, so every run produces the same org,
 * the same tasks and — importantly — the same analytics shape. History is backdated
 * across ~8 weeks so dashboards, throughput charts and workload numbers look real
 * instead of being a single spike at "now".
 *
 * Run:  npm run db:seed            (skips if the demo org already exists)
 *       npm run db:seed -- --force (wipes Atlas tables first, then reseeds)
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/crypto.js';
import { DEFAULT_SECTIONS } from '../src/domain/enums.js';
import type { TaskPriority, TaskStatus } from '../src/domain/enums.js';

const prisma = new PrismaClient();

const DEMO_ORG_SLUG = 'acme';
const DEMO_PASSWORD = 'Passw0rd!';

// ---------------------------------------------------------------- random helpers

function makeRng(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

const rng = makeRng(20261103);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const chance = (probability: number) => rng() < probability;
const intBetween = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
function pickWeighted<T extends string>(weights: Record<T, number>): T {
    const entries = Object.entries(weights) as [T, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = rng() * total;
    for (const [value, w] of entries) {
        roll -= w;
        if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
}

/** Hours/minutes relative to "now" so due dates stay meaningful whenever the seed runs. */
const NOW = new Date();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

// ---------------------------------------------------------------- fixtures

const USERS = [
    { email: 'ada@atlas.local', firstName: 'Ada', lastName: 'Okonkwo', role: 'admin', timezone: 'UTC' },
    { email: 'simon@atlas.local', firstName: 'Simon', lastName: 'Vega', role: 'manager', timezone: 'Europe/Madrid' },
    { email: 'priya@atlas.local', firstName: 'Priya', lastName: 'Raman', role: 'manager', timezone: 'Asia/Kolkata' },
    { email: 'marcus@atlas.local', firstName: 'Marcus', lastName: 'Holt', role: 'member', timezone: 'America/New_York' },
    { email: 'yuki@atlas.local', firstName: 'Yuki', lastName: 'Tanaka', role: 'member', timezone: 'Asia/Tokyo' },
] as const;

const TEAMS = [
    { name: 'Product', slug: 'product', members: ['ada@atlas.local', 'priya@atlas.local', 'yuki@atlas.local'] },
    { name: 'Engineering', slug: 'engineering', members: ['simon@atlas.local', 'marcus@atlas.local', 'priya@atlas.local'] },
    { name: 'Growth', slug: 'growth', members: ['ada@atlas.local', 'marcus@atlas.local'] },
] as const;

const LABELS = [
    { name: 'Bug', color: '#dc2626' },
    { name: 'Feature', color: '#2563eb' },
    { name: 'Design', color: '#9333ea' },
    { name: 'Blocking', color: '#ea580c' },
    { name: 'Improvement', color: '#0d9488' },
    { name: 'Launch', color: '#ca8a04' },
] as const;

type ProjectSpec = {
    name: string;
    description: string;
    color: string;
    team: string;
    lead: string;
    members: string[];
    startDaysAgo: number;
    dueDaysAhead: number;
    visibility?: 'organization' | 'private';
    tasks: string[];
};

const PROJECTS: ProjectSpec[] = [
    {
        name: 'Website Relaunch',
        description: 'Marketing site rebuild on the new design system, ahead of the Q4 launch.',
        color: '#6366f1',
        team: 'engineering',
        lead: 'simon@atlas.local',
        members: ['simon@atlas.local', 'marcus@atlas.local', 'priya@atlas.local', 'ada@atlas.local'],
        startDaysAgo: 60,
        dueDaysAhead: 21,
        tasks: [
            'Audit current site content and redirect map',
            'Define design system tokens (colour, spacing, type)',
            'Wireframes for homepage, pricing, docs',
            'High-fidelity mockups for homepage',
            'Set up component library in Storybook',
            'Build marketing site scaffolding',
            'Migrate blog to MDX',
            'Implement pricing page with annual toggle',
            'Add internationalisation scaffolding',
            'Performance budget: LCP under 2s on 4G',
            'Replace legacy hero carousel with static video',
            'SEO: structured data and sitemap',
            'Fix mobile nav overflow on small screens',
            'Accessibility pass: contrast and focus rings',
            'Cookie consent banner',
            'Contact form -> CRM integration',
            'Staging deploy pipeline',
            'Load test the pricing page',
            'Content freeze for launch',
            'Launch checklist and rollback plan',
            'Post-launch analytics dashboard',
        ],
    },
    {
        name: 'Mobile App v2',
        description: 'Offline-first rewrite of the mobile client with push notifications.',
        color: '#0ea5e9',
        team: 'product',
        lead: 'priya@atlas.local',
        members: ['priya@atlas.local', 'yuki@atlas.local', 'ada@atlas.local', 'marcus@atlas.local'],
        startDaysAgo: 45,
        dueDaysAhead: 40,
        tasks: [
            'Customer interviews: top 5 complaints',
            'Write v2 product requirements document',
            'Prioritise backlog with sales',
            'Sync engine design: conflict resolution',
            'Prototype offline task editor',
            'Push notification service',
            'Deep link routing',
            'Biometric login',
            'Migrate local storage schema',
            'Crash-free sessions target 99.5%',
            'Reduce cold start below 1.5s',
            'Dark mode',
            'Tablet layout',
            'App store screenshots and copy',
            'Beta group of 200 users',
            'Fix: task list jumps when dragging',
            'Fix: duplicate reminders on Android 14',
            'Instrument onboarding funnel',
            'Security review of token storage',
            'Release candidate 1',
        ],
    },
    {
        name: 'Q4 Launch Campaign',
        description: 'Positioning, pricing narrative and channels for the v2 launch.',
        color: '#f59e0b',
        team: 'growth',
        lead: 'ada@atlas.local',
        members: ['ada@atlas.local', 'marcus@atlas.local', 'yuki@atlas.local'],
        startDaysAgo: 30,
        dueDaysAhead: 12,
        visibility: 'private' as const,
        tasks: [
            'Positioning statement for v2',
            'Pricing narrative and packaging',
            'Competitive comparison sheet',
            'Landing page for launch',
            'Email drip: 5 messages',
            'Launch-day blog post',
            'Press list and outreach',
            'Analyst briefing deck',
            'Paid search: keyword research',
            'Demo video, 90 seconds',
            'Customer case study: Acme Retail',
            'Community AMA planning',
            'Social calendar',
            'Sales enablement training',
            'Define campaign success metrics',
            'Post-launch retro',
        ],
    },
];

const COMMENT_BODIES = [
    'Pushed a first draft — feedback welcome before I go further.',
    'Blocked on the API contract, can we sync today?',
    'I ran the numbers twice, this estimate looks optimistic.',
    'Moving this to review; the edge case for empty results is covered by a test now.',
    'Let us split this into two tasks, it keeps growing.',
    'Design signed off in the review doc.',
    'Heads up: this slipped because of the staging outage.',
    'Nice, this unblocks the migration work.',
    'Can we get a screenshot for the launch post?',
    'Reduced scope to the must-haves so we keep the date.',
];

const DESCRIPTIONS = [
    'Scope, risks and acceptance criteria live in the linked doc.',
    'Owner drives it; flag blockers in the comments as soon as they appear.',
    'Definition of done: shipped to production behind a flag with a rollback plan.',
    'Cross-team dependency — coordinate before starting.',
    null,
    null,
];

// ---------------------------------------------------------------- seeding

async function reset() {
    // Child-first order; every relation also declares onDelete: Cascade.
    await prisma.notification.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.taskLabel.deleteMany();
    await prisma.taskAssignee.deleteMany();
    await prisma.task.deleteMany();
    await prisma.section.deleteMany();
    await prisma.label.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.project.deleteMany();
    await prisma.teamMember.deleteMany();
    await prisma.team.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
}

const STATUS_SECTION: Record<TaskStatus, string> = {
    todo: 'Backlog',
    in_progress: 'In progress',
    in_review: 'In review',
    done: 'Done',
    canceled: 'Done',
};

async function main() {
    const existing = await prisma.organization.findUnique({ where: { slug: DEMO_ORG_SLUG } });
    if (existing && !process.argv.includes('--force')) {
        console.log(`Demo org "${DEMO_ORG_SLUG}" already exists — run with --force to reseed.`);
        return;
    }
    if (existing) {
        console.log('Resetting existing Atlas data…');
        await reset();
    }

    const passwordHash = await hashPassword(DEMO_PASSWORD);

    const users = new Map<string, string>();
    for (const spec of USERS) {
        const user = await prisma.user.create({
            data: {
                email: spec.email,
                firstName: spec.firstName,
                lastName: spec.lastName,
                timezone: spec.timezone,
                passwordHash,
                prefs: JSON.stringify({ emailOnAssign: true, emailOnComment: true, emailDigest: true }),
                createdAt: hoursAgo(intBetween(900, 1600)),
            },
        });
        users.set(spec.email, user.id);
    }
    const adminId = users.get('ada@atlas.local')!;

    const org = await prisma.organization.create({
        data: {
            name: 'Acme Labs',
            slug: DEMO_ORG_SLUG,
            ownerId: adminId,
            createdAt: hoursAgo(880),
        },
    });

    for (const spec of USERS) {
        await prisma.organizationMember.create({
            data: { orgId: org.id, userId: users.get(spec.email)!, role: spec.role, createdAt: hoursAgo(880) },
        });
    }

    const teams = new Map<string, string>();
    for (const spec of TEAMS) {
        const team = await prisma.team.create({ data: { orgId: org.id, name: spec.name, slug: spec.slug } });
        teams.set(spec.slug, team.id);
        for (const email of spec.members) {
            await prisma.teamMember.create({ data: { teamId: team.id, userId: users.get(email)! } });
        }
    }

    const labels = new Map<string, string>();
    for (const spec of LABELS) {
        const label = await prisma.label.create({ data: { orgId: org.id, name: spec.name, color: spec.color } });
        labels.set(spec.name, label.id);
    }

    const activities: { orgId: string; projectId: string | null; taskId: string | null; actorId: string; type: string; meta: string; createdAt: Date }[] = [];
    const notifications: { userId: string; orgId: string; type: string; title: string; body: string; link: string; createdAt: Date; readAt: Date | null }[] = [];
    let taskCount = 0;
    let commentCount = 0;

    for (const spec of PROJECTS) {
        const leadId = users.get(spec.lead)!;
        const project = await prisma.project.create({
            data: {
                orgId: org.id,
                teamId: teams.get(spec.team),
                name: spec.name,
                description: spec.description,
                color: spec.color,
                visibility: spec.visibility ?? 'organization',
                status: 'active',
                startDate: hoursAgo(spec.startDaysAgo * 24),
                dueDate: hoursFromNow(spec.dueDaysAhead * 24),
                createdById: leadId,
                createdAt: hoursAgo(spec.startDaysAgo * 24),
            },
        });

        const positionBySection = new Map<string, number>();
        const sections = new Map<string, string>();
        for (const [index, section] of DEFAULT_SECTIONS.entries()) {
            const created = await prisma.section.create({
                data: { projectId: project.id, name: section.name, isDone: section.isDone, position: (index + 1) * 1000 },
            });
            sections.set(section.name, created.id);
            positionBySection.set(created.id, 1000);
        }

        await prisma.projectMember.create({ data: { projectId: project.id, userId: leadId, role: 'lead' } });
        for (const email of spec.members.filter((m) => m !== spec.lead)) {
            await prisma.projectMember.create({ data: { projectId: project.id, userId: users.get(email)!, role: 'member' } });
        }

        activities.push({
            orgId: org.id,
            projectId: project.id,
            taskId: null,
            actorId: leadId,
            type: 'project.created',
            meta: JSON.stringify({ name: project.name }),
            createdAt: project.createdAt,
        });

        const memberIds = spec.members.map((email) => users.get(email)!);

        for (const [taskIndex, title] of spec.tasks.entries()) {
            const createdHoursAgo = intBetween(24, spec.startDaysAgo * 24 - 4);
            const createdAt = hoursAgo(createdHoursAgo);

            const status = pickWeighted<TaskStatus>({
                todo: 26,
                in_progress: 22,
                in_review: 12,
                done: 34,
                canceled: 6,
            });
            const priority = pickWeighted<TaskPriority>({
                none: 24,
                low: 20,
                medium: 34,
                high: 16,
                urgent: 6,
            });

            const sectionName = STATUS_SECTION[status];
            const sectionId = sections.get(sectionName)!;
            const nextPosition = (positionBySection.get(sectionId) ?? 1000) + 1000;
            positionBySection.set(sectionId, nextPosition);

            const creatorId = pick(memberIds);
            const isDone = status === 'done' || status === 'canceled';
            const completionHours = Math.min(createdHoursAgo - 1, intBetween(6, 200));
            const completedAt = isDone ? new Date(createdAt.getTime() + completionHours * 3_600_000) : null;

            let dueDate: Date | null = null;
            if (chance(0.82)) {
                const spanDays = intBetween(2, 18);
                dueDate = new Date(createdAt.getTime() + spanDays * 86_400_000);
                // Keep open work split between "needs attention now" and "coming up".
                if (!isDone && dueDate.getTime() < NOW.getTime() && chance(0.5)) dueDate = hoursFromNow(intBetween(4, 240));
            }

            const task = await prisma.task.create({
                data: {
                    projectId: project.id,
                    sectionId,
                    title,
                    description: pick(DESCRIPTIONS),
                    status,
                    priority,
                    dueDate,
                    startDate: chance(0.6) ? createdAt : null,
                    estimateMins: chance(0.5) ? intBetween(2, 26) * 30 : null,
                    isMilestone: taskIndex % 7 === 3,
                    position: nextPosition,
                    createdById: creatorId,
                    completedAt,
                    createdAt,
                },
            });
            taskCount += 1;

            activities.push({
                orgId: org.id,
                projectId: project.id,
                taskId: task.id,
                actorId: creatorId,
                type: 'task.created',
                meta: JSON.stringify({ title: task.title }),
                createdAt,
            });

            const assigneeCount = pick([0, 1, 1, 1, 2, 2, 3]);
            const assignees = shuffle(memberIds).slice(0, assigneeCount);
            for (const [i, userId] of assignees.entries()) {
                await prisma.taskAssignee.create({
                    data: { taskId: task.id, userId, isPrimary: i === 0, createdAt },
                });
                activities.push({
                    orgId: org.id,
                    projectId: project.id,
                    taskId: task.id,
                    actorId: creatorId,
                    type: 'task.assigned',
                    meta: JSON.stringify({ title: task.title }),
                    createdAt,
                });
                notifications.push({
                    userId,
                    orgId: org.id,
                    type: 'task.assigned',
                    title: `You were assigned: ${task.title}`,
                    body: `in ${project.name}`,
                    link: `/projects/${project.id}/tasks/${task.id}`,
                    createdAt,
                    readAt: isDone || chance(0.5) ? new Date(createdAt.getTime() + intBetween(1, 40) * 3_600_000) : null,
                });
            }

            if (isDone && completedAt) {
                activities.push({
                    orgId: org.id,
                    projectId: project.id,
                    taskId: task.id,
                    actorId: assignees[0] ?? creatorId,
                    type: 'task.completed',
                    meta: JSON.stringify({ title: task.title, from: 'in_progress', to: status }),
                    createdAt: completedAt,
                });
            } else if (status === 'in_review' || status === 'in_progress') {
                activities.push({
                    orgId: org.id,
                    projectId: project.id,
                    taskId: task.id,
                    actorId: assignees[0] ?? creatorId,
                    type: 'task.status_changed',
                    meta: JSON.stringify({ title: task.title, from: 'todo', to: status }),
                    createdAt: new Date(createdAt.getTime() + intBetween(4, 90) * 3_600_000),
                });
            }

            const labelCount = pick([0, 0, 1, 1, 2]);
            for (const name of shuffle([...labels.keys()]).slice(0, labelCount)) {
                await prisma.taskLabel.create({ data: { taskId: task.id, labelId: labels.get(name)! } });
            }

            // Subtasks on a few items, always inheriting the parent project/section.
            if (chance(0.18)) {
                for (const childTitle of ['Investigate', 'Write it up'] as const) {
                    const childStatus = isDone ? 'done' : pick(['todo', 'in_progress', 'in_review'] as const);
                    const childCreated = new Date(createdAt.getTime() + intBetween(1, 30) * 3_600_000);
                    const child = await prisma.task.create({
                        data: {
                            projectId: project.id,
                            sectionId: sections.get(STATUS_SECTION[childStatus])!,
                            parentTaskId: task.id,
                            title: `${childTitle}: ${task.title}`.slice(0, 120),
                            status: childStatus,
                            priority: 'low',
                            dueDate: task.dueDate,
                            createdById: creatorId,
                            completedAt: childStatus === 'done' ? new Date(childCreated.getTime() + intBetween(2, 48) * 3_600_000) : null,
                            createdAt: childCreated,
                        },
                    });
                    taskCount += 1;
                    activities.push({
                        orgId: org.id,
                        projectId: project.id,
                        taskId: child.id,
                        actorId: creatorId,
                        type: 'subtask.created',
                        meta: JSON.stringify({ title: child.title, parentTitle: task.title }),
                        createdAt: childCreated,
                    });
                }
            }

            if (chance(0.45)) {
                const watchers = [...new Set([creatorId, ...assignees])];
                const discussers = assignees.length ? assignees : memberIds;
                for (const body of shuffle(COMMENT_BODIES).slice(0, intBetween(1, 3))) {
                    const authorId = pick(discussers);
                    const at = new Date(createdAt.getTime() + intBetween(2, Math.max(3, createdHoursAgo)) * 3_600_000);
                    if (at > NOW) continue;
                    const comment = await prisma.comment.create({ data: { taskId: task.id, authorId, body, createdAt: at } });
                    commentCount += 1;
                    activities.push({
                        orgId: org.id,
                        projectId: project.id,
                        taskId: task.id,
                        actorId: authorId,
                        type: 'comment.added',
                        meta: JSON.stringify({ title: task.title }),
                        createdAt: at,
                    });
                    for (const watcher of watchers.filter((w) => w !== authorId)) {
                        notifications.push({
                            userId: watcher,
                            orgId: org.id,
                            type: 'comment.added',
                            title: `New comment on ${task.title}`,
                            body: comment.body.slice(0, 120),
                            link: `/projects/${project.id}/tasks/${task.id}`,
                            createdAt: at,
                            readAt: chance(0.4) ? new Date(at.getTime() + 3_600_000) : null,
                        });
                    }
                }
            }
        }
    }

    for (const batch of chunk(activities, 200)) await prisma.activity.createMany({ data: batch });
    for (const batch of chunk(notifications, 200)) await prisma.notification.createMany({ data: batch });

    // One pending invitation so the members screen has something to show.
    const inviteToken = 'demo-invite-token';
    await prisma.invitation.create({
        data: {
            orgId: org.id,
            email: 'newhire@atlas.local',
            role: 'member',
            tokenHash: inviteToken,
            invitedById: adminId,
            expiresAt: hoursFromNow(7 * 24),
        },
    });

    const summary = {
        organization: org.slug,
        users: USERS.length,
        projects: PROJECTS.length,
        tasks: taskCount,
        comments: commentCount,
        activities: activities.length,
        notifications: notifications.length,
        login: `${USERS[0].email} / ${DEMO_PASSWORD}`,
    };
    console.log('Seeded Atlas demo data:', summary);
}

function shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
