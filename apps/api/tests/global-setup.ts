import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { TEST_DB_FILE, TEST_ENV, TEST_UPLOAD_DIR } from './env.js';

/**
 * Build a throwaway database once per run. Workers pick it up through `DATABASE_URL`
 * (see `tests/env.ts`). Prisma resolves SQLite paths relative to `prisma/schema.prisma`,
 * which is why the file lives in `prisma/`.
 */
const API_DIR = path.resolve(import.meta.dirname, '..');

export default async function globalSetup(): Promise<() => void> {
    rmSync(TEST_DB_FILE, { force: true });
    rmSync(`${TEST_DB_FILE}-journal`, { force: true });
    rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });

    execSync('npx prisma db push --skip-generate', {
        cwd: API_DIR,
        stdio: 'pipe',
        env: { ...process.env, ...TEST_ENV },
    });

    return () => {
        rmSync(TEST_DB_FILE, { force: true });
        rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
    };
}
