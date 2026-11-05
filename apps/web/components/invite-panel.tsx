"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { messageOf, restoreSession, useAcceptInvitation } from "~/lib/hooks";
import { homeFor } from "~/lib/paths";
import type { Session } from "~/lib/types";
import { Button, ErrorNote, Spinner } from "./ui";

/**
 * Invitation landing (`/invite?token=…`).
 *
 * Accepting needs a signed-in account whose email matches the invitation, so this screen first
 * establishes who you are: restore the session, or send the visitor to sign up / sign in with
 * the token attached so they come back here.
 *
 * Joining is an explicit click. An invitation is a privilege escalation, and links are fetched
 * by crawlers, prefetchers and sometimes antivirus scanners — nothing should be accepted on a
 * page view.
 */
export function InvitePanel({
  token,
  email,
}: {
  token?: string;
  email?: string;
}) {
  // `undefined` means "still checking", which is a different screen from "not signed in".
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const accept = useAcceptInvitation();

  useEffect(() => {
    let active = true;
    restoreSession().then((value) => active && setSession(value));
    return () => {
      active = false;
    };
  }, []);

  if (!token) {
    return (
      <Panel
        title="This link is incomplete"
        body="Invitation links carry a token. Copy the full link from the email we sent, or ask a workspace admin to invite you again."
      />
    );
  }

  if (session === undefined) {
    return (
      <div className="card flex items-center gap-3 p-5">
        <Spinner label="Checking your session…" />
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="space-y-5">
        <Header />
        <p className="text-sm text-ink-soft">
          Accepting an invitation requires an account.
          {email ? (
            <>
              {" "}
              This invitation was sent to{" "}
              <strong className="font-medium text-ink">{email}</strong>, so
              create or use an account with that address.
            </>
          ) : null}
        </p>
        <div className="grid gap-2">
          <Link
            href={`/register?invite=${encodeURIComponent(token)}`}
            className="btn btn-primary w-full"
          >
            Create an account
          </Link>
          <Link
            href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}
            className="btn btn-secondary w-full"
          >
            I already have one
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Header />
      <p className="text-sm text-ink-soft">
        Signed in as{" "}
        <strong className="font-medium text-ink">{session.user.email}</strong>.
      </p>
      {email && email.toLowerCase() !== session.user.email.toLowerCase() ? (
        <ErrorNote
          error={`This invitation was sent to ${email}. Sign in with that address to accept it.`}
        />
      ) : null}
      <ErrorNote error={accept.error ? messageOf(accept.error) : null} />
      <Button
        variant="primary"
        className="w-full"
        loading={accept.isPending}
        onClick={() => accept.mutate(token)}
        icon={<ShieldCheck className="h-4 w-4" />}
      >
        Accept invitation
      </Button>
      <Link href={homeFor(session)} className="link block text-sm">
        Skip — go to my workspace
      </Link>
    </div>
  );
}

function Header() {
  return (
    <header className="space-y-2">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Mail className="h-5 w-5" />
      </span>
      <h1 className="text-2xl font-semibold text-ink">You have been invited</h1>
      <p className="text-sm text-ink-muted">
        A teammate wants you to join their workspace on Orbita.
      </p>
    </header>
  );
}

function Panel({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <p className="text-sm text-ink-muted">{body}</p>
      <Link href="/login" className="link text-sm">
        Back to sign in
      </Link>
    </div>
  );
}
