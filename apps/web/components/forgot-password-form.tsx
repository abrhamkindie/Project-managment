"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { MailCheck, Mail } from "lucide-react";
import { z } from "zod";
import { messageOf, useForgotPassword } from "~/lib/hooks";
import { Button, ErrorNote, Field, Input } from "./ui";

/**
 * "Forgot password" step 1 (`/forgot-password`).
 *
 * The API gives the same answer for an unknown address, a deactivated one and a Google-only
 * one, so on success this screen shows a message and stops — it cannot know whether an email
 * is coming, and neither may the page.
 */

const EmailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address")
  .email("Enter a valid email address");

export function ForgotPasswordForm() {
  const forgot = useForgotPassword();
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState<string>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = EmailField.safeParse(email);
    if (!parsed.success) {
      setInvalid(
        parsed.error.issues[0]?.message ?? "Enter a valid email address",
      );
      return;
    }
    setInvalid(undefined);
    forgot.mutate(parsed.data);
  };

  if (forgot.isSuccess) {
    return (
      <div className="space-y-5">
        <header className="space-y-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <MailCheck className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-semibold text-ink">Check your inbox</h1>
          <p className="text-sm text-ink-muted">{forgot.data.message}.</p>
        </header>
        <p className="text-xs text-ink-faint">
          The link works once and expires after a while. If nothing arrives, the
          address has no Orbita password of its own — or the mail landed in
          spam.
        </p>
        <Link href="/login" className="link block text-sm">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-ink">Reset your password</h2>
        <p className="text-sm text-ink-muted">
          We will email you a link to set a new one.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" error={invalid}>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <ErrorNote error={forgot.error ? messageOf(forgot.error) : null} />

        <Button
          type="submit"
          variant="primary"
          loading={forgot.isPending}
          className="w-full"
          icon={<Mail className="h-4 w-4" />}
        >
          Send reset link
        </Button>
      </form>

      <p className="text-sm text-ink-muted">
        Remembered it?{" "}
        <Link href="/login" className="link">
          Sign in
        </Link>
      </p>
    </div>
  );
}
