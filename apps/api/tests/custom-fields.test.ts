import { describe, it, expect, beforeAll } from "vitest";
import {
    addMember,
    createProject,
    createTask,
    errorMessage,
    signUp,
    unique,
    type Workspace,
} from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { coerceFieldValue } from "../src/services/custom-field.service.js";

/**
 * Custom fields (Phase 6): definitions, per-task values, filtering, and the export columns.
 *
 * The interesting surface is the type rule, because the database stores every value as a string:
 * nothing but this service knows that a "number" field must hold a number.
 */

async function createField(
    owner: Workspace,
    data: Record<string, unknown>,
) {
    return owner.agent.post(`/api/organizations/${owner.orgId}/fields`).send(data);
}

describe("custom fields", () => {
    let owner: Workspace;
    let projectId: string;

    beforeAll(async () => {
        owner = await signUp();
        const project = await createProject(owner);
        projectId = project.projectId;
    });

    it("refuses a shape the type cannot honour", async () => {
        const selectWithoutOptions = await createField(owner, {
            name: "Release tier",
            type: "select",
        });
        expect(selectWithoutOptions.status).toBe(400);
        expect(selectWithoutOptions.body.error.details?.[0]?.path).toBe("options");

        const textWithOptions = await createField(owner, {
            name: "Business owner",
            type: "text",
            options: ["a", "b"],
        });
        expect(textWithOptions.status).toBe(400);
    });

    it("keeps organization-wide shapes for managers only", async () => {
        const member = await addMember(owner, "member");
        const denied = await member.agent
            .post(`/api/organizations/${member.orgId}/fields`)
            .send({ name: "Compliance tier", type: "text" });
        expect(denied.status).toBe(403);

        const manager = await addMember(owner, "manager");
        const allowed = await createField(manager, {
            name: unique("Owner"),
            type: "text",
        });
        expect(allowed.status).toBe(201);
        expect(allowed.body.projectId).toBeNull();
    });

    it("creates the five types and rejects a duplicate name in one scope", async () => {
        const tier = await createField(owner, {
            name: "Release tier",
            type: "select",
            projectId,
            options: ["alpha", "beta", "ga"],
        });
        expect(tier.status).toBe(201);
        expect(tier.body.options).toEqual(["alpha", "beta", "ga"]);

        for (const type of ["text", "number", "date", "checkbox"]) {
            const res = await createField(owner, { name: `${type} field`, type, projectId });
            expect(res.status).toBe(201);
            expect(res.body.type).toBe(type);
        }

        const duplicate = await createField(owner, {
            name: "Release tier",
            type: "select",
            projectId,
            options: ["x"],
        });
        expect(duplicate.status).toBe(409);
        expect(errorMessage(duplicate.body)).toContain("Release tier");
    });

    it("lists organization-wide fields on their own, and a project's set with them", async () => {
        const orgWide = await createField(owner, { name: unique("Critical?"), type: "checkbox" });
        expect(orgWide.status).toBe(201);

        const plain = await owner.agent
            .get(`/api/organizations/${owner.orgId}/fields`)
            .expect(200);
        expect(plain.body.items.every((item: { projectId: string | null }) => item.projectId === null)).toBe(true);

        const scoped = await owner.agent
            .get(`/api/organizations/${owner.orgId}/fields?projectId=${projectId}`)
            .expect(200);
        const names = scoped.body.items.map((item: { name: string }) => item.name);
        expect(names).toContain("Release tier");
        expect(names).toContain(orgWide.body.name);
    });

    it("validates a value against its field type", async () => {
        const task = await createTask(owner, projectId);
        const fields = await owner.agent.get(`/api/tasks/${task.id}/fields`).expect(200);
        const byName = new Map<string, string>(
            fields.body.items.map((item: { name: string; id: string }): [string, string] => [item.name, item.id]),
        );

        const badNumber = await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { [byName.get("number field")!]: "twelve" } });
        expect(badNumber.status).toBe(400);
        expect(errorMessage(badNumber.body)).toContain("number");

        const badOption = await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { [byName.get("Release tier")!]: "gamma" } });
        expect(badOption.status).toBe(400);
        expect(errorMessage(badOption.body)).toContain("option");

        const foreign = await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { "field-does-not-exist": "x" } });
        expect(foreign.status).toBe(400);

        const saved = await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({
                values: {
                    [byName.get("Release tier")!]: "beta",
                    [byName.get("number field")!]: 12,
                    [byName.get("date field")!]: "2026-03-04",
                    [byName.get("checkbox field")!]: true,
                    [byName.get("text field")!]: "platform team",
                },
            })
            .expect(200);
        const values = new Map<string, string>(
            saved.body.fields.map((row: { fieldId: string; value: string }): [string, string] => [row.fieldId, row.value]),
        );
        expect(values.get(byName.get("Release tier")!)).toBe("beta");
        expect(values.get(byName.get("number field")!)).toBe("12");
        expect(values.get(byName.get("date field")!)).toBe("2026-03-04");
        expect(values.get(byName.get("checkbox field")!)).toBe("true");
        expect(values.get(byName.get("text field")!)).toBe("platform team");

        // Every stored value is a plain string, so the card and the export cannot disagree about it.
        const rows = await prisma.taskFieldValue.findMany({ where: { taskId: task.id } });
        expect(rows).toHaveLength(5);
    });

    it("surfaces values on the task detail and the board card", async () => {
        const task = await createTask(owner, projectId);
        const fields = await owner.agent.get(`/api/tasks/${task.id}/fields`).expect(200);
        const tier = fields.body.items.find((item: { name: string }) => item.name === "Release tier");
        await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { [tier.id]: "ga" } })
            .expect(200);

        const detail = await owner.agent.get(`/api/tasks/${task.id}`).expect(200);
        expect(detail.body.fields).toEqual([{ fieldId: tier.id, value: "ga" }]);

        const board = await owner.agent.get(`/api/projects/${projectId}/board`).expect(200);
        const cards = board.body.sections.flatMap((s: { tasks: Record<string, unknown>[] }) => s.tasks);
        const card = cards.find((c: { id: string }) => c.id === task.id);
        expect(card.fields).toEqual([{ fieldId: tier.id, value: "ga" }]);
    });

    it("treats an empty value as a clear, and leaves other fields alone", async () => {
        const task = await createTask(owner, projectId);
        const fields = await owner.agent.get(`/api/tasks/${task.id}/fields`).expect(200);
        const byName = new Map<string, string>(
            fields.body.items.map((item: { name: string; id: string }): [string, string] => [item.name, item.id]),
        );
        await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({
                values: {
                    [byName.get("text field")!]: "keep me",
                    [byName.get("number field")!]: 3,
                },
            })
            .expect(200);

        const cleared = await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { [byName.get("number field")!]: null, [byName.get("text field")!]: "   " } })
            .expect(200);
        // The empty string is a clear too, so nothing is left behind...
        expect(cleared.body.fields).toEqual([]);

        await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { [byName.get("text field")!]: "keep me" } })
            .expect(200);
        const after = await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { [byName.get("date field")!]: "2026-05-05" } })
            .expect(200);
        // ...and a save that touches one field must not erase another.
        const values = new Map<string, string>(
            after.body.fields.map((row: { fieldId: string; value: string }): [string, string] => [row.fieldId, row.value]),
        );
        expect(values.get(byName.get("text field")!)).toBe("keep me");
        expect(values.get(byName.get("date field")!)).toBe("2026-05-05");
    });

    it("filters the task list by a custom field", async () => {
        // Fields created just for this case: the shared project already carries values from the earlier
        // tests, and a filter that expects "nothing matches" needs a field nothing else has touched.
        const tierField = await createField(owner, {
            name: unique("Filter tier"),
            type: "select",
            options: ["alpha", "beta"],
        });
        const ownerField = await createField(owner, { name: unique("Filter owner"), type: "text" });

        const [a, b] = [await createTask(owner, projectId), await createTask(owner, projectId)];
        await owner.agent
            .patch(`/api/tasks/${a.id}/fields`)
            .send({ values: { [tierField.body.id]: "alpha", [ownerField.body.id]: "platform team" } })
            .expect(200);
        await owner.agent
            .patch(`/api/tasks/${b.id}/fields`)
            .send({ values: { [tierField.body.id]: "beta", [ownerField.body.id]: "growth team" } })
            .expect(200);

        const bySelect = (value: unknown) =>
            owner.agent.get(
                `/api/organizations/${owner.orgId}/tasks?projectId=${projectId}&fieldFilters=${encodeURIComponent(
                    JSON.stringify([{ fieldId: tierField.body.id, value }]),
                )}`,
            );

        const alpha = await bySelect("alpha").expect(200);
        expect(alpha.body.items.map((item: { id: string }) => item.id)).toEqual([a.id]);

        // A select can only ever hold an option it offers, so a filter naming another one is a client
        // bug rather than an empty page - and it is refused by the same rule the drawer enforces.
        const impossible = await bySelect("ga");
        expect(impossible.status).toBe(400);
        expect(errorMessage(impossible.body)).toContain("option");

        // Two filters AND: nothing is both `alpha` and owned by the growth team.
        const both = await owner.agent
            .get(
                `/api/organizations/${owner.orgId}/tasks?projectId=${projectId}&fieldFilters=${encodeURIComponent(
                    JSON.stringify([
                        { fieldId: tierField.body.id, value: "alpha" },
                        { fieldId: ownerField.body.id, value: "growth team" },
                    ]),
                )}`,
            )
            .expect(200);
        expect(both.body.items).toHaveLength(0);

        // Text is a substring match: that is what a free-text field invites.
        const textFilter = await owner.agent
            .get(
                `/api/organizations/${owner.orgId}/tasks?projectId=${projectId}&fieldFilters=${encodeURIComponent(
                    JSON.stringify([{ fieldId: ownerField.body.id, value: "team" }]),
                )}`,
            )
            .expect(200);
        expect(textFilter.body.items.map((item: { id: string }) => item.id).sort()).toEqual(
            [a.id, b.id].sort(),
        );

        const unknown = await owner.agent.get(
            `/api/organizations/${owner.orgId}/tasks?fieldFilters=${encodeURIComponent(
                JSON.stringify([{ fieldId: "nope", value: "x" }]),
            )}`,
        );
        expect(unknown.status).toBe(400);
    });

    it("appends chosen columns to the CSV export", async () => {
        const task = await createTask(owner, projectId, { title: "Export me" });
        const fields = await owner.agent.get(`/api/tasks/${task.id}/fields`).expect(200);
        const tier = fields.body.items.find((item: { name: string }) => item.name === "Release tier");
        await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { [tier.id]: "beta" } })
            .expect(200);

        const res = await owner.agent
            .get(`/api/projects/${projectId}/export?fields=${tier.id}`)
            .expect(200);
        const [header] = res.text.split("\r\n");
        expect(header.endsWith("Release tier")).toBe(true);
        const exportedRow = res.text.split("\r\n").find((line) => line.includes("Export me"));
        expect(exportedRow?.endsWith(",beta")).toBe(true);

        // An id that is not a field of this project costs a column, not the whole file.
        const stale = await owner.agent
            .get(`/api/projects/${projectId}/export?fields=not-a-field`)
            .expect(200);
        expect(stale.text.split("\r\n")[0]).not.toContain("Release tier");
    });

    it("prunes values when a select loses an option, and drops them with the field", async () => {
        const fields = await owner.agent
            .get(`/api/organizations/${owner.orgId}/fields?projectId=${projectId}`)
            .expect(200);
        const tier = fields.body.items.find((item: { name: string }) => item.name === "Release tier");
        const task = await createTask(owner, projectId);
        await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { [tier.id]: "ga" } })
            .expect(200);

        const narrowed = await owner.agent
            .patch(`/api/organizations/${owner.orgId}/fields/${tier.id}`)
            .send({ options: ["alpha", "beta"] })
            .expect(200);
        expect(narrowed.body.options).toEqual(["alpha", "beta"]);
        expect(await prisma.taskFieldValue.count({ where: { taskId: task.id } })).toBe(0);

        const other = await createTask(owner, projectId);
        await owner.agent
            .patch(`/api/tasks/${other.id}/fields`)
            .send({ values: { [tier.id]: "beta" } })
            .expect(200);

        // How many rows the field still holds across the project: earlier cases wrote some of them.
        const expected = await prisma.taskFieldValue.count({ where: { fieldId: tier.id } });
        const removed = await owner.agent
            .delete(`/api/organizations/${owner.orgId}/fields/${tier.id}`)
            .expect(200);
        expect(removed.body.valuesRemoved).toBe(expected);
        expect(await prisma.taskFieldValue.count({ where: { taskId: other.id } })).toBe(0);
    });

    it("writes the definition and value changes into the audit trail", async () => {
        const task = await createTask(owner, projectId);
        const fields = await owner.agent.get(`/api/tasks/${task.id}/fields`).expect(200);
        const checkbox = fields.body.items.find((item: { name: string }) => item.name === "checkbox field");
        await owner.agent
            .patch(`/api/tasks/${task.id}/fields`)
            .send({ values: { [checkbox.id]: false } })
            .expect(200);

        const feed = await owner.agent
            .get(`/api/organizations/${owner.orgId}/activity?type=task.fields_updated`)
            .expect(200);
        expect(feed.body.items.some((row: { taskId: string }) => row.taskId === task.id)).toBe(true);

        const created = await owner.agent
            .get(`/api/organizations/${owner.orgId}/activity?type=field.created`)
            .expect(200);
        expect(created.body.items.length).toBeGreaterThan(0);
    });

    it("still serves the generated OpenAPI document with the new contracts", async () => {
        const res = await owner.agent.get("/api/docs/openapi.json").expect(200);
        expect(res.body.paths["/organizations/{orgId}/fields"]).toBeTruthy();
        expect(res.body.components.schemas.CreateCustomField).toBeTruthy();
    });
});

describe("coerceFieldValue", () => {
    it("normalizes each type and treats blanks as a clear", () => {
        expect(coerceFieldValue("text", [], "  hello  ")).toBe("hello");
        expect(coerceFieldValue("text", [], "")).toBeNull();
        expect(coerceFieldValue("number", [], "12")).toBe("12");
        expect(coerceFieldValue("date", [], "2026-03-04T22:00:00.000Z")).toBe("2026-03-04");
        expect(coerceFieldValue("select", ["alpha"], " alpha ")).toBe("alpha");
        expect(coerceFieldValue("checkbox", [], "TRUE")).toBe("true");
        expect(coerceFieldValue("checkbox", [], null)).toBeNull();
    });

    it("refuses anything the declared type cannot hold", () => {
        expect(() => coerceFieldValue("number", [], "twelve")).toThrow(/number/);
        expect(() => coerceFieldValue("date", [], "yesterday")).toThrow(/date/);
        expect(() => coerceFieldValue("select", ["alpha"], "beta")).toThrow(/option/);
        expect(() => coerceFieldValue("checkbox", [], "maybe")).toThrow(/true or false/);
        expect(() => coerceFieldValue("text", [], { nope: true })).toThrow(/text/);
    });
});
