/**
 * Task lifecycle: creation, editing, assignment, Kanban moves, completion, deletion.
 *
 * This module is the public surface only — the implementation is split by concern:
 *  - `task.query.ts`     reads (list, board, timeline, detail, my-tasks)
 *  - `task.mutation.ts`  writes (create/update/move/delete/complete/bulk)
 *  - `task.members.ts`   assignees and labels
 *  - `task.internal.ts`  shared helpers (a leaf module, so there are no import cycles)
 *
 * Routes keep importing `* as tasks` from here; tests and analytics reach
 * `visibleProjectIds` through the same door.
 */

export {
    getBoard,
    getTask,
    listTasks,
    myTasks,
    taskTimeline,
} from './task.query.js';
export {
    bulkUpdate,
    completeTask,
    createTask,
    deleteTask,
    moveTask,
    updateTask,
    type BulkInput,
    type BulkResult,
} from './task.mutation.js';
export { setAssignees, setLabels } from './task.members.js';
export { visibleProjectIds } from './task.internal.js';
