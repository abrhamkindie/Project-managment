import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Outbound email. `console` driver in development (no SMTP needed, nothing is silently
 * swallowed), SMTP in production. Swap by setting MAIL_DRIVER.
 *
 * Everything awaited by request handlers goes through `sendMail`, which never throws:
 * a broken SMTP box must not turn a task update into a 500.
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

const layout = (title: string, bodyHtml: string, cta?: { label: string; url: string }) => `
<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;color:#4f46e5;font-weight:700;letter-spacing:.02em">ATLAS</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#111827">${title}</h1>
    <div style="font-size:15px;line-height:1.55;color:#374151">${bodyHtml}</div>
    ${cta ? `<p style="margin:24px 0 0"><a href="${cta.url}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${cta.label}</a></p>` : ''}
    <p style="margin:28px 0 0;font-size:12px;color:#9ca3af">You are receiving this because you have an Atlas account.</p>
  </div>
</div>`;

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export const mails = {
    welcome(input: { to: string; firstName: string; orgName: string; link: string }): Mail {
        const title = `Welcome to Atlas, ${input.firstName}!`;
        const body = `<p>Hi ${input.firstName},</p><p>Your workspace <strong>${input.orgName}</strong> is ready. Invite teammates, create your first project, and start tracking work.</p>`;
        return { to: input.to, subject: title, html: layout(title, body, { label: 'Open your workspace', url: input.link }), text: `${title} ${input.link}` };
    },

    invitation(input: { to: string; orgName: string; inviterName: string; role: string; link: string }): Mail {
        const title = `You have been invited to ${input.orgName}`;
        const body = `<p>${input.inviterName} invited you to join <strong>${input.orgName}</strong> on Atlas as <strong>${input.role}</strong>.</p><p>Accept the invitation within 7 days to get started.</p>`;
        return { to: input.to, subject: title, html: layout(title, body, { label: 'Accept invitation', url: input.link }), text: `${title} — ${strip(body)} ${input.link}` };
    },

    taskAssigned(input: { to: string; assigneeName: string; actorName: string; taskTitle: string; projectName: string; due?: string | null; link: string }): Mail {
        const title = `New task assigned to you: ${input.taskTitle}`;
        const body = `<p>Hi ${input.assigneeName},</p><p>${input.actorName} assigned <strong>${input.taskTitle}</strong> to you in the project <em>${input.projectName}</em>${input.due ? `, due ${input.due}` : ''}.</p>`;
        return { to: input.to, subject: title, html: layout(title, body, { label: 'Open task', url: input.link }), text: `${title} ${input.link}` };
    },

    commentAdded(input: { to: string; actorName: string; taskTitle: string; preview: string; link: string }): Mail {
        const title = `New comment on ${input.taskTitle}`;
        const body = `<p>${input.actorName} commented on <strong>${input.taskTitle}</strong>:</p><blockquote style="border-left:3px solid #e5e7eb;margin:0;padding:4px 12px;color:#4b5563">${input.preview}</blockquote>`;
        return { to: input.to, subject: title, html: layout(title, body, { label: 'Reply', url: input.link }), text: `${title}: ${input.preview} ${input.link}` };
    },

    dueSoon(input: { to: string; firstName: string; tasks: { title: string; project: string; due: string; overdue: boolean }[]; link: string }): Mail {
        const rows = input.tasks
            .map((t) => `<li style="margin:4px 0">${t.overdue ? '<strong style="color:#b91c1c">Overdue</strong> · ' : ''}${t.title} <span style="color:#6b7280">(${t.project}) — due ${t.due}</span></li>`)
            .join('');
        const body = `<p>Hi ${input.firstName}, you have ${input.tasks.length} task${input.tasks.length === 1 ? '' : 's'} due soon:</p><ul style="padding-left:18px">${rows}</ul>`;
        const title = `${input.tasks.length} task${input.tasks.length === 1 ? '' : 's'} need attention`;
        return { to: input.to, subject: title, html: layout(title, body, { label: 'Open my tasks', url: input.link }), text: `${title} ${input.link}` };
    },

    statusChanged(input: { to: string; actorName: string; taskTitle: string; from: string; to2: string; link: string }): Mail {
        const title = `${input.taskTitle} moved to ${input.to2.replace('_', ' ')}`;
        const body = `<p>${input.actorName} changed the status of <strong>${input.taskTitle}</strong> from ${input.from.replace('_', ' ')} to <strong>${input.to2.replace('_', ' ')}</strong>.</p>`;
        return { to: input.to, subject: title, html: layout(title, body, { label: 'View task', url: input.link }), text: `${title} ${input.link}` };
    },
};
