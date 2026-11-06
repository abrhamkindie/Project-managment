'use client';

/**
 * Data layer: one hook per screen concern, all cache identity from `lib/queries.keys`.
 *
 * The implementation lives in sibling modules by domain (`auth`, `session`, `projects`,
 * `tasks`, `analytics`, `org`, `notifications`, and the Phase 5 `integrations`, `automations`
 * and `security`, plus the Phase 6 `fields`), with the shared plumbing in `core`.
 * This barrel keeps every historic `~/lib/hooks` import working unchanged.
 */

export * from './core';
export * from './hotkeys';
export * from './session';
export * from './projects';
export * from './cycles';
export * from './dependencies';
export * from './filters';
export * from './fields';
export * from './tasks';
export * from './time';
export * from './analytics';
export * from './org';
export * from './notifications';
export * from './auth';
export * from './integrations';
export * from './automations';
export * from './security';
