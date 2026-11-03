import { intoWorkspace } from '~/lib/server-session';

/** Notifications point here without a workspace slug; see `intoWorkspace`. */
export default async function DashboardLink() {
    await intoWorkspace('dashboard', '/dashboard');
}
