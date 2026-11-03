#!/usr/bin/env node
/**
 * Switch the Prisma datasource provider between `sqlite` (local dev/test) and
 * `postgresql` (staging/production) without maintaining two schema files.
 *
 * The schema is authored portably (see the header comment in schema.prisma), so the
 * only difference between the two variants is this single line.
 *
 *   node scripts/use-db.mjs sqlite
 *   node scripts/use-db.mjs postgres
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const target = (process.argv[2] ?? '').toLowerCase();
const PROVIDERS = { sqlite: 'sqlite', postgres: 'postgresql', postgresql: 'postgresql' };
const provider = PROVIDERS[target];
if (!provider) {
    console.error('usage: node scripts/use-db.mjs <sqlite|postgres>');
    process.exit(1);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(root, 'apps', 'api', 'prisma', 'schema.prisma');
if (!existsSync(schemaPath)) {
    console.error(`schema not found at ${schemaPath}`);
    process.exit(1);
}

const source = readFileSync(schemaPath, 'utf8');
const next = source.replace(/provider\s*=\s*"(sqlite|postgresql)"(\s*\n\s*url)/, `provider = "${provider}"$2`);
writeFileSync(schemaPath, next);
console.log(`prisma provider -> ${provider}`);
