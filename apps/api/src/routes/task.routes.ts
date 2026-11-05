import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../lib/http.js";
import { input, validate } from "../middleware/validate.js";
import { authenticate, currentUser } from "../middleware/auth.js";
import * as tasks from "../services/task.service.js";
import * as comments from "../services/comment.service.js";
import { loadTaskAccess } from "../services/access.js";
import { recordActivity } from "../services/activity.js";
import { storage } from "../services/storage.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { safeFilename, sniffFile } from "../lib/magic.js";
import { BadRequest, NotFound } from "../domain/errors.js";
import {
  assignSchema,
  bulkTaskSchema,
  createCommentSchema,
  createTaskSchema,
  labelIdsSchema,
  moveTaskSchema,
  taskListQuerySchema,
  updateTaskSchema,
  type AssignInput,
  type BulkTaskInput,
  type CreateCommentInput,
  type CreateTaskInput,
  type LabelIdsInput,
  type MoveTaskInput,
  type TaskListQuery,
  type UpdateTaskInput,
} from "../domain/schemas.js";

/**
 * Tasks, subtasks, discussion and attachments.
 *
 * Listing is organization-scoped (`/organizations/:orgId/tasks`) which is what powers
 * "My tasks" (filter by `assigneeId=me`) and global search ( `search=` ).
 */
export const taskRouter = Router();

taskRouter.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

taskRouter.get(
  "/organizations/:orgId/tasks",
  validate(taskListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const query = { ...input<TaskListQuery>(req, "query") };
    // `assigneeId=me` is the only way the client can ask for "my work" without leaking ids.
    if (query.assigneeId === "me") query.assigneeId = currentUser(req).id;
    res.json(await tasks.listTasks(currentUser(req), req.params.orgId, query));
  }),
);

// -------------------------------------------------------------------- bulk actions

/**
 * Checkbox bulk bar. Lives under the organization scope because that is where the
 * permission check happens: every id still goes through the single-task service, so a
 * batch cannot touch a project the requester cannot edit.
 */
taskRouter.post(
  "/organizations/:orgId/tasks/bulk",
  validate(bulkTaskSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await tasks.bulkUpdate(
        currentUser(req),
        req.params.orgId,
        input<BulkTaskInput>(req),
      ),
    );
  }),
);

taskRouter.get(
  "/organizations/:orgId/my-tasks",
  asyncHandler(async (req, res) => {
    res.json({
      groups: await tasks.myTasks(currentUser(req), req.params.orgId),
    });
  }),
);

taskRouter.post(
  "/organizations/:orgId/tasks",
  validate(createTaskSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await tasks.createTask(
          currentUser(req),
          req.params.orgId,
          input<CreateTaskInput>(req),
        ),
      );
  }),
);

taskRouter.get(
  "/tasks/:id",
  asyncHandler(async (req, res) => {
    res.json(await tasks.getTask(currentUser(req), req.params.id));
  }),
);

taskRouter.patch(
  "/tasks/:id",
  validate(updateTaskSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await tasks.updateTask(
        currentUser(req),
        req.params.id,
        input<UpdateTaskInput>(req),
      ),
    );
  }),
);

taskRouter.delete(
  "/tasks/:id",
  asyncHandler(async (req, res) => {
    res.json(await tasks.deleteTask(currentUser(req), req.params.id));
  }),
);

taskRouter.post(
  "/tasks/:id/complete",
  asyncHandler(async (req, res) => {
    res.json(await tasks.completeTask(currentUser(req), req.params.id));
  }),
);

taskRouter.put(
  "/tasks/:id/assignees",
  validate(assignSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await tasks.setAssignees(
        currentUser(req),
        req.params.id,
        input<AssignInput>(req),
      ),
    );
  }),
);

taskRouter.post(
  "/tasks/:id/move",
  validate(moveTaskSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await tasks.moveTask(
        currentUser(req),
        req.params.id,
        input<MoveTaskInput>(req),
      ),
    );
  }),
);

taskRouter.put(
  "/tasks/:id/labels",
  validate(labelIdsSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await tasks.setLabels(
        currentUser(req),
        req.params.id,
        input<LabelIdsInput>(req).labelIds,
      ),
    );
  }),
);

// ----------------------------------------------------------------------- comments

taskRouter.get(
  "/tasks/:id/comments",
  asyncHandler(async (req, res) => {
    res.json({
      items: await comments.listComments(currentUser(req), req.params.id),
    });
  }),
);

