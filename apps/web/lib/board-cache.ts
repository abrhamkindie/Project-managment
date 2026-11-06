import type { BoardDto, TaskCardDto, TaskFieldValueDto } from './types';

/**
 * Board cache surgery, shared by the realtime provider and by task mutations.
 *
 * Both paths receive an authoritative card and must decide which column it now belongs to.
 * Doing it in one place is what keeps a locally moved card and a remotely moved card
 * indistinguishable in the UI.
 */

/**
 * Merge a card into the board: updates in place, moves between columns, or inserts.
 *
 * Two fields survive the merge rather than the payload, because mutation and realtime
 * responses are a single card and cannot carry them: the ordinal (the server does not
 * renumber on every write, so a card that has one keeps it) and the column's `total`
 * (nudged by ±1 here, corrected on the next board fetch).
 */
export function mergeTaskIntoBoard(board: BoardDto, task: TaskCardDto): BoardDto {
    return {
        ...board,
        sections: board.sections.map((section) => {
            const belongs = task.sectionId === section.id;
            const present = section.tasks.some((candidate) => candidate.id === task.id);
            // A card lives in exactly one column, so a move removes it from the old one first.
            const tasks = belongs
                ? (present
                    ? section.tasks.map((candidate) => (candidate.id === task.id ? keep(candidate, task) : candidate))
                    : [...section.tasks, task].sort((a, b) => a.position - b.position))
                : section.tasks.filter((candidate) => candidate.id !== task.id);
            const delta = belongs && !present ? 1 : !belongs && present ? -1 : 0;
            return { ...section, tasks, total: Math.max(0, section.total + delta) };
        }),
        unassigned: task.sectionId
            ? board.unassigned.filter((candidate) => candidate.id !== task.id)
            : upsert(board.unassigned, task),
    };
}

export function removeTaskFromBoard(board: BoardDto, taskId: string): BoardDto {
    return {
        ...board,
        sections: board.sections.map((section) =>
            section.tasks.some((task) => task.id === taskId)
                ? { ...section, tasks: section.tasks.filter((task) => task.id !== taskId), total: Math.max(0, section.total - 1) }
                : section,
        ),
        unassigned: board.unassigned.filter((task) => task.id !== taskId),
    };
}

/**
 * Writes one card's custom-field values, leaving everything else exactly as it was.
 *
 * A field save answers with the task's value set rather than with a card, so the usual
 * merge-from-a-card path does not apply here — and a full card would be the wrong thing to send
 * back anyway: nothing about status, position or the ordinal changed.
 */
export function setTaskFieldsInBoard(board: BoardDto, taskId: string, fields: TaskFieldValueDto[]): BoardDto {
    const swap = (task: TaskCardDto): TaskCardDto => (task.id === taskId ? { ...task, fields } : task);
    return {
        ...board,
        sections: board.sections.map((section) => ({ ...section, tasks: section.tasks.map(swap) })),
        unassigned: board.unassigned.map(swap),
    };
}

/** A card payload without an ordinal must not erase the one already on screen. */
function keep(previous: TaskCardDto, next: TaskCardDto): TaskCardDto {
    return { ...previous, ...next, number: next.number ?? previous.number };
}

function upsert(list: TaskCardDto[], task: TaskCardDto): TaskCardDto[] {
    const present = list.some((candidate) => candidate.id === task.id);
    if (!present) return [...list, task].sort((a, b) => a.position - b.position);
    return list.map((candidate) => (candidate.id === task.id ? keep(candidate, task) : candidate));
}

/** Neighbours around a drop position, which is all the API needs to rank a card. */
export function neighbours(tasks: TaskCardDto[], beforeId: string | null): { afterTaskId?: string; beforeTaskId?: string } {
    const index = beforeId ? tasks.findIndex((task) => task.id === beforeId) : tasks.length;
    if (index < 0) return {};
    return {
        ...(index > 0 ? { afterTaskId: tasks[index - 1]?.id } : {}),
        ...(index < tasks.length ? { beforeTaskId: tasks[index]?.id } : {}),
    };
}

/**
 * Mirror a drag in the cache before the server answers, so the card stays where it was dropped
 * instead of snapping back for the round trip.
 *
 * Status is deliberately not guessed here: a done column may re-open or complete the card, and
 * only the API knows which. The authoritative merge fixes that a moment later.
 */
export function moveTaskLocally(board: BoardDto, taskId: string, sectionId: string, beforeId: string | null): BoardDto {
    const card = [...board.sections.flatMap((section) => section.tasks), ...board.unassigned].find((task) => task.id === taskId);
    if (!card) return board;
    const moved: TaskCardDto = { ...card, sectionId };

    return {
        ...board,
        sections: board.sections.map((section) => {
            const rest = section.tasks.filter((task) => task.id !== taskId);
            if (section.id !== sectionId) return { ...section, tasks: rest };
            const found = beforeId ? rest.findIndex((task) => task.id === beforeId) : rest.length;
            const at = found < 0 ? rest.length : found;
            return { ...section, tasks: [...rest.slice(0, at), moved, ...rest.slice(at)] };
        }),
        unassigned: board.unassigned.filter((task) => task.id !== taskId),
    };
}
