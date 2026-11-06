import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { initRealtime } from "./realtime/socket.js";
import { startJobs } from "./jobs/scheduler.js";
import { disconnectPrisma } from "./lib/prisma.js";

/**
 * Process entrypoint: HTTP server + Socket.IO + cron, with the graceful shutdown the
 * load balancer expects (stop accepting, drain, then close the database pool).
 */
async function main(): Promise<void> {
  await mkdir(env.UPLOAD_DIR, { recursive: true });

  const app = createApp();
  const server = createServer(app);
  const io = initRealtime(server);
  const jobs = startJobs();

  server.listen(env.PORT, env.HOST, () => {
    logger.info(
      {
        port: env.PORT,
        host: env.HOST,
        env: env.NODE_ENV,
        storage: env.STORAGE_DRIVER,
        mail: env.MAIL_DRIVER,
      },
      "ZORQEN API server started",
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");

    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out, exiting");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    jobs.stop();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectPrisma();
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) =>
    logger.error({ reason }, "Unhandled promise rejection"),
  );
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    void shutdown("uncaughtException");
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, "Failed to start ZORQEN API");
  process.exit(1);
});
