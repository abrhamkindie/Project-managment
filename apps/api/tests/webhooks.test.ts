import { describe, it, expect, beforeAll } from "vitest";
import {
  addMember,
  createProject,
  createTask,
  signUp,
  errorMessage,
  type Workspace,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import {
  attemptDelivery,
  backoffSeconds,
  deliver,
  eventsForActivity,
  queueEvent,
  runWebhookRetries,
  signatureHeader,
  verifySignature,
} from "../src/services/webhook.service.js";

/**
 * Outbound webhooks.
 *
 * The interesting parts are the signature contract (a receiver must be able to prove the body came
 * from us and was not replayed) and the retry state machine (a dead receiver must be retried with
 * backoff and given up on eventually, without ever blocking the user who caused the event).
 */

type FetchInit = { headers: Record<string, string>; body?: string };
type FakeResponse = { ok: boolean; status: number };

const responder =
  (response: FakeResponse) =>
    async (_url: string | URL, init: unknown): Promise<Response> =>
      ({ ok: response.ok, status: response.status, ...({ __init: init }) }) as unknown as Response;

/** Records the last request so the header contract can be asserted. */
function recordingFetch(response: FakeResponse) {
  const calls: { url: string; init: FetchInit }[] = [];
  const impl = (async (url: string | URL, init: unknown) => {
    calls.push({ url: String(url), init: init as FetchInit });
    return { ok: response.ok, status: response.status } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const throwingFetch = (message: string) =>
  (async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;

describe("webhooks", () => {
  let owner: Workspace;
  let projectId: string;

  beforeAll(async () => {
    owner = await signUp();
    const project = await createProject(owner);
    projectId = project.projectId;
  });

  const subscribe = (data: Record<string, unknown> = {}) =>
    prisma.webhook.create({
      data: {
        orgId: owner.orgId,
        url: "https://receiver.test/hook",
        secret: "whsec_test_secret",
        events: JSON.stringify(["task.created"]),
        ...data,
      },
    });

  describe("signatures", () => {
    it("round-trips a correctly signed body", () => {
      const body = JSON.stringify({ event: "task.created", id: 1 });
      const header = signatureHeader("s3cr3t", body);
      expect(verifySignature(header, "s3cr3t", body)).toBe(true);
    });

    it("rejects a tampered body, the wrong secret, and a replayed timestamp", () => {
      const body = '{"a":1}';
      const header = signatureHeader("s3cr3t", body);
      expect(verifySignature(header, "s3cr3t", '{"a":2}')).toBe(false);
      expect(verifySignature(header, "other", body)).toBe(false);

      const hourOld = signatureHeader("s3cr3t", body, Math.floor(Date.now() / 1000) - 3600);
      expect(verifySignature(hourOld, "s3cr3t", body)).toBe(false);
      // …but a receiver that is only slightly behind still accepts it.
      expect(verifySignature(hourOld, "s3cr3t", body, 7200)).toBe(true);
    });

    it("refuses a malformed header instead of throwing", () => {
      expect(verifySignature("not-a-signature", "s3cr3t", "{}")).toBe(false);
      expect(verifySignature("t=abc,v1=def", "s3cr3t", "{}")).toBe(false);
    });
  });

  describe("event mapping", () => {
    it("collapses internal activity rows into the public events", () => {
      expect(eventsForActivity("task.moved")).toEqual(["task.updated"]);
      expect(eventsForActivity("task.bulk_updated")).toEqual(["task.updated"]);
      expect(eventsForActivity("project.member_added")).toEqual(["member.added"]);
      expect(eventsForActivity("task.deleted")).toEqual([]);
    });

    it("fires completion alongside the status change when work lands in Done", () => {
      expect(eventsForActivity("task.status_changed", { to: "todo" })).toEqual([
        "task.status_changed",
      ]);
      expect(eventsForActivity("task.status_changed", { to: "done" })).toEqual([
        "task.status_changed",
        "task.completed",
      ]);
    });

    it("backs off exponentially and caps at a day", () => {
      expect(backoffSeconds(1)).toBe(30);
      expect(backoffSeconds(2)).toBe(120);
      expect(backoffSeconds(3)).toBe(480);
      expect(backoffSeconds(40)).toBe(86_400);
    });
  });

  describe("queueing", () => {
    it("only queues hooks that are active and actually subscribe to the event", async () => {
      const matching = await subscribe();
      const wrongEvent = await subscribe({ events: JSON.stringify(["task.completed"]) });
      const inactive = await subscribe({ events: JSON.stringify(["task.created"]), active: false });
      // A subscription list that merely contains the name as a prefix must still not match.
      const tricky = await subscribe({ events: JSON.stringify(["task.created.x"]) });

      const queued = await queueEvent({
        orgId: owner.orgId,
        event: "task.created",
        projectId,
        data: { title: "queued" },
      });
      expect(queued).toBe(1);

      const ids = [matching.id, wrongEvent.id, inactive.id, tricky.id];
      const rows = await prisma.webhookDelivery.findMany({ where: { webhookId: { in: ids } } });
      expect(rows.map((row) => row.webhookId)).toEqual([matching.id]);
      expect(JSON.parse(rows[0]!.payload).data.title).toBe("queued");

      await prisma.webhook.deleteMany({ where: { orgId: owner.orgId } });
    });

    it("shares one eventId across the hooks fired by a single event", async () => {
      const first = await subscribe();
      const second = await subscribe({ url: "https://other.test/hook" });

      await queueEvent({ orgId: owner.orgId, event: "task.created", data: {} });
      const payloads = await prisma.webhookDelivery.findMany({
        where: { webhookId: { in: [first.id, second.id] } },
        orderBy: { webhookId: "asc" },
      });
      expect(payloads).toHaveLength(2);
      expect(JSON.parse(payloads[0]!.payload).eventId).toBe(
        JSON.parse(payloads[1]!.payload).eventId,
      );

      await prisma.webhook.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    });

    it("queues from the activity write path when a task is created over the API", async () => {
      const hook = await subscribe();
      await createTask(owner, projectId, { title: "fired a webhook" });

      const rows = await prisma.webhookDelivery.findMany({ where: { webhookId: hook.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("pending");
      expect(JSON.parse(rows[0]!.payload).event).toBe("task.created");

      await prisma.webhook.deleteMany({ where: { id: hook.id } });
    });
  });

  describe("delivery", () => {
    it("POSTs a signed body with the delivery headers and marks success", async () => {
      const hook = await subscribe();
      await queueEvent({ orgId: owner.orgId, event: "task.created", data: { title: "hello" } });
      const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hook.id } });

      const { impl, calls } = recordingFetch({ ok: true, status: 204 });
      const result = await deliver(row.id, impl);

      expect(result?.status).toBe("success");
      expect(result?.responseCode).toBe(204);
      const sent = calls[0]!;
      expect(sent.url).toBe("https://receiver.test/hook");
      expect(sent.init.headers["x-zorqen-delivery"]).toBe(row.id);
      expect(sent.init.headers["x-zorqen-event"]).toBe("task.created");
      expect(
        verifySignature(
          sent.init.headers["x-zorqen-signature"],
          "whsec_test_secret",
          row.payload,
        ),
      ).toBe(true);

      const stored = await prisma.webhookDelivery.findUnique({ where: { id: row.id } });
      expect(stored!.status).toBe("success");
      expect(stored!.attempts).toBe(1);

      await prisma.webhook.deleteMany({ where: { id: hook.id } });
    });

    it("retries a failure with backoff and only gives up at the attempt budget", async () => {
      const hook = await subscribe();
      await queueEvent({ orgId: owner.orgId, event: "task.created", data: {} });
      const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hook.id } });

      // `env.WEBHOOK_MAX_ATTEMPTS` defaults to 4.
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await deliver(row.id, throwingFetch("connection reset"));
        expect(result?.status).toBe("pending");
        expect(result?.nextAttemptAt).not.toBeNull();
        const stored = await prisma.webhookDelivery.findUnique({ where: { id: row.id } });
        expect(stored!.attempts).toBe(attempt);
        expect(stored!.status).toBe("pending");
        expect(stored!.error).toBe("connection reset");
      }

      const last = await deliver(row.id, throwingFetch("connection reset"));
      expect(last?.status).toBe("failed");
      expect(last?.nextAttemptAt).toBeNull();
      const terminal = await prisma.webhookDelivery.findUnique({ where: { id: row.id } });
      expect(terminal!.status).toBe("failed");

      await prisma.webhook.deleteMany({ where: { id: hook.id } });
    });

    it("drops queued work for a hook that was switched off", async () => {
      const hook = await subscribe();
      await queueEvent({ orgId: owner.orgId, event: "task.created", data: {} });
      const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hook.id } });
      await prisma.webhook.update({ where: { id: hook.id }, data: { active: false } });

      const { impl, calls } = recordingFetch({ ok: true, status: 200 });
      const result = await deliver(row.id, impl);
      expect(calls).toHaveLength(0);
      expect(result?.status).toBe("failed");
      expect(result?.error).toMatch(/inactive/);

      await prisma.webhook.deleteMany({ where: { id: hook.id } });
    });

    it("treats a non-2xx response as a failure, not a timeout", async () => {
      const { impl } = recordingFetch({ ok: false, status: 500 });
      const result = await attemptDelivery(
        { url: "https://receiver.test/hook", secret: "s", body: "{}", deliveryId: "d", event: "task.created" },
        impl,
      );
      expect(result.status).toBe("failed");
      expect(result.responseCode).toBe(500);
    });

    it("the sweep only claims rows whose backoff has elapsed", async () => {
      const hook = await subscribe();
      const due = await queueEvent({ orgId: owner.orgId, event: "task.created", data: {} });
      expect(due).toBe(1);
      const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: hook.id } });
      // A second row parked in the future must not be attempted yet.
      const future = await prisma.webhookDelivery.create({
        data: { webhookId: hook.id, event: "task.created", payload: "{}", nextAttemptAt: new Date(Date.now() + 600_000) },
      });

      // The sweep builds its own transport, so this is the one place the global is stubbed.
      const realFetch = globalThis.fetch;
      globalThis.fetch = responder({ ok: true, status: 200 }) as unknown as typeof fetch;
      let counts;
      try {
        counts = await runWebhookRetries();
      } finally {
        globalThis.fetch = realFetch;
      }
      expect(counts).toEqual({ attempted: 1, delivered: 1, failed: 0 });

      expect((await prisma.webhookDelivery.findUnique({ where: { id: row.id } }))!.status).toBe("success");
      expect((await prisma.webhookDelivery.findUnique({ where: { id: future.id } }))!.status).toBe("pending");

      await prisma.webhook.deleteMany({ where: { id: hook.id } });
    });
  });

  describe("settings endpoints", () => {
    it("are admin-only", async () => {
      const teammate = await addMember(owner, "member");
      const denied = await teammate.agent
        .get(`/api/organizations/${owner.orgId}/webhooks`)
        .expect(403);
      expect(errorMessage(denied.body)).toMatch(/admin/);
    });

    it("show the signing secret once and never in the list", async () => {
      const created = await owner.agent
        .post(`/api/organizations/${owner.orgId}/webhooks`)
        .send({ url: "https://receiver.test/hook", events: ["task.created"] })
        .expect(201);
      expect(created.body.secret.startsWith("whsec_")).toBe(true);

      const listed = await owner.agent
        .get(`/api/organizations/${owner.orgId}/webhooks`)
        .expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(created.body.secret.slice(6));

      const rotated = await owner.agent
        .post(`/api/organizations/${owner.orgId}/webhooks/${created.body.id}/rotate-secret`)
        .expect(200);
      expect(rotated.body.secret).not.toBe(created.body.secret);

      await owner.agent
        .delete(`/api/organizations/${owner.orgId}/webhooks/${created.body.id}`)
        .expect(200);
      expect(await prisma.webhook.findUnique({ where: { id: created.body.id } })).toBeNull();
    });

    it("validate the URL and the event names", async () => {
      await owner.agent
        .post(`/api/organizations/${owner.orgId}/webhooks`)
        .send({ url: "ftp://receiver.test/hook", events: ["task.created"] })
        .expect(400);
      await owner.agent
        .post(`/api/organizations/${owner.orgId}/webhooks`)
        .send({ url: "https://receiver.test/hook", events: ["task.partied"] })
        .expect(400);
      await owner.agent
        .post(`/api/organizations/${owner.orgId}/webhooks`)
        .send({ url: "https://receiver.test/hook", events: [] })
        .expect(400);
    });

    it("report the delivery log without shipping payloads back to the browser", async () => {
      const created = await owner.agent
        .post(`/api/organizations/${owner.orgId}/webhooks`)
        .send({ url: "https://receiver.test/log", events: ["task.created"] })
        .expect(201);
      await createTask(owner, projectId, { title: "logged delivery" });

      const deliveries = await owner.agent
        .get(`/api/organizations/${owner.orgId}/webhooks/${created.body.id}/deliveries`)
        .expect(200);
      expect(deliveries.body.total).toBeGreaterThanOrEqual(1);
      expect(deliveries.body.items[0].payloadBytes).toBeGreaterThan(0);
      expect(deliveries.body.items[0].payload).toBeUndefined();

      await owner.agent
        .delete(`/api/organizations/${owner.orgId}/webhooks/${created.body.id}`)
        .expect(200);
    });

    it("404 a webhook from another organization rather than leaking it", async () => {
      const other = await signUp();
      const foreign = await subscribe();
      await other.agent
        .patch(`/api/organizations/${other.orgId}/webhooks/${foreign.id}`)
        .send({ active: false })
        .expect(404);
      await prisma.webhook.delete({ where: { id: foreign.id } });
    });
  });
});
