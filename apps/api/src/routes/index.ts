import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { organizationRouter } from "./organization.routes.js";
import { projectRouter } from "./project.routes.js";
import { taskRouter } from "./task.routes.js";
import { analyticsRouter } from "./analytics.routes.js";
import { notificationRouter } from "./notification.routes.js";
import { tokenRouter } from "./token.routes.js";
import { webhookRouter } from "./webhook.routes.js";
import { automationRouter } from "./automation.routes.js";
import { shareRouter, publicShareRouter } from "./share.routes.js";
import { fieldRouter } from "./field.routes.js";
import { docsRouter } from "../openapi.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";

/** Single composition root for the HTTP surface. */
export const apiRouter = Router();

apiRouter.get("/health", async (_req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({
            status: "ok",
            version: env.APP_VERSION,
            env: env.NODE_ENV,
            database: "up",
            time: new Date().toISOString(),
        });
    } catch {
        res.status(503).json({ status: "degraded", database: "down" });
    }
});

// OpenAPI docs: `/api/docs` (UI, non-prod) and `/api/docs/openapi.json`.
apiRouter.use(docsRouter());

// Canonical mounting table: one definition applied to both the versioned and the
// deprecated unversioned surface, so the two can never drift apart.
const mountRoutes = (router: Router) => {
    // Mounted first and deliberately: every router below authenticates on entry, so the anonymous
    // read of a share link has to answer before one of them can reject it.
    router.use("/public", publicShareRouter);
    // `/auth/tokens` before `/auth`: same prefix, and the token router owns the sub-path.
    router.use("/auth/tokens", tokenRouter);
    router.use("/auth", authRouter);
    router.use("/organizations", organizationRouter);
    // Integration surfaces are prefixes the core routers do not claim, so they mount beside them.
    router.use("/", webhookRouter);
    router.use("/", automationRouter);
    router.use("/", shareRouter);
    // `/organizations/:orgId/fields` falls through `organizationRouter` unmatched, exactly like the
    // integration surfaces above.
    router.use("/", fieldRouter);
    router.use("/", projectRouter);
    router.use("/", taskRouter);
    router.use("/", analyticsRouter);
    router.use("/notifications", notificationRouter);
};

// API v1 - the canonical surface; every new client (apps/web) uses `/api/v1/*`.
export const v1Router = Router();
mountRoutes(v1Router);
apiRouter.use("/v1", v1Router);

// Deprecated unversioned aliases (old mobile builds, smoke scripts). Same router
// objects, single mount list above; removal needs a deprecation window.
mountRoutes(apiRouter);
