import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Outbound email. `console` driver in development (no SMTP needed, nothing is silently
 * swallowed), SMTP in production. Swap by setting MAIL_DRIVER.
 *
 * Every request-handler send goes through `sendMail`, which never throws: a broken SMTP
 * box must not turn a task update into a 500.
 *
 * All templates render through `compose` so every notification shares one accessible,
 * mobile-first layout built to standard email-design thresholds: a 600px single column,
 * 16px body copy at 1.6 line-height, 24–32px section rhythm, one 44px primary button, and
 * dark-mode-safe mid-tone surfaces. Icons are emoji, not SVG/images, so they render in
 * every client (Outlook blocks inline SVG, many clients block remote images by default).
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
    if (env.MAIL_DRIVER !== 'smtp') return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT ?? 587,
            secure: (env.SMTP_PORT ?? 587) === 465,
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        });
    }
    return transporter;
}

export interface Mail {
    to: string;
    subject: string;
    html: string;
    text: string;
}

export async function sendMail(mail: Mail): Promise<void> {
    const smtp = getTransporter();
    if (!smtp) {
        logger.info({ to: mail.to, subject: mail.subject }, '[mail:console]');
        return;
    }
    try {
        await smtp.sendMail({ from: env.MAIL_FROM, ...mail });
    } catch (error) {
        logger.error({ err: error, to: mail.to, subject: mail.subject }, 'Failed to send email');
    }
}

// ---------------------------------------------------------------------- layout kit

/** Escape user-supplied text before it enters HTML. Nothing in the templates trusts input. */
const esc = (value: string): string =>
    String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const BRAND = '#4f46e5';
const DANGER = '#dc2626';
const INK = '#111827';
const MUTED = '#6b7280';
const SURFACE = '#f8fafc';
const HAIRLINE = '#eef2f7';

interface DetailRow {
    label: string;
    value: string;
}

interface Cta {
    label: string;
    url: string;
}

interface ComposeInput {
    to: string;
    subject: string;
    preheader: string;
    /** Small uppercase category label above the title (e.g. "NEW ASSIGNMENT"). */
    eyebrow: string;
    /** Emoji badge shown at the top of the card. */
    icon: string;
    /** Display heading inside the card (can differ from the inbox subject). */
    title: string;
    /** Optional "Hi {name}," line. */
    greeting?: string;
    /** Already-safe HTML: callers escape any interpolated user data with `esc`. */
    body: string;
    details?: DetailRow[];
    cta?: Cta;
    accent?: string;
    tint?: string;
}

