import type { OrgRole } from '../domain/enums.js';

/** Shape attached to the request by the authentication middleware. */
export interface AuthUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
}

declare global {
    namespace Express {
        interface Request {
            /** Set by pino-http for log correlation. */
            id?: string;
            user?: AuthUser;
            /** Schema-coerced request data, filled in by the `validate()` middleware. */
            parsed?: Partial<Record<'body' | 'query' | 'params', unknown>>;
            /** Organization the route is scoped to (populated by `attachOrganization`). */
            org?: { id: string; role: OrgRole };
            /**
             * Present when the caller authenticated with a personal access token instead of a
             * browser session. Routes use it to keep cookie-only endpoints (password change,
             * token management) off the token surface.
             */
            apiToken?: { id: string; scopes: string[] };
        }
    }
}

export { };
