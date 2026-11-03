import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { Conflict, NotFound } from '../domain/errors.js';

/** Wrap async handlers so rejected promises reach the error middleware. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}

export interface Paginated<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    pages: number;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
    return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Translate the Prisma error codes clients need to know about into HTTP errors.
 * Anything else bubbles up as an unexpected 500.
 */
export function mapPrismaError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
            return new Conflict(`A record with this ${(error.meta?.target as string[])?.join(', ')} already exists`);
        }
        if (error.code === 'P2025') return new NotFound('Resource not found');
        if (error.code === 'P2003') return new Conflict('Related record is missing or still in use');
    }
    return error;
}

/** `undefined` / empty strings from query params become absent keys. */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
    return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Partial<T>;
}

export function fullName(user: { firstName: string; lastName: string } | null | undefined): string {
    if (!user) return 'Someone';
    return `${user.firstName} ${user.lastName}`.trim();
}
