import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * A single Prisma client for the whole process. Connection pooling is handled by the
 * driver, so one client per Node instance is the recommended shape.
 */
declare global {
    var __atlasPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
    global.__atlasPrisma ??
    new PrismaClient({
        log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

// `tsx watch` restarts modules without dropping the process in some setups; reusing the
// client avoids exhausting database connections during development.
if (!env.isProd) global.__atlasPrisma = prisma;

export async function disconnectPrisma() {
    await prisma.$disconnect();
}
