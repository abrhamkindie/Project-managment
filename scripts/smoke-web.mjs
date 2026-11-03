#!/usr/bin/env node
/**
 * End-to-end smoke check for the web app against a RUNNING `npm run dev` (or `next start`).
 *
 * It logs in through the web origin — the same `/api` proxy the browser uses — then requests
 * every route as HTML. That catches what a type check cannot: a server component that throws,
 * a redirect loop, a route that was linked from the sidebar but never created.
 *
 * Usage: node scripts/smoke-web.mjs [http://127.0.0.1:3000] [email password]
 * Needs the API running as well (the proxy targets it) and a seeded database.
 */
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const CREDENTIALS = process.argv[3] ? [process.argv[3], process.argv[4]] : ['ada@atlas.local', 'Passw0rd!'];

let cookie = '';
let failures = 0;

async function get(path, { redirect = 'manual' } = {}) {
    const res = await fetch(`${BASE}${path}`, { redirect, headers: cookie ? { cookie } : {} });
    const body = res.status < 300 ? await res.text() : '';
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length) cookie = setCookies.map((entry) => entry.split(';')[0]).join('; ');
    return { status: res.status, location: res.headers.get('location'), body };
}

function check(label, path, result, expect, marker) {
    const pass = expect.includes(result.status) && (marker === undefined || result.body.includes(marker));
    if (!pass) failures += 1;
    const where = expect.includes(result.status) && result.status >= 300 ? `-> ${result.location}` : '';
    const missing = pass || marker === undefined ? '' : ` (missing ${JSON.stringify(marker)})`;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${String(result.status).padEnd(4)} ${label.padEnd(34)} ${path} ${where}${missing}`);
}

const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: CREDENTIALS[0], password: CREDENTIALS[1] }),
});
if (!login.ok) {
    console.error(`Cannot sign in through ${BASE}/api/auth/login — is the API running and seeded?`);
    process.exit(1);
}
const session = await login.json();
for (const entry of login.headers.getSetCookie?.() ?? []) {
    // Keep only the session cookies; the jar is sent to the web origin, not the API origin.
    if (entry.startsWith('atlas_')) cookie = `${cookie ? `${cookie}; ` : ''}${entry.split(';')[0]}`;
}

const slug = session.organizations[0].slug;
const orgName = session.organizations[0].name;
const projects = await (await fetch(`${BASE}/api/organizations/${session.organizations[0].id}/projects`, { headers: { cookie } })).json();
const project = projects.items[0];
const board = await (await fetch(`${BASE}/api/projects/${project.id}/board`, { headers: { cookie } })).json();
const firstTask = board.sections.flatMap((section) => section.tasks)[0] ?? board.unassigned[0];

// ---- signed-in screens ---------------------------------------------------------------------
check('workspace home', `/w/${slug}`, await get(`/w/${slug}`), [307, 308]);
check('dashboard', `/w/${slug}/dashboard`, await get(`/w/${slug}/dashboard`), [200], 'Dashboard');
check('my tasks', `/w/${slug}/my-tasks`, await get(`/w/${slug}/my-tasks`), [200], 'My Tasks');
check('projects', `/w/${slug}/projects`, await get(`/w/${slug}/projects`), [200], 'Projects');
check('members', `/w/${slug}/members`, await get(`/w/${slug}/members`), [200], 'Members');
check('inbox', `/w/${slug}/inbox`, await get(`/w/${slug}/inbox`), [200], 'Inbox');
check('project board', `/w/${slug}/projects/${project.id}`, await get(`/w/${slug}/projects/${project.id}`), [200], orgName);
check('settings', '/settings', await get('/settings'), [200], 'Settings');

// ---- deep links written by the API, which carry no slug -----------------------------------
check('shim /dashboard', '/dashboard', await get('/dashboard'), [307, 308]);
check('shim /my-tasks', '/my-tasks', await get('/my-tasks'), [307, 308]);
check('shim /projects/:id', `/projects/${project.id}`, await get(`/projects/${project.id}`), [307, 308]);
if (firstTask) {
    check('shim task link', `/projects/${project.id}/tasks/${firstTask.id}`, await get(`/projects/${project.id}/tasks/${firstTask.id}`), [307, 308]);
}

// ---- signed-out behaviour ------------------------------------------------------------------
cookie = '';
const guarded = await get(`/w/${slug}/dashboard`);
check('anonymous dashboard redirects', `/w/${slug}/dashboard`, guarded, [307, 308]);
if (guarded.location && !guarded.location.startsWith('/login')) {
    console.log(`FAIL      expected a redirect to /login, got ${guarded.location}`);
    failures += 1;
}
check('login screen', '/login', await get('/login'), [200], 'Sign in');
check('register screen', '/register', await get('/register'), [200], 'Create');
check('invite screen', '/invite', await get('/invite'), [200], 'Atlas');

console.log(failures === 0 ? '\nWEB SMOKE PASSED' : `\nWEB SMOKE FAILED (${failures} problem(s))`);
process.exit(failures === 0 ? 0 : 1);
