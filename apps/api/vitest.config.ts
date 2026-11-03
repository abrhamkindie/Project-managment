import { defineConfig } from 'vitest/config';

/**
 * The suite runs against a real SQLite database (created by `tests/global-setup.ts`),
 * not mocks: the point of these tests is that Prisma queries, permission rules and
 * analytics arithmetic actually work together.
 *
 * One database file is shared, so test files run one at a time.
 */
export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globalSetup: ['./tests/global-setup.ts'],
        setupFiles: ['./tests/setup.ts'],
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});
