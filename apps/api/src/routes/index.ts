import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { organizationRouter } from "./organization.routes.js";
import { projectRouter } from "./project.routes.js";
import { taskRouter } from "./task.routes.js";
import { analyticsRouter } from "./analytics.routes.js";
import { notificationRouter } from "./notification.routes.js";
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

// Mount routes directly for backward compatibility
apiRouter.use("/auth", authRouter);
apiRouter.use("/organizations", organizationRouter);
apiRouter.use("/", projectRouter);
apiRouter.use("/", taskRouter);
apiRouter.use("/", analyticsRouter);
apiRouter.use("/notifications", notificationRouter);

// API v1 - versioned routes for backward compatibility
export const v1Router = Router();
v1Router.use("/auth", authRouter);
v1Router.use("/organizations", organizationRouter);
v1Router.use("/", projectRouter);
v1Router.use("/", taskRouter);
v1Router.use("/", analyticsRouter);
v1Router.use("/notifications", notificationRouter);

// Mount v1 router under /api/v1
apiRouter.use("/v1", v1Router);
