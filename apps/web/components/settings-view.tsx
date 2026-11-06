"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ChevronLeft,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Palette,
  Save,
} from "lucide-react";
import { LABEL_COLORS, formatDateTime } from "~/lib/format";
import {
  useLabels,
  useLogout,
  usePreferences,
  useProfile,
  useSessions,
  useUpdatePreferences,
  useWorkspaceAdmin,
} from "~/lib/hooks";
import { homeFor, workspacePath } from "~/lib/paths";
import { isManagerPlus, isWorkspaceAdmin } from "~/lib/roles";
import type { NotificationPrefs, OrgRole, Session } from "~/lib/types";
import { Avatar, Button, ErrorNote, Field, Input, Select, Spinner } from "./ui";
import { Page, PageHeader, Section } from "./page-shell";
import { ApiTokensPanel } from "./settings/tokens";
import { AuditPanel } from "./settings/audit";
import { CustomFieldsPanel } from "./settings/fields";
import { SharesPanel } from "./settings/shares";
import { TwoFactorPanel } from "./settings/two-factor";
import { WebhooksPanel } from "./settings/webhooks";

/**
 * Account and workspace settings.
 *
 * One screen because there is exactly one of each thing to change: the profile belongs to the
 * user, the notification policy belongs to the user, and a workspace's name, label library,
 * integrations and audit trail belong to the workspace they are an admin of. Everything is
 * rendered from the session envelope, so the page never has to guess which workspace is
 * "current" — and each panel re-checks the role it needs, because the API is the authority.
 */
export function SettingsView({ session }: { session: Session }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-surface px-4">
        <Link
          href={homeFor(session)}
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to workspace
        </Link>
        <span className="flex items-center gap-2 text-sm text-ink-muted">
          <Avatar user={session.user} size="sm" />
          {session.user.email}
        </span>
      </header>

      <Page>
        <PageHeader
          title="Settings"
          description="Your profile, how ZORQEN reaches you, and the workspaces you administer."
        />

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="space-y-8">
            <ProfileSection session={session} />
            <NotificationSection />
            <PasswordSection />
            <Section title="Credentials">
              <div className="space-y-4">
                <TwoFactorPanel />
                <ApiTokensPanel />
              </div>
            </Section>
            <WorkspaceSections session={session} />
          </div>

          <div className="space-y-8">
            <SessionsSection />
            <SignOutSection />
          </div>
        </div>
      </Page>
    </div>
  );
}

// -------------------------------------------------------------------------- profile

function ProfileSection({ session }: { session: Session }) {
  const profile = useProfile();
  const [firstName, setFirstName] = useState(session.user.firstName);
  const [lastName, setLastName] = useState(session.user.lastName);
  const [timezone, setTimezone] = useState(session.user.timezone ?? "");

  const dirty =
    firstName !== session.user.firstName ||
    lastName !== session.user.lastName ||
    timezone !== (session.user.timezone ?? "");

  return (
    <Section title="Profile">
      <form
        className="card space-y-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          profile.update.mutate({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            timezone: timezone.trim() || undefined,
          });
        }}
      >
        <ErrorNote error={profile.update.error} />
        <div className="flex items-center gap-3">
          <Avatar user={session.user} size="lg" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">
              {session.user.firstName} {session.user.lastName}
            </p>
            <p className="text-xs text-ink-muted">{session.user.email}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              maxLength={60}
            />
          </Field>
          <Field label="Last name">
            <Input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              maxLength={60}
            />
          </Field>
        </div>
        <Field
          label="Email"
          hint="Signing in uses this address. Changing it is not supported in the MVP."
        >
          <Input value={session.user.email} readOnly disabled />
        </Field>
        <Field
          label="Timezone"
          hint="IANA name, for example Africa/Addis_Ababa. Used for digest emails."
        >
          <Input
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="UTC"
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          icon={<Save className="h-4 w-4" />}
          loading={profile.update.isPending}
          disabled={!dirty}
        >
          Save profile
        </Button>
      </form>
    </Section>
  );
}

