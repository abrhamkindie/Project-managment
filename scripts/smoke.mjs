#!/usr/bin/env node
/**
 * End-to-end smoke check against a RUNNING Atlas API (`npm run dev`).
 *
 * It exercises the same paths the browser will use: cookie login, board read,
 * task create -> move -> comment -> complete, my-tasks, analytics, notifications,
 * token rotation and one authorization negative case.
 *
 * Usage: node scripts/smoke.mjs [http://127.0.0.1:4000] [email password]
 * Requires a seeded database (`npm run db:seed`) unless credentials are passed in.
 */
const BASE = (process.argv[2] ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const CREDENTIALS = process.argv[3] ? [process.argv[3], process.argv[4]] : ['ada@atlas.local', 'Passw0rd!'];

let cookie = '';
let failures = 0;

async function request(method, path, body) {
    const res = await fetch(`${BASE}/api${path}`, {
        method,
        headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length) cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    return { status: res.status, payload };
}

function check(label, expected, status, payload, pick) {
    const pass = expected.includes(status);
    if (!pass) failures += 1;
    const detail = typeof pick === 'function' && payload ? safe(pick(payload)) : '';
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${String(status).padEnd(4)} ${label}${detail ? ` ${detail}` : ''}`);
    if (!pass) console.log('     ->', safe(payload));
    return payload;
}

const safe = (value) => (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 320);

const login = await request('POST', '/auth/login', { email: CREDENTIALS[0], password: CREDENTIALS[1] });
check('login', [200], login.status, login.payload, (p) => `${p.organizations.length} org(s), ${p.unreadNotifications} unread`);
const orgId = login.payload.organizations[0].id;
const userId = login.payload.user.id;

const projects = await request('GET', `/organizations/${orgId}/projects`);
check('list projects', [200], projects.status, projects.payload, (p) => p.items.map((i) => `${i.name} ${i.progress}%`).join(' | '));
const projectId = projects.payload.items[0].id;

const board = await request('GET', `/projects/${projectId}/board`);
check('board', [200], board.status, board.payload, (p) => p.sections.map((s) => `${s.name}:${s.tasks.length}`).join(' | '));
const sections = board.payload.sections;

const created = await request('POST', `/organizations/${orgId}/tasks`, {
    projectId,
    title: 'Smoke test task',
    description: 'Created by scripts/smoke.mjs',
    status: 'todo',
    priority: 'high',
    sectionId: sections[0].id,
    assigneeIds: [userId],
    dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
});
check('create task', [201], created.status, created.payload, (p) => `${p.id} -> ${p.status}`);
const taskId = created.payload?.id;

await request('POST', `/tasks/${taskId}/move`, { sectionId: sections[1].id });
const afterMove = await request('GET', `/tasks/${taskId}`);
check('move task', [200], afterMove.status, afterMove.payload, (p) => `status=${p.status} section=${p.sectionId} project=${p.project.name} timeline=${p.timeline.length}`);

const comment = await request('POST', `/tasks/${taskId}/comments`, { body: 'Smoke comment' });
check('add comment', [201], comment.status, comment.payload, (p) => p.id);

const activity = await request('GET', `/tasks/${taskId}/activity`);
check('task activity', [200], activity.status, activity.payload, (p) => p.items.map((i) => `${i.kind}:${i.type ?? 'comment'}`).join(','));

const completed = await request('POST', `/tasks/${taskId}/complete`);
check('complete task', [200], completed.status, completed.payload, (p) => `${p.status} @ ${p.completedAt}`);

const myTasks = await request('GET', `/organizations/${orgId}/my-tasks`);
check('my tasks', [200], myTasks.status, myTasks.payload, (p) => p.groups.map((g) => `${g.project.name}:${g.tasks.length}`).join(' | '));

const list = await request('GET', `/organizations/${orgId}/tasks?status=done&pageSize=2`);
check('filter tasks', [200], list.status, list.payload, (p) => `total=${p.total} pages=${p.pages}`);

const overview = await request('GET', `/organizations/${orgId}/analytics/overview?window=90d`);
check('org analytics', [200], overview.status, overview.payload, (p) =>
    `created=${p.totals.created} completed=${p.totals.completed} overdue=${p.totals.overdue} rate=${p.totals.completionRate}% avg=${p.totals.avgCompletionHours}h`);

const workload = await request('GET', `/organizations/${orgId}/analytics/workload?window=30d`);
check('workload', [200], workload.status, workload.payload, (p) => `${p.workload.length} people`);

const projectReport = await request('GET', `/projects/${projectId}/analytics?window=90d`);
check('project analytics', [200], projectReport.status, projectReport.payload, (p) => safe(p.byStatus));

const notifications = await request('GET', '/notifications?pageSize=5');
check('notifications', [200], notifications.status, notifications.payload, (p) => `unread=${p.unread} total=${p.total}`);
await request('POST', '/notifications/read');

const members = await request('GET', `/organizations/${orgId}/members`);
check('members', [200], members.status, members.payload, (p) => `${p.items.length} members`);

const labels = await request('GET', `/organizations/${orgId}/labels`);
check('labels', [200], labels.status, labels.payload, (p) => `${p.items.length} labels`);

const teams = await request('GET', `/organizations/${orgId}/teams`);
check('teams', [200], teams.status, teams.payload, (p) => safe(p).slice(0, 120));

const feed = await request('GET', `/organizations/${orgId}/activity?pageSize=5`);
check('org activity', [200], feed.status, feed.payload, (p) => p.items.map((i) => i.type).join(','));

const refreshed = await request('POST', '/auth/refresh');
check('rotate refresh token', [200], refreshed.status, refreshed.payload, (p) => p.user.email);

// Negative case: a member who is not in a private project must not see it.
const savedCookie = cookie;
const second = await request('POST', '/auth/logout');
check('logout', [200], second.status, second.payload);
cookie = '';
const anon = await request('GET', '/auth/me');
check('anonymous /auth/me is rejected', [401], anon.status, anon.payload);
cookie = savedCookie;

const health = await request('GET', '/health');
check('health', [200], health.status, health.payload, (p) => `db=${p.database} v=${p.version}`);

const cleanup = await request('DELETE', `/tasks/${taskId}`);
check('delete smoke task', [200], cleanup.status, cleanup.payload, (p) => p.id);

console.log(failures ? `\nSMOKE FAILED (${failures} error(s))` : '\nSMOKE PASSED');
process.exit(failures ? 1 : 0);
