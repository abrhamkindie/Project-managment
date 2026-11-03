import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { organizationRouter } from './organization.routes.js';
import { projectRouter } from './project.routes.js';
import { taskRouter } from './task.routes.js';
import { analyticsRouter } from './analytics.routes.js';
import { notificationRouter } from './notification.routes.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

/** Single composition root for the HTTP surface. */
export const apiRouter = Router();

apiRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      version: env.APP_VERSION,
      env: env.NODE_ENV,
      database: 'up',
      time: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'down' });
  }
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/organizations', organizationRouter);
apiRouter.use('/', projectRouter);
apiRouter.use('/', taskRouter);
apiRouter.use('/', analyticsRouter);
apiRouter.use('/notifications', notificationRouter);
