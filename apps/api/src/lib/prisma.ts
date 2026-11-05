import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

/**
 * Single PrismaClient instance for the entire application.
 *
 * In development with `tsx watch`, hot reload would otherwise create a new client on
 * every save, exhausting the connection pool. The global variable prevents this.
 */
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

// Configure logging based on environment
const logLevel =
  env.NODE_ENV === "development"
    ? ["query" as const, "error" as const, "warn" as const]
    : ["error" as const];

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevel,
  });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