// --------------------------------------------------------------------- notifications

const PREF_COPY: {
  key: keyof NotificationPrefs;
  label: string;
  hint: string;
}[] = [
    {
      key: "emailOnAssign",
      label: "Email me when I am assigned work",
      hint: "An in-app notification always arrives; this adds an email on top.",
    },
    {
      key: "emailOnComment",
      label: "Email me about comments",
      hint: "On tasks you created, are assigned to, or have commented on.",
    },
    {
      key: "emailDigest",
      label: "Send me a daily due-date digest",
      hint: "One email a day with what is overdue and what is close.",
    },
  ];

function NotificationSection() {
  const preferences = usePreferences();
  const update = useUpdatePreferences();

  if (preferences.isLoading) {
    return (
      <Section title="Notifications">
        <Spinner label="Loading preferences…" />
      </Section>
    );
  }

  const prefs = preferences.data;

  return (
    <Section title="Notifications">
      <div className="card space-y-3 p-4">
        <ErrorNote error={update.error} />
        {PREF_COPY.map((entry) => (
          <label key={entry.key} className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="checkbox mt-0.5"
              checked={prefs?.[entry.key] ?? false}
              disabled={!prefs || update.isPending}
              onChange={(event) =>
                update.mutate({ ...prefs, [entry.key]: event.target.checked })
              }
            />
            <span>
              <span className="block text-sm text-ink">{entry.label}</span>
              <span className="block text-xs text-ink-faint">{entry.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------------- security

function PasswordSection() {
  const profile = useProfile();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 8 && next === confirm;

  return (
    <Section title="Password">
      <form
        className="card space-y-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          profile.changePassword.mutate({
            currentPassword: current,
            newPassword: next,
          });
        }}
      >
        <ErrorNote error={profile.changePassword.error} />
        <Field label="Current password">
          <Input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New password" hint="At least 8 characters.">
            <Input
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field
            label="Confirm"
            error={mismatch ? "The two passwords do not match" : undefined}
          >
            <Input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <p className="text-xs text-ink-faint">
          Changing the password signs every device out.
        </p>
        <Button
          type="submit"
          icon={<KeyRound className="h-4 w-4" />}
          variant="primary"
          loading={profile.changePassword.isPending}
          disabled={!ready}
        >
          Change password
        </Button>
      </form>
    </Section>
  );
}

function SessionsSection() {
  const sessions = useSessions();
  const profile = useProfile();

  return (
    <Section
      title="Signed-in devices"
      action={
        <Button
          size="sm"
          variant="danger"
          loading={profile.revokeAllSessions.isPending}
          onClick={() => profile.revokeAllSessions.mutate()}
        >
          Sign out everywhere
        </Button>
      }
    >
      <ErrorNote error={sessions.error} />
      {sessions.isLoading ? <Spinner label="Loading sessions…" /> : null}
      <ul className="card divide-y divide-line">
        {(sessions.data ?? []).map((entry) => (
          <li
            key={entry.id}
            className="flex items-start gap-2.5 px-4 py-3 text-sm"
          >
            <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
            <span className="min-w-0">
              <span className="block truncate text-ink-soft">
                {entry.userAgent ?? "Unknown device"}
              </span>
              <span className="block text-xs text-ink-faint">
                {entry.ip ?? "no address"} ·{" "}
                {formatDateTime(entry.lastUsedAt ?? entry.createdAt)}
              </span>
            </span>
          </li>
        ))}
        {sessions.data && sessions.data.length === 0 ? (
          <li className="px-4 py-3 text-sm text-ink-muted">
            No active sessions.
          </li>
        ) : null}
      </ul>
    </Section>
  );
}

function SignOutSection() {
  const logout = useLogout();
  return (
    <Section title="Session">
      <div className="card space-y-3 p-4">
        <p className="text-sm text-ink-muted">
          Access tokens last 15 minutes and refresh tokens rotate on use, so a
          stolen token is useless after one request.
        </p>
        <Button
          icon={<LogOut className="h-4 w-4" />}
          onClick={() => logout.mutate()}
        >
          Sign out of this device
        </Button>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------------ workspaces

/**
 * Per-workspace administration and integration panels.
 *
 * Every workspace the person belongs to is listed, not only the ones they can rename: share links
 * and the audit feed are member-readable, so hiding the card would hide a way to revoke a link
 * somebody created for them. Everything an admin owns is gated inside `WorkspaceSettings`, the
 * same way the API gates it.
 */
function WorkspaceSections({ session }: { session: Session }) {
  return (
    <>
      {session.organizations.map((org) => (
        <Section
          key={org.id}
          title={org.name}
          action={
            <Link href={workspacePath(org.slug)} className="link text-xs">
              {org.slug}
            </Link>
          }
        >
          <WorkspaceSettings orgId={org.id} name={org.name} role={org.role} />
        </Section>
      ))}
    </>
  );
}

function WorkspaceSettings({
  orgId,
  name,
  role,
}: {
  orgId: string;
  name: string;
  role: OrgRole;
}) {
  const admin = useWorkspaceAdmin(orgId);
  const labels = useLabels(orgId);
  const [draft, setDraft] = useState(name);
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[0]!);

  // Renaming is admin-only on the API; a manager sees the field but cannot submit it.
  const canRename = isWorkspaceAdmin(role);
  const canDeleteLabel = isManagerPlus(role);

  return (
    <div className="space-y-4">
      <form
        className="card flex flex-wrap items-end gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          admin.rename.mutate(draft.trim());
        }}
      >
        <ErrorNote error={admin.rename.error} />
        <Field label="Workspace name">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={60}
            className="w-64"
            disabled={!canRename}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          loading={admin.rename.isPending}
          disabled={
            !canRename || draft.trim().length < 2 || draft.trim() === name
          }
        >
          Rename
        </Button>
      </form>

      <div className="card space-y-3 p-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <Palette className="h-3.5 w-3.5" />
          Label library
        </h3>

        <div className="flex flex-wrap gap-1.5">
          {(labels.data ?? []).map((label) => (
            <span
              key={label.id}
              className="chip"
              style={{
                backgroundColor: `${label.color}1a`,
                color: label.color,
              }}
            >
              {label.name}
              {label.projectId ? (
                <span className="ml-1 opacity-70">· project</span>
              ) : null}
              {canDeleteLabel ? (
                <button
                  type="button"
                  className="ml-1 opacity-70 hover:opacity-100"
                  aria-label={`Delete ${label.name}`}
                  onClick={() => admin.deleteLabel.mutate(label.id)}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {labels.data && labels.data.length === 0 ? (
            <span className="text-sm text-ink-faint">No labels yet.</span>
          ) : null}
        </div>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            admin.createLabel.mutate(
              { name: labelName.trim(), color: labelColor },
              { onSuccess: () => setLabelName("") },
            );
          }}
        >
          <Field label="New label">
            <Input
              value={labelName}
              onChange={(event) => setLabelName(event.target.value)}
              placeholder="Design"
              maxLength={40}
              className="w-40"
            />
          </Field>
          <Field label="Colour">
            <Select
              value={labelColor}
              onChange={(event) => setLabelColor(event.target.value)}
              aria-label="Label colour"
              className="w-32"
            >
              {LABEL_COLORS.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            type="submit"
            loading={admin.createLabel.isPending}
            disabled={labelName.trim().length < 2}
          >
            Add label
          </Button>
        </form>
      </div>

      {/* Outbound automation is a server-side POST to a URL the workspace chooses, so it stays
          with the role that can also read the delivery log. */}
      {canRename ? <WebhooksPanel orgId={orgId} /> : null}

      <CustomFieldsPanel orgId={orgId} role={role} />

      <SharesPanel orgId={orgId} />

      <AuditPanel orgId={orgId} admin={canRename} />
    </div>
  );
}
