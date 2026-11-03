import { intoWorkspace } from '~/lib/server-session';

/** Notifications point here without a workspace slug; see `intoWorkspace`. */
export default async function MyTasksLink() {
    await intoWorkspace('my-tasks', '/my-tasks');
}
