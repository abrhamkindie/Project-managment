import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Shared fixtures.
 *
 * Every test signs up its own user and organization, so suites never fight over rows
 * in the single SQLite file. Names are unique per process, and `prisma` is exported for
 * assertions that must look behind the API (activity rows, denormalised columns).
 */

export const app = createApp();
export type Agent = request.Agent;

export const PASSWORD = "Passw0rd!";

let sequence = 0;
export function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${process.env.VITEST_WORKER_ID}-${sequence.toString(36)}`;
}

/**
 * `expect(status)` on its own only reports the code; fixtures answer with the whole
 * error envelope so a failing setup step is readable without re-running in verbose mode.
 */
async function must<T extends request.Response>(
  promise: Promise<T>,
  status: number,
): Promise<T> {
  const res = await promise;
  if (res.status !== status) {
    throw new Error(
      `expected ${status}, got ${res.status}: ${JSON.stringify(res.body ?? res.text)}`,
    );
  }
  return res;
}

export interface Workspace {
  agent: Agent;
  userId: string;
  email: string;
  orgId: string;
  orgRole: string;
}

export async function signUp(orgName = unique("Org")): Promise<Workspace> {
  const agent = request.agent(app);
  const email = `${unique("user")}@zorqen.test`;
  const res = await must(
    agent
      .post("/api/auth/register")
      .send({
        email,
        password: PASSWORD,
        firstName: "Test",
        lastName: "User",
        organizationName: orgName,
      }),
    201,
  );
  return {
    agent,
    email,
    userId: res.body.user.id,
    orgId: res.body.organizations[0].id,
    orgRole: res.body.organizations[0].role,
  };
}

export async function signIn(
  email: string,
  password = PASSWORD,
): Promise<Agent> {
  const agent = request.agent(app);
  await must(agent.post("/api/auth/login").send({ email, password }), 200);
  return agent;
}

/** A second account inside `owner`'s organization, with the requested org role. */
export async function addMember(
  owner: Workspace,
  role: "admin" | "manager" | "member" = "member",
): Promise<Workspace> {
  const email = `${unique("teammate")}@zorqen.test`;
  const created = await must(
    request(app)
      .post("/api/auth/register")
      .send({ email, password: PASSWORD, firstName: "Team", lastName: "Mate" }),
    201,
  );
  const userId = created.body.user.id;
  await prisma.organizationMember.create({
    data: { orgId: owner.orgId, userId, role },
  });
  return {
    agent: await signIn(email),
    email,
    userId,
    orgId: owner.orgId,
    orgRole: role,
  };
}

export interface Board {
  projectId: string;
  sections: { id: string; name: string; isDone: boolean }[];
}

export async function createProject(
  owner: Workspace,
  data: Record<string, unknown> = {},
): Promise<Board & Record<string, unknown>> {
  const res = await must(
    owner.agent
      .post(`/api/organizations/${owner.orgId}/projects`)
      .send({ name: unique("Project"), ...data }),
    201,
  );
  return {
    projectId: res.body.id,
    sections: res.body.sections.map(
      (s: { id: string; name: string; isDone: boolean }) => ({
        id: s.id,
        name: s.name,
        isDone: s.isDone,
      }),
    ),
    ...res.body,
  };
}

export type Card = { id: string } & Record<string, unknown>;

export async function createTask(
  owner: Workspace,
  projectId: string,
  data: Record<string, unknown> = {},
): Promise<Card> {
  const res = await must(
    owner.agent
      .post(`/api/organizations/${owner.orgId}/tasks`)
      .send({ projectId, title: unique("Task"), ...data }),
    201,
  );
  return res.body;
}

export const sectionNamed = (board: Board, name: string) =>
  board.sections.find((s) => s.name === name)!;

/** Error envelope helper: `{ error: { code, message, details } }`. */
export function errorMessage(payload: unknown): string {
  const body = payload as { error?: { message?: string } };
  return body?.error?.message ?? JSON.stringify(payload);
}

/** `set-cookie` is typed as a string on older Node typings; normalise it. */
export function cookieHeaders(response: {
  headers: Record<string, unknown>;
}): string[] {
  const raw = response.headers["set-cookie"];
  if (Array.isArray(raw)) return raw.map(String);
  return raw ? [String(raw)] : [];
}

/** Value of one cookie from a response, for tests that replay a token by hand. */
export function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string {
  const header = cookieHeaders(response).find((c) => c.startsWith(`${name}=`));
  return header ? header.split(";")[0].slice(name.length + 1) : "";
}
