import './env.js';
import { afterAll } from 'vitest';
import { disconnectPrisma } from '../src/lib/prisma.js';

/**
 * Runs in every test worker. `./env.js` is imported first so the process environment is
 * already correct when the application configuration is evaluated.
 */
afterAll(async () => {
    await disconnectPrisma();
});
