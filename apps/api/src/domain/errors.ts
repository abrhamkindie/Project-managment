/** Typed application errors. Anything thrown that is not an AppError is a bug. */
export class AppError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;
    readonly expose: boolean;

    constructor(status: number, code: string, message: string, details?: unknown, expose = true) {
        super(message);
        this.name = new.target.name;
        this.status = status;
        this.code = code;
        this.details = details;
        this.expose = expose;
        Error.captureStackTrace?.(this, new.target);
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                ...(this.details !== undefined ? { details: this.details } : {}),
            },
        };
    }
}

export class BadRequest extends AppError {
    constructor(message = 'Invalid request', details?: unknown) {
        super(400, 'bad_request', message, details);
    }
}

export class Unauthorized extends AppError {
    constructor(message = 'Authentication required') {
        super(401, 'unauthorized', message);
    }
}

export class Forbidden extends AppError {
    constructor(message = 'You do not have access to this resource', details?: unknown) {
        super(403, 'forbidden', message, details);
    }
}

export class NotFound extends AppError {
    constructor(message = 'Resource not found') {
        super(404, 'not_found', message);
    }
}

export class Conflict extends AppError {
    constructor(message = 'Resource already exists', details?: unknown) {
        super(409, 'conflict', message, details);
    }
}

export class TooMany extends AppError {
    constructor(message = 'Too many requests') {
        super(429, 'too_many_requests', message);
    }
}

export class Internal extends AppError {
    constructor(message = 'Unexpected server error', cause?: unknown) {
        super(500, 'internal_error', message, undefined, false);
        if (cause) this.cause = cause;
    }
}
