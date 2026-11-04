'use client';

import { useState } from 'react';
import { Mail, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { formatDate, fullName, presenceLabel } from '~/lib/format';
import clsx from 'clsx';
import {
    useInvitations,
    useInviteMembers,
    useMembers,
    usePeople,
    usePresence,
    useTeams,
    useWorkspaceAdmin,
} from '~/lib/hooks';
import { canManageMembers, isManagerPlus } from '~/lib/roles';
import type { MemberDto, OrgRole } from '~/lib/types';
import { Avatar, Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PresenceDot, Select, Spinner } from './ui';
import { Page, PageHeader, Section } from './page-shell';
import { UserPicker } from './user-picker';

/**
 * Workspace directory: people, roles, invitations and teams.
 *
 * Which controls appear is decided by the viewer's role, mirroring the floors on the API routes
 * (`/members` is readable by everyone, roles and invitations are admin-only, teams need a
 * manager). A button that is certain to come back 403 is worse than no button.
 */
export function MembersView({ orgId, viewerId, role, ownerId }: { orgId: string; viewerId: string; role: OrgRole; ownerId: string }) {
    const members = useMembers(orgId);
    const presence = usePresence(orgId);
    const teams = useTeams(orgId);
    const admin = useWorkspaceAdmin(orgId);

    const canManage = canManageMembers(role);
    const canOrganize = isManagerPlus(role);

    const [inviteOpen, setInviteOpen] = useState(false);
    const [teamModal, setTeamModal] = useState<{ mode: 'create' } | { mode: 'edit'; teamId: string; name: string; memberIds: string[] } | null>(null);
    const [pendingRemove, setPendingRemove] = useState<MemberDto | null>(null);

    const rows = members.data ?? [];
    const locked = (member: MemberDto) => !canManage || member.user.id === viewerId || member.user.id === ownerId;

    return (
        <Page>
            <PageHeader
                title="Members"
                description={
                    <>
                        {rows.length} {rows.length === 1 ? 'person' : 'people'} in this workspace
                        {presence.data ? (
                            <span className="ml-2 inline-flex items-center gap-1.5">
                                <PresenceDot online={presence.activeCount > 0} />
                                {presence.activeCount} {presence.activeCount === 1 ? 'is' : 'are'} active now
                            </span>
                        ) : null}
                    </>
                }
                actions={
                    canManage ? (
                        <Button variant="primary" icon={<Mail className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
                            Invite people
                        </Button>
                    ) : null
                }
            />

            <ErrorNote error={members.error} />

            {members.isLoading ? <Spinner label="Loading people…" /> : null}

            <Section title="People">
                <ul className="card divide-y divide-line">
                    {rows.map((member) => {
                        const seen = presence.byUser.get(member.user.id);
                        return (
                            <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                <Avatar user={member.user} presence={seen ? seen.online : undefined} />
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                                        {fullName(member.user)}
                                        {!member.user.isActive ? <Badge tone="warning">Deactivated</Badge> : null}
                                        {member.user.id === ownerId ? <Badge tone="brand">Owner</Badge> : null}
                                    </span>
                                    <span className="block truncate text-xs text-ink-faint">
                                        {member.user.email} · joined {formatDate(member.joinedAt)}
                                    </span>
                                    {/* One line of availability per person: the green words carry the dot's meaning instead of a second dot. */}
                                    {seen ? (
                                        <span className={clsx('flex items-center gap-1.5 text-xs', seen.online ? 'text-state-done' : 'text-ink-faint')}>
                                            <PresenceDot online={seen.online} />
                                            {presenceLabel(seen.online, seen.lastSeenAt)}
                                        </span>
                                    ) : null}
                                </span>

                                {member.teams.length ? (
                                    <span className="hidden items-center gap-1 md:flex">
                                        {member.teams.map((team) => (
                                            <span key={team.id} className="chip bg-gray-50 text-ink-muted border-line">
                                                {team.name}
                                            </span>
                                        ))}
                                    </span>
                                ) : null}

                                {locked(member) ? (
                                    <span className="w-28 shrink-0 text-right text-xs capitalize text-ink-muted">{member.role}</span>
                                ) : (
                                    <Select
                                        value={member.role}
                                        aria-label={`Role for ${fullName(member.user)}`}
                                        className="w-28 shrink-0"
                                        onChange={(event) => admin.setRole.mutate({ userId: member.user.id, role: event.target.value as OrgRole })}
                                    >
                                        <option value="member">Member</option>
                                        <option value="manager">Manager</option>
                                        <option value="admin">Admin</option>
                                    </Select>
                                )}

                                {canManage && member.user.id !== viewerId && member.user.id !== ownerId ? (
                                    <Button variant="ghost" size="sm" aria-label={`Remove ${fullName(member.user)}`} onClick={() => setPendingRemove(member)}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            </Section>

            {canManage ? <InvitationsSection orgId={orgId} onInvite={() => setInviteOpen(true)} /> : null}

            {canOrganize ? (
                <Section
                    title="Teams"
                    action={
                        <Button size="sm" icon={<Users className="h-4 w-4" />} onClick={() => setTeamModal({ mode: 'create' })}>
                            New team
                        </Button>
                    }
                >
                    {teams.isLoading ? <Spinner label="Loading teams…" /> : null}
                    {teams.data && teams.data.length === 0 ? (
                        <EmptyState
                            icon={<Users className="h-8 w-8" />}
                            title="No teams yet"
                            description="Teams group people so projects and reports can be filtered by who owns the work."
                        />
                    ) : null}

                    <ul className="card divide-y divide-line">
                        {listOf(teams.data).map((team) => (
                            <li key={team.id} className="flex items-center gap-3 px-4 py-3">
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-ink">{team.name}</span>
                                    <span className="block truncate text-xs text-ink-faint">
                                        {team.members.length} {team.members.length === 1 ? 'member' : 'members'} · {team.projectCount}{' '}
                                        {team.projectCount === 1 ? 'project' : 'projects'}
                                    </span>
                                </span>
                                <span className="hidden -space-x-1.5 sm:flex">
                                    {team.members.slice(0, 4).map((person) => (
                                        <span key={person.id} className="rounded-full ring-2 ring-surface">
                                            <Avatar user={person} size="xs" />
                                        </span>
                                    ))}
                                </span>
                                <Button
                                    size="sm"
                                    onClick={() =>
                                        setTeamModal({ mode: 'edit', teamId: team.id, name: team.name, memberIds: team.members.map((person) => person.id) })
                                    }
                                >
                                    Edit members
                                </Button>
                            </li>
                        ))}
                    </ul>
                </Section>
            ) : null}

            {inviteOpen ? <InviteModal orgId={orgId} onClose={() => setInviteOpen(false)} /> : null}

            {teamModal ? (
                <TeamModal
                    orgId={orgId}
                    state={teamModal}
                    onClose={() => setTeamModal(null)}
                    onSubmit={(name, memberIds) => {
                        if (teamModal.mode === 'create') {
                            admin.createTeam.mutate({ name, memberIds });
                        } else {
                            admin.setTeamMembers.mutate({ teamId: teamModal.teamId, userIds: memberIds });
                        }
                        setTeamModal(null);
                    }}
                    saving={admin.createTeam.isPending || admin.setTeamMembers.isPending}
                />
            ) : null}

            {pendingRemove ? (
                <Modal
                    title="Remove from workspace"
                    description={`${fullName(pendingRemove.user)} loses access to the projects in this workspace. Their tasks and comments stay.`}
                    onClose={() => setPendingRemove(null)}
                    footer={
                        <>
                            <Button variant="ghost" onClick={() => setPendingRemove(null)}>
                                Keep member
                            </Button>
                            <Button
                                variant="danger"
                                loading={admin.removeMember.isPending}
                                onClick={() => {
                                    admin.removeMember.mutate(pendingRemove.user.id);
                                    setPendingRemove(null);
                                }}
                            >
                                Remove
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm text-ink-soft">
                        They will need a new invitation to come back. Work they created is never deleted.
                    </p>
                </Modal>
            ) : null}
        </Page>
    );
}

/** Queries that are disabled for this role resolve to `undefined`, not an empty list. */
const listOf = <T,>(value: T[] | undefined): T[] => value ?? [];

function InvitationsSection({ orgId, onInvite }: { orgId: string; onInvite: () => void }) {
    const invitations = useInvitations(orgId);
    const admin = useWorkspaceAdmin(orgId);

    if (invitations.isLoading) return null;
    const items = listOf(invitations.data);
    if (items.length === 0) return null;

    return (
        <Section
            title="Pending invitations"
            action={
                <Button size="sm" variant="ghost" icon={<Mail className="h-4 w-4" />} onClick={onInvite}>
                    Invite
                </Button>
            }
        >
            <ul className="card divide-y divide-line">
                {items.map((invitation) => (
                    <li key={invitation.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <ShieldCheck className="h-4 w-4 shrink-0 text-ink-faint" />
                        <span className="min-w-0 flex-1 truncate">
                            {invitation.email}
                            <span className="ml-2 text-xs capitalize text-ink-faint">{invitation.role}</span>
                        </span>
                        <span className="text-xs text-ink-faint">expires {formatDate(invitation.expiresAt)}</span>
                        <Button size="sm" variant="ghost" aria-label={`Revoke ${invitation.email}`} loading={admin.revokeInvitation.isPending} onClick={() => admin.revokeInvitation.mutate(invitation.id)}>
                            Revoke
                        </Button>
                    </li>
                ))}
            </ul>
        </Section>
    );
}

function InviteModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
    const invite = useInviteMembers(orgId);
    const [emails, setEmails] = useState('');
    const [role, setRole] = useState<OrgRole>('member');

    const list = emails
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);

    return (
        <Modal
            title="Invite people"
            description="They receive an email with a link. Nothing is joined until they accept it."
            onClose={onClose}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        icon={<UserPlus className="h-4 w-4" />}
                        loading={invite.isPending}
                        disabled={list.length === 0}
                        onClick={() => invite.mutate({ emails: list, role }, { onSuccess: onClose })}
                    >
                        Send {list.length > 0 ? list.length : ''}
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <ErrorNote error={invite.error} />
                <Field label="Email addresses" hint="Separate with commas, spaces or new lines.">
                    <textarea
                        className="field min-h-24 font-mono text-sm"
                        value={emails}
                        onChange={(event) => setEmails(event.target.value)}
                        placeholder="ada@example.com, linus@example.com"
                    />
                </Field>
                <Field label="Role">
                    <Select value={role} onChange={(event) => setRole(event.target.value as OrgRole)}>
                        <option value="member">Member — works in their projects</option>
                        <option value="manager">Manager — creates projects, sees every report</option>
                        <option value="admin">Admin — manages people and settings</option>
                    </Select>
                </Field>
                {list.length > 0 ? <p className="text-xs text-ink-faint">{list.length} address{list.length === 1 ? '' : 'es'} ready</p> : null}
            </div>
        </Modal>
    );
}

function TeamModal({
    orgId,
    state,
    onClose,
    onSubmit,
    saving,
}: {
    orgId: string;
    state: { mode: 'create' } | { mode: 'edit'; teamId: string; name: string; memberIds: string[] };
    onClose: () => void;
    onSubmit: (name: string, memberIds: string[]) => void;
    saving: boolean;
}) {
    const people = usePeople(orgId);
    const presence = usePresence(orgId);
    const [name, setName] = useState(state.mode === 'create' ? '' : state.name);
    const [memberIds, setMemberIds] = useState<string[]>(state.mode === 'create' ? [] : state.memberIds);

    return (
        <Modal
            title={state.mode === 'create' ? 'New team' : `Edit ${state.name}`}
            onClose={onClose}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button variant="primary" loading={saving} disabled={name.trim().length < 2} onClick={() => onSubmit(name.trim(), memberIds)}>
                        {state.mode === 'create' ? 'Create team' : 'Save members'}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <Field label="Team name">
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Platform" maxLength={60} />
                </Field>
                <UserPicker users={people.people} value={memberIds} onChange={setMemberIds} label="People in this team" presence={presence.byUser} />
            </div>
        </Modal>
    );
}