taskRouter.post(
  "/tasks/:id/comments",
  validate(createCommentSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await comments.addComment(
          currentUser(req),
          req.params.id,
          input<CreateCommentInput>(req).body,
        ),
      );
  }),
);

taskRouter.patch(
  "/comments/:id",
  validate(createCommentSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await comments.editComment(
        currentUser(req),
        req.params.id,
        input<CreateCommentInput>(req).body,
      ),
    );
  }),
);

taskRouter.delete(
  "/comments/:id",
  asyncHandler(async (req, res) => {
    res.json(await comments.deleteComment(currentUser(req), req.params.id));
  }),
);

// -------------------------------------------------------------------- attachments

taskRouter.post(
  "/tasks/:id/attachments",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { task, project } = await loadTaskAccess(
      currentUser(req),
      req.params.id,
    );
    const file = req.file;
    if (!file) throw new BadRequest("Upload a file under the `file` field");
    // `file.mimetype` is a client-supplied label, not a fact. Trust the leading bytes so
    // what gets stored matches the `Content-Type` the download route later replies with.
    const sniffed = sniffFile(file.buffer, file.mimetype);
    if (!sniffed)
      throw new BadRequest(`Unsupported file type (${file.mimetype})`);

    const filename = safeFilename(file.originalname, sniffed.extension);
    const saved = await storage.save(file.buffer, {
      taskId: task.id,
      filename,
    });
    const attachment = await prisma.attachment.create({
      data: {
        taskId: task.id,
        uploaderId: currentUser(req).id,
        filename,
        mimeType: sniffed.mimeType,
        size: saved.size,
        storageKey: saved.storageKey,
      },
    });
    await recordActivity({
      orgId: project.orgId,
      actorId: currentUser(req).id,
      projectId: project.id,
      taskId: task.id,
      type: "attachment.added",
      meta: { filename: attachment.filename, size: attachment.size },
    });

    res.status(201).json({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt.toISOString(),
      url: `/api/tasks/${task.id}/attachments/${attachment.id}/download`,
    });
  }),
);

taskRouter.get(
  "/tasks/:id/attachments/:attachmentId/download",
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await loadTaskAccess(user, req.params.id);
    const attachment = await prisma.attachment.findFirst({
      where: { id: req.params.attachmentId, taskId: req.params.id },
    });
    if (!attachment) throw new NotFound("Attachment not found");

    const stream = await storage.open(attachment.storageKey);
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Length", String(attachment.size));
    // Served as an attachment so a browser never renders an uploaded HTML file inline.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${attachment.filename.replace(/"/g, "")}"`,
    );
    stream.pipe(res);
  }),
);

taskRouter.get(
  "/tasks/:id/attachments/:attachmentId/view",
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    await loadTaskAccess(user, req.params.id);
    const attachment = await prisma.attachment.findFirst({
      where: { id: req.params.attachmentId, taskId: req.params.id },
    });
    if (!attachment) throw new NotFound("Attachment not found");

    const stream = await storage.open(attachment.storageKey);
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Length", String(attachment.size));
    // Served inline for browser viewing (fullscreen preview)
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
    );
    stream.pipe(res);
  }),
);

taskRouter.delete(
  "/tasks/:id/attachments/:attachmentId",
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { access } = await loadTaskAccess(user, req.params.id);
    const attachment = await prisma.attachment.findFirst({
      where: { id: req.params.attachmentId, taskId: req.params.id },
    });
    if (!attachment) throw new NotFound("Attachment not found");
    if (
      attachment.uploaderId !== user.id &&
      access.orgRole === "member" &&
      access.projectRole !== "lead"
    ) {
      throw new NotFound("Attachment not found");
    }
    await prisma.attachment.delete({ where: { id: attachment.id } });
    await storage.remove(attachment.storageKey);
    res.json({ id: attachment.id });
  }),
);

/**
 * Chronological activity + comment feed, for clients that refresh the drawer alone.
 * Bounded: `hiddenOlder` tells the UI how many rows it still has to ask for.
 */
taskRouter.get(
  "/tasks/:id/activity",
  asyncHandler(async (req, res) => {
    const { task } = await loadTaskAccess(currentUser(req), req.params.id);
    const feed = await tasks.taskTimeline(task.id);
    res.json({
      items: feed.items,
      hiddenOlder: feed.hiddenOlder,
      limit: feed.limit,
    });
  }),
);