const detailsCard = (rows: DetailRow[]): string => {
    if (!rows.length) return '';
    const body = rows
        .map(
            (r, i) => `<tr>
  <td style="padding:13px 0;${i === rows.length - 1 ? '' : `border-bottom:1px solid ${HAIRLINE};`}color:${MUTED};font-size:14px;white-space:nowrap;width:34%">${esc(r.label)}</td>
  <td style="padding:13px 0;${i === rows.length - 1 ? '' : `border-bottom:1px solid ${HAIRLINE};`}color:${INK};font-size:14px;font-weight:600;text-align:right">${r.value}</td>
</tr>`,
        )
        .join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0">
  <tr><td style="background:${SURFACE};border:1px solid ${HAIRLINE};border-radius:14px;padding:6px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>
  </td></tr>
</table>`;
};

const primaryButton = (cta: Cta, accent: string): string =>
    `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:8px auto 0">
  <tr><td style="border-radius:12px;background:${accent}">
    <a href="${esc(cta.url)}" style="display:inline-block;padding:15px 34px;font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:12px">${esc(cta.label)}</a>
  </td></tr>
</table>`;

function compose(input: ComposeInput): Mail {
    const accent = input.accent ?? BRAND;
    const tint = input.tint ?? '#eef2ff';

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${esc(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(input.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${HAIRLINE}">

        <tr><td style="height:5px;line-height:5px;font-size:5px;background:${accent}">&nbsp;</td></tr>

        <tr><td align="center" style="padding:38px 40px 0">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto">
            <tr><td align="center" valign="middle" style="width:72px;height:72px;border-radius:22px;background:${tint};font-size:34px;line-height:72px">${input.icon}</td></tr>
          </table>
          <p style="margin:20px 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${accent}">${esc(input.eyebrow)}</p>
          <h1 style="margin:0;font-size:26px;line-height:1.3;font-weight:700;color:${INK}">${esc(input.title)}</h1>
        </td></tr>

        <tr><td style="padding:26px 40px 0">
          ${input.greeting ? `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${INK}">${input.greeting}</p>` : ''}
          <div style="font-size:16px;line-height:1.6;color:#374151">${input.body}</div>
          ${input.details ? detailsCard(input.details) : ''}
        </td></tr>

        ${input.cta ? `<tr><td align="center" style="padding:6px 40px 0">${primaryButton(input.cta, accent)}
          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${MUTED}">Or copy and paste this link into your browser:<br><a href="${esc(input.cta.url)}" style="color:${MUTED};text-decoration:underline;word-break:break-all">${esc(input.cta.url)}</a></p>
        </td></tr>` : ''}

        <tr><td style="padding:34px 40px;border-top:1px solid ${HAIRLINE};margin-top:34px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="middle">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:22px;height:22px;border-radius:6px;background:${accent};text-align:center;vertical-align:middle"><span style="color:#fff;font-weight:800;font-size:13px;line-height:22px">A</span></td>
                    <td style="padding-left:8px;font-weight:700;font-size:14px;color:${accent}">Atlas</td>
                  </tr>
                </table>
              </td>
              <td align="right" valign="middle"><a href="${esc(env.WEB_URL)}" style="color:${MUTED};font-size:13px;text-decoration:none">Visit Atlas &rarr;</a></td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${MUTED}">You&rsquo;re receiving this because you have an Atlas account. Manage what lands in your inbox any time from <a href="${esc(env.WEB_URL)}/settings" style="color:${MUTED};text-decoration:underline">notification preferences</a>.</p>
        </td></tr>

      </table>
      <p style="max-width:600px;margin:20px auto 0;font-size:12px;line-height:1.5;color:#9ca3af;text-align:center">Atlas &middot; Project management for teams</p>
    </td></tr>
  </table>
</body>
</html>`;

    const textLines: string[] = [input.eyebrow.toUpperCase(), input.title];
    if (input.greeting) textLines.push(plain(input.greeting));
    textLines.push(plain(input.body));
    for (const row of input.details ?? []) textLines.push(`${row.label}: ${plain(row.value)}`);
    if (input.cta) textLines.push(`${input.cta.label}: ${input.cta.url}`);
    const text = `${input.subject}\n\n${textLines.filter(Boolean).join('\n')}\n`;

    return { to: input.to, subject: input.subject, html, text };
}

/** Turn an HTML fragment into readable plain text for the multipart alternative. */
function plain(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h1|h2)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '  \u2022 ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&rsquo;/g, "'")
        .replace(/ +([.,;:!?])/g, '$1')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

// ------------------------------------------------------------------------- templates

export const mails = {
    welcome(input: { to: string; firstName: string; orgName: string; link: string }): Mail {
        return compose({
            to: input.to,
            subject: `Welcome to Atlas, ${input.firstName}`,
            preheader: `Your workspace ${input.orgName} is ready to go.`,
            eyebrow: 'Welcome aboard',
            icon: '👋',
            title: `Welcome to Atlas, ${input.firstName}!`,
            greeting: `Hi ${esc(input.firstName)},`,
            body: `<p style="margin:0">Your workspace is set up and ready. Invite your teammates, create your first project, and start tracking work in one place.</p>`,
            details: [{ label: 'Your workspace', value: esc(input.orgName) }],
            cta: { label: 'Open your workspace', url: input.link },
        });
    },

    invitation(input: { to: string; orgName: string; inviterName: string; role: string; link: string }): Mail {
        return compose({
            to: input.to,
            subject: `You've been invited to join ${input.orgName}`,
            preheader: `${input.inviterName} invited you to ${input.orgName} on Atlas.`,
            eyebrow: 'Invitation',
            icon: '✉️',
            title: `Join ${input.orgName}`,
            greeting: 'Hi there,',
            body: `<p style="margin:0"><strong>${esc(input.inviterName)}</strong> invited you to collaborate in their Atlas workspace. Accept below to get started &mdash; this invitation expires in 7 days.</p>`,
            details: [
                { label: 'Workspace', value: esc(input.orgName) },
                { label: 'Your role', value: esc(input.role) },
                { label: 'Invited by', value: esc(input.inviterName) },
            ],
            cta: { label: 'Accept invitation', url: input.link },
        });
    },

    taskAssigned(input: { to: string; assigneeName: string; actorName: string; taskTitle: string; projectName: string; due?: string | null; link: string }): Mail {
        const details: DetailRow[] = [
            { label: 'Task', value: esc(input.taskTitle) },
            { label: 'Project', value: esc(input.projectName) },
        ];
        if (input.due) details.push({ label: 'Due date', value: esc(input.due) });
        return compose({
            to: input.to,
            subject: `New task assigned to you: ${input.taskTitle}`,
            preheader: `${input.actorName} assigned "${input.taskTitle}" to you.`,
            eyebrow: 'New assignment',
            icon: '📌',
            title: 'A task was assigned to you',
            greeting: `Hi ${esc(input.assigneeName)},`,
            body: `<p style="margin:0"><strong>${esc(input.actorName)}</strong> assigned you a new task${input.due ? ` due <strong>${esc(input.due)}</strong>` : ''}.</p>`,
            details,
            cta: { label: 'Open task', url: input.link },
        });
    },

    commentAdded(input: { to: string; actorName: string; taskTitle: string; preview: string; link: string }): Mail {
        return compose({
            to: input.to,
            subject: `New comment on ${input.taskTitle}`,
            preheader: `${input.actorName}: ${input.preview}`,
            eyebrow: 'Mention & comments',
            icon: '💬',
            title: 'New comment on a task',
            body: `<p style="margin:0 0 14px"><strong>${esc(input.actorName)}</strong> commented on <strong>${esc(input.taskTitle)}</strong>:</p>
<blockquote style="margin:0;padding:14px 18px;border-left:3px solid ${BRAND};background:${SURFACE};border-radius:0 12px 12px 0;color:#374151;font-size:15px;line-height:1.6">${esc(input.preview)}</blockquote>`,
            details: [{ label: 'Task', value: esc(input.taskTitle) }],
            cta: { label: 'View & reply', url: input.link },
        });
    },

    dueSoon(input: { to: string; firstName: string; tasks: { title: string; project: string; due: string; overdue: boolean }[]; link: string }): Mail {
        const count = input.tasks.length;
        const hasOverdue = input.tasks.some((t) => t.overdue);
        const listItems = input.tasks
            .map(
                (t) => `<div style="padding:14px 0;border-bottom:1px solid ${HAIRLINE}">
  ${t.overdue ? `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${DANGER};background:#fef2f2;border-radius:999px;padding:3px 10px;margin-bottom:6px">Overdue</span><br>` : ''}
  <span style="font-size:15px;font-weight:600;color:${INK}">${esc(t.title)}</span><br>
  <span style="font-size:13px;color:${MUTED}">${esc(t.project)} &middot; due ${esc(t.due)}</span>
</div>`,
            )
            .join('');
        return compose({
            to: input.to,
            subject: `${count} task${count === 1 ? '' : 's'} need your attention`,
            preheader: `You have ${count} task${count === 1 ? '' : 's'} due or overdue.`,
            eyebrow: hasOverdue ? 'Action needed' : 'Due soon',
            icon: '⏰',
            title: `${count} task${count === 1 ? '' : 's'} need attention`,
            greeting: `Hi ${esc(input.firstName)},`,
            body: `<p style="margin:0 0 6px">Here&rsquo;s what&rsquo;s on your plate${hasOverdue ? ', including overdue work' : ''}:</p>${listItems}`,
            cta: { label: 'Open my tasks', url: input.link },
            accent: hasOverdue ? DANGER : BRAND,
            tint: hasOverdue ? '#fef2f2' : '#eef2ff',
        });
    },

    statusChanged(input: { to: string; actorName: string; taskTitle: string; from: string; to2: string; link: string }): Mail {
        const humanize = (s: string) => esc(s.replace(/_/g, ' '));
        const toLabel = input.to2.replace(/_/g, ' ');
        return compose({
            to: input.to,
            subject: `${input.taskTitle} moved to ${toLabel}`,
            preheader: `${input.actorName} updated the status of "${input.taskTitle}".`,
            eyebrow: 'Status update',
            icon: '🔄',
            title: 'Task status changed',
            body: `<p style="margin:0"><strong>${esc(input.actorName)}</strong> changed the status of <strong>${esc(input.taskTitle)}</strong>.</p>`,
            details: [
                { label: 'Task', value: esc(input.taskTitle) },
                { label: 'Was', value: humanize(input.from) },
                { label: 'Now', value: `<strong style="color:${BRAND}">${humanize(input.to2)}</strong>` },
            ],
            cta: { label: 'View task', url: input.link },
        });
    },
};
