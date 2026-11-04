'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Crown, Mail, UserPlus, X } from 'lucide-react';
import { fullName } from '~/lib/format';
import { useInviteMembers, usePeople, useProjectMembers } from '~/lib/hooks';
import { keys } from '~/lib/queries';
import type { OrgRole, ProjectDetailDto, ProjectRole } from '~/lib/types';
import { Avatar, Button, Field, Modal, Select, Spinner } from '../ui';
import { UserPicker } from '../user-picker';

/**
 * Who works on this project.
 *
 * Two ways to add people: pick existing workspace members, or invite a brand-new email. The
 * email path reuses the workspace invitation endpoint but tags it with this project's id, so an
 * acceptee is dropped straight into the project (and the workspace) once they join.
 */
export function ProjectMembersModal({ project, orgId, onClose }: { project: ProjectDetailDto; orgId: string; onClose: () => void }) {
    const client = useQueryClient();
    const people = usePeople(orgId);
    const members = useProjectMembers(project.id);
    const invite = useInviteMembers(orgId);
    const [picked, setPicked] = useState<string[]>([]);
    const [role, setRole] = useState<ProjectRole>('member');
    const [emails, setEmails] = useState('');
    const [inviteRole, setInviteRole] = useState<OrgRole>('member');

    const inviteList = emails
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);

    const current = new Set(project.memberIds);
    const candidates = people.people.filter((person) => !current.has(person.id));

    const add = () => {
        if (picked.length === 0) return;
        members.add.mutate({ userIds: picked, role }, { onSuccess: () => setPicked([]) });
    };

    return (
        <Modal
            title="Project members"
            description={`${project.members.length} ${project.members.length === 1 ? 'person works on' : 'people work on'} “${project.name}”`}
            onClose={onClose}
            width="max-w-xl"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Close
                    </Button>
                    <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} loading={members.add.isPending} disabled={picked.length === 0} onClick={add}>
                        Add {picked.length > 0 ? picked.length : ''}
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <ul className="space-y-1">
                    {people.isPending ? <Spinner label="Loading people…" /> : null}
                    {project.members.map((member) => (
                        <li key={member.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
                            <Avatar user={member} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-sm text-ink">
                                {fullName(member)}
                                {member.role === 'lead' ? (
                                    <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-brand-600">
                                        <Crown className="h-3.5 w-3.5" />
                                        lead
                                    </span>
                                ) : null}
                            </span>
                            <button
                                type="button"
                                aria-label={`Remove ${fullName(member)}`}
                                className="rounded-md p-1 text-ink-faint transition hover:bg-red-50 hover:text-danger"
                                disabled={members.remove.isPending}
                                onClick={() => members.remove.mutate(member.id)}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                    {project.members.length === 0 ? <li className="px-1.5 py-2 text-sm text-ink-muted">Nobody has been added yet.</li> : null}
                </ul>

                <div className="space-y-2 border-t border-line pt-3">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase text-ink-faint">Add from workspace</h3>
                        <Select value={role} aria-label="Role for new members" className="w-36" onChange={(event) => setRole(event.target.value as ProjectRole)}>
                            <option value="member">Member</option>
                            <option value="lead">Lead</option>
                        </Select>
                    </div>

                    <UserPicker
                        users={candidates}
                        value={picked}
                        onChange={setPicked}
                        emptyHint="Everyone in the workspace already works on this project."
                    />
                </div>

                <div className="space-y-3 border-t border-line pt-3">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase text-ink-faint">Invite by email</h3>
                        <Select
                            value={inviteRole}
                            aria-label="Workspace role for invitees"
                            className="w-36"
                            onChange={(event) => setInviteRole(event.target.value as OrgRole)}
                        >
                            <option value="member">Member</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                        </Select>
                    </div>
                    <Field label="Email addresses" hint="They get an invitation email; on accepting they land straight in this project.">
                        <textarea
                            className="field min-h-20 font-mono text-sm"
                            value={emails}
                            onChange={(event) => setEmails(event.target.value)}
                            placeholder="ada@example.com, linus@example.com"
                        />
                    </Field>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink-faint">
                            {inviteList.length > 0 ? `${inviteList.length} address${inviteList.length === 1 ? '' : 'es'} ready` : ''}
                        </span>
                        <Button
                            variant="primary"
                            size="sm"
                            icon={<Mail className="h-4 w-4" />}
                            loading={invite.isPending}
                            disabled={inviteList.length === 0}
                            onClick={() =>
                                invite.mutate(
                                    { emails: inviteList, role: inviteRole, projectIds: [project.id] },
                                    {
                                        onSuccess: () => {
                                            setEmails('');
                                            // Existing workspace accounts join immediately; refresh so they appear.
                                            void client.invalidateQueries({ queryKey: keys.project(project.id) });
                                            void client.invalidateQueries({ queryKey: keys.invitations(orgId) });
                                        },
                                    },
                                )
                            }
                        >
                            Send {inviteList.length > 0 ? inviteList.length : ''}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
