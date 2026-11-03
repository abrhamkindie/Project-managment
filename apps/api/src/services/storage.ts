import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { NotFound } from '../domain/errors.js';

/**
 * Attachment storage behind a tiny driver interface.
 *
 * The `local` driver writes to a mounted volume (UPLOAD_DIR) and is what ships in the
 * Docker image. Adding S3/GCS later means implementing the same three functions and
 * registering them in `drivers` — no route or model changes.
 */

export interface SavedFile {
    storageKey: string;
    size: number;
}

interface StorageDriver {
    save(buffer: Buffer, hint: { taskId: string; filename: string }): Promise<SavedFile>;
    open(storageKey: string): Promise<Readable>;
    remove(storageKey: string): Promise<void>;
}

const safeName = (filename: string) =>
    filename
        .replace(/[^\w.\-()+ ]+/g, '_')
        .replace(/\s+/g, '-')
        .slice(-140);

/** UPLOAD_DIR may be relative, so every driver path is resolved against it once. */
const root = path.resolve(env.UPLOAD_DIR);

/** Join a storage key onto the root, refusing anything that escapes it. */
function resolveKey(storageKey: string): string {
    const absolute = path.join(root, storageKey);
    if (storageKey.includes('..') || path.isAbsolute(storageKey) || !absolute.startsWith(root + path.sep)) {
        throw new NotFound('File not found');
    }
    return absolute;
}

const localDriver: StorageDriver = {
    async save(buffer, { taskId, filename }) {
        await mkdir(path.join(root, taskId), { recursive: true });
        const storageKey = path.posix.join(taskId, `${randomUUID()}-${safeName(filename)}`);
        const target = resolveKey(storageKey);
        await new Promise<void>((resolve, reject) => {
            const stream = createWriteStream(target);
            stream.on('error', reject);
            stream.on('finish', () => resolve());
            stream.end(buffer);
        });
        const info = await stat(target);
        return { storageKey, size: info.size };
    },

    async open(storageKey) {
        const absolute = resolveKey(storageKey);
        try {
            await stat(absolute);
        } catch {
            throw new NotFound('File not found');
        }
        return createReadStream(absolute);
    },

    async remove(storageKey) {
        await unlink(resolveKey(storageKey)).catch(() => undefined);
    },
};

const drivers: Record<string, StorageDriver> = { local: localDriver };

const driver = () => drivers[env.STORAGE_DRIVER] ?? localDriver;

export const storage: StorageDriver = {
    save: (buffer, hint) => driver().save(buffer, hint),
    open: (key) => driver().open(key),
    remove: (key) => driver().remove(key),
};
