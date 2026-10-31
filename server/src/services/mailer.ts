import nodemailer, { type Transporter } from 'nodemailer';
import type { DB } from '../db/index.ts';
import { newId } from '../security.ts';

export interface MailerConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  fromName?: string;
  fromAddress?: string;
  appLoginUrl?: string;
}

export function getMailerConfig(): MailerConfig {
  try {
    (process as any).loadEnvFile?.('.env');
  } catch {
    // ignore
  }

  let host = process.env.MAIL_HOST?.trim();
  let port = process.env.MAIL_PORT ? parseInt(process.env.MAIL_PORT, 10) : 465;
  let user = process.env.MAIL_USER?.trim();
  let pass = process.env.MAIL_PASS?.trim();
  let fromName = process.env.MAIL_FROM_NAME?.trim() || 'SKS Super market';
  // Strip surrounding quotes
  fromName = fromName.replace(/^["']|["']$/g, '');

  // Handle cases where user set email address as MAIL_HOST (e.g. srishakram086@gmail.com)
  if (host && host.includes('@')) {
    if (!user) user = host;
    if (host.toLowerCase().includes('gmail.com')) {
      host = 'smtp.gmail.com';
    }
  }

  // Handle Gmail default host
  if (user && user.toLowerCase().endsWith('@gmail.com')) {
    if (!host || host.toLowerCase().includes('gmail')) {
      host = 'smtp.gmail.com';
    }
  }

  // Gmail SSL port 465 or STARTTLS port 587
  const secure = process.env.MAIL_SECURE === 'true' || port === 465 || host === 'smtp.gmail.com';
  if (host === 'smtp.gmail.com' && !process.env.MAIL_PORT) {
    port = 465;
  }

  let fromAddress = process.env.MAIL_FROM_ADDRESS?.trim() || user || 'srishakram086@gmail.com';
  fromAddress = fromAddress.replace(/^["']|["']$/g, '');
  const appLoginUrl = process.env.APP_LOGIN_URL?.trim() || 'http://localhost:3000';

  return { host, port, secure, user, pass, fromName, fromAddress, appLoginUrl };
}

let cachedKey = '';
let cachedTransporter: Transporter | null = null;

export function getTransporter(): Transporter | null {
  const config = getMailerConfig();
  if (!config.host || !config.user) {
    return null;
  }
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}:${config.pass || ''}`;
  if (!cachedTransporter || cachedKey !== key) {
    cachedKey = key;
    cachedTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.pass ? {
        user: config.user,
        pass: config.pass,
      } : undefined,
    });
  }
  return cachedTransporter;
}

/** Reset transporter cache if credentials change */
export function resetTransporterCache(): void {
  cachedTransporter = null;
  cachedKey = '';
}

function normalizeMailError(err: any): string {
  const msg = err?.message || String(err);
  if (msg.includes('535') || msg.includes('BadCredentials') || msg.includes('Username and Password not accepted')) {
    return 'Gmail authentication failed: A 16-character Google App Password is required in MAIL_PASS in .env (your regular Google password is not accepted by Gmail SMTP).';
  }
  return msg;
}

/** Verify SMTP configuration on server start or test */
export async function verifyMailer(): Promise<{ ok: boolean; message: string }> {
  const config = getMailerConfig();
  if (!config.host || !config.user) {
    const msg = '[Mailer] SMTP not configured. Set MAIL_HOST, MAIL_USER, MAIL_PASS in .env to enable email sending.';
    console.warn(msg);
    return { ok: false, message: msg };
  }
  if (!config.pass) {
    const msg = `[Mailer] SMTP user set (${config.user}), but MAIL_PASS is missing in .env. Generate a 16-character App Password at https://myaccount.google.com/apppasswords and add MAIL_PASS=<16-char-password> to .env.`;
    console.warn(msg);
    return { ok: false, message: msg };
  }
  try {
    const t = getTransporter();
    if (!t) throw new Error('Could not create transporter');
    await t.verify();
    const msg = `[Mailer] SMTP connection verified successfully (${config.host}:${config.port} as ${config.user})`;
    console.info(msg);
    return { ok: true, message: msg };
  } catch (err: any) {
    const errorDetails = normalizeMailError(err);
    const msg = `[Mailer] SMTP verification failed: ${errorDetails}`;
    console.error(msg);
    return { ok: false, message: msg };
  }
}

/** Send test email for Super Admin verification */
export async function sendTestEmail(toEmail: string): Promise<{ ok: boolean; message: string }> {
  const config = getMailerConfig();
  if (!config.host || !config.user) {
    throw new Error('SMTP is not configured on the server. Please set MAIL_HOST, MAIL_USER, and MAIL_PASS in .env.');
  }
  if (!config.pass) {
    throw new Error('Gmail App Password is required. Please generate a 16-character App Password in your Google Account and set MAIL_PASS in .env.');
  }

  const t = getTransporter();
  if (!t) throw new Error('Transporter unavailable');

  try {
    const info = await t.sendMail({
      from: `"${config.fromName}" <${config.fromAddress}>`,
      to: toEmail,
      subject: `Test Email from ${config.fromName} POS`,
      text: `Hello,\n\nThis is a test email confirming that the SMTP email service is configured correctly for ${config.fromName}.\n\nApp Login URL: ${config.appLoginUrl}\n\nTime: ${new Date().toISOString()}`,
      html: `
        <div style="font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #FFFFFF; border: 1px solid #E6E4F0; border-radius: 14px;">
          <div style="background: #5B3BE8; color: #FFFFFF; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 20px;">${escapeHtml(config.fromName)}</h2>
            <p style="margin: 4px 0 0; opacity: 0.85; font-size: 13px;">SMTP Test Message</p>
          </div>
          <p style="color: #1A1830; font-size: 15px; line-height: 1.5;">This is a test email confirming that your email configuration is working properly.</p>
          <p style="color: #5F5B76; font-size: 13px;">Login URL: <a href="${config.appLoginUrl}" style="color: #5B3BE8;">${config.appLoginUrl}</a></p>
          <hr style="border: none; border-top: 1px solid #ECEAF4; margin: 20px 0;" />
          <p style="color: #8C89A0; font-size: 12px; margin: 0;">Sent at ${new Date().toLocaleString('en-IN')}</p>
        </div>
      `,
    });

    return { ok: true, message: `Test email sent successfully to ${toEmail} (message ID: ${info.messageId})` };
  } catch (err: any) {
    throw new Error(normalizeMailError(err));
  }
}

// ----------------------------------------------------------------------------
// Templates
// ----------------------------------------------------------------------------

export interface EmailTemplateData {
  name: string;
  roleName: string; // e.g. "Store manager", "Cashier", "Counter account"
  branchName?: string;
  branchCode?: string;
  username?: string | null;
  email?: string | null;
  password: string; // strictly kept in-memory
  mustChangePassword?: boolean;
  storeName?: string;
}

function escapeHtml(str?: string | null): string {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}

export function buildUserEmail(
  type: 'WELCOME' | 'RESET_PASSWORD' | 'RESEND',
  data: EmailTemplateData,
  loginUrl: string,
): { subject: string; text: string; html: string } {
  const store = data.storeName || 'Shree Krishna Supermarket';
  const branchInfo = data.branchName ? `${data.branchName}${data.branchCode ? ` (${data.branchCode})` : ''}` : '';

  let subject = '';
  let intro = '';

  if (type === 'WELCOME') {
    subject = `Your sign-in details for ${store} POS`;
    intro = `You've been added as <strong>${escapeHtml(data.roleName)}</strong>${branchInfo ? ` for <strong>${escapeHtml(branchInfo)}</strong>` : ''}.`;
  } else if (type === 'RESET_PASSWORD') {
    subject = `Your password has been reset for ${store} POS`;
    intro = `The password for your <strong>${escapeHtml(data.roleName)}</strong> account${branchInfo ? ` at <strong>${escapeHtml(branchInfo)}</strong>` : ''} has been reset.`;
  } else {
    subject = `Your new sign-in details for ${store} POS`;
    intro = `Here are your updated sign-in details for your <strong>${escapeHtml(data.roleName)}</strong> account${branchInfo ? ` at <strong>${escapeHtml(branchInfo)}</strong>` : ''}.`;
  }

  const hasUsername = Boolean(data.username);
  const hasEmail = Boolean(data.email);

  // Plain-text version
  let text = `Hello ${data.name},\n\n`;
  text += intro.replace(/<\/?[^>]+(>|$)/g, '') + '\n\n';
  text += `Sign in at: ${loginUrl}\n`;
  if (hasUsername) text += `Username: @${data.username}\n`;
  if (hasEmail) text += `Email ID: ${data.email}\n`;
  if (hasUsername && hasEmail) text += `(You can sign in with either your username or email ID)\n`;
  text += `\nTemporary password: ${data.password}\n\n`;
  if (data.mustChangePassword) {
    text += `Note: You will be asked to change this password the first time you sign in.\n\n`;
  }
  text += `If you did not expect this email, please contact your store administrator.\n`;

  // HTML version
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 32px 16px; background-color: #F8F7FF; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1A1830;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; margin: 0 auto; background: #FFFFFF; border: 1px solid #E6E4F0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(26,24,48,0.05);">
    <!-- Header -->
    <tr>
      <td style="background-color: #5B3BE8; padding: 28px 32px; text-align: left;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td>
              <div style="color: #FFFFFF; font-size: 21px; font-weight: 700; letter-spacing: -0.3px; line-height: 1.2;">
                ${escapeHtml(store)}
              </div>
              <div style="color: rgba(255, 255, 255, 0.82); font-size: 13px; font-weight: 500; margin-top: 4px;">
                Retail POS & Branch Management
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.5; color: #1A1830;">
          Hello <strong>${escapeHtml(data.name)}</strong>,
        </p>

        <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #4A4760;">
          ${intro}
        </p>

        <!-- Credentials Box -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FCFBFF; border: 1px solid #ECEAF4; border-radius: 12px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 20px 24px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                ${hasUsername ? `
                <tr>
                  <td style="padding: 4px 0; font-size: 13px; font-weight: 600; color: #5F5B76; width: 140px;">Username</td>
                  <td style="padding: 4px 0; font-size: 14px; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #4A2FC4;">
                    @${escapeHtml(data.username)}
                  </td>
                </tr>
                ` : ''}

                ${hasEmail ? `
                <tr>
                  <td style="padding: 4px 0; font-size: 13px; font-weight: 600; color: #5F5B76; width: 140px;">Email ID</td>
                  <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #1A1830;">
                    ${escapeHtml(data.email)}
                  </td>
                </tr>
                ` : ''}

                ${(hasUsername && hasEmail) ? `
                <tr>
                  <td colspan="2" style="padding: 6px 0 12px; font-size: 12px; color: #7B7793;">
                    You can sign in with either your username or your email ID.
                  </td>
                </tr>
                ` : ''}

                <tr>
                  <td colspan="2" style="padding-top: 10px;">
                    <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #5F5B76; margin-bottom: 8px;">
                      Temporary password
                    </div>
                    <div style="background-color: #F4F1FF; border: 1px solid #DAD8E6; border-radius: 8px; padding: 12px 16px; font-family: 'JetBrains Mono', monospace; font-size: 17px; font-weight: 700; color: #4A2FC4; letter-spacing: 1.5px; word-break: break-all;">
                      ${escapeHtml(data.password)}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        ${data.mustChangePassword ? `
        <div style="background-color: #FFF9F2; border-left: 3px solid #F59E0B; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #8A5300; margin-bottom: 24px; line-height: 1.5;">
          <strong>Security notice:</strong> You'll be asked to set a new password the first time you sign in.
        </div>
        ` : ''}

        <!-- CTA Button -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
          <tr>
            <td align="center" style="border-radius: 10px; background-color: #5B3BE8;">
              <a href="${loginUrl}" target="_blank" style="display: inline-block; padding: 13px 28px; font-size: 14px; font-weight: 700; color: #FFFFFF; text-decoration: none; border-radius: 10px; letter-spacing: 0.2px;">
                Sign in to POS &rarr;
              </a>
            </td>
          </tr>
        </table>

        <p style="margin: 0; font-size: 12px; color: #7B7793; line-height: 1.5;">
          Direct login link: <a href="${loginUrl}" style="color: #5B3BE8; word-break: break-all;">${loginUrl}</a>
        </p>

        <!-- Divider -->
        <hr style="border: none; border-top: 1px solid #ECEAF4; margin: 28px 0 20px;" />

        <p style="margin: 0; font-size: 12px; color: #8C89A0; line-height: 1.5;">
          If you didn't expect this email, contact your store administrator. Do not share your temporary password with anyone.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  return { subject, text, html };
}

// ----------------------------------------------------------------------------
// Background Queue & Worker
// ----------------------------------------------------------------------------

export interface EnqueueEmailParams {
  tenantId: string;
  userId?: string | null;
  toEmail: string;
  type: 'WELCOME' | 'RESET_PASSWORD' | 'RESEND';
  createdBy?: string | null;
  templateData: EmailTemplateData;
}

/**
 * Enqueues an email into email_logs (status: 'QUEUED') and dispatches background delivery.
 * Retries up to 3 times with exponential backoff on failure.
 * Note: Plain-text password is NEVER saved to database.
 */
export async function enqueueUserEmail(
  db: DB,
  params: EnqueueEmailParams,
): Promise<{ logId: string; status: 'QUEUED' }> {
  const logId = newId('eml');
  const config = getMailerConfig();

  // 1. Persist QUEUED record in DB (NEVER with password)
  await db.exec(
    `INSERT INTO email_logs (id, tenant_id, user_id, to_email, type, status, attempts, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'QUEUED', 0, ?, now())`,
    [logId, params.tenantId, params.userId ?? null, params.toEmail, params.type, params.createdBy ?? null],
  );

  // 2. Build email content in-memory
  const { subject, text, html } = buildUserEmail(params.type, params.templateData, config.appLoginUrl!);

  // 3. Dispatch async background worker (does not block API response)
  setImmediate(() => {
    processEmailJob(db, logId, {
      fromName: config.fromName || 'Shree Krishna Supermarket',
      fromAddress: config.fromAddress || 'no-reply@billing.local',
      toEmail: params.toEmail,
      subject,
      text,
      html,
    }).catch((err) => {
      console.error(`[Mailer Worker] Uncaught error in email job ${logId}:`, err);
    });
  });

  return { logId, status: 'QUEUED' };
}

interface JobPayload {
  fromName: string;
  fromAddress: string;
  toEmail: string;
  subject: string;
  text: string;
  html: string;
}

async function processEmailJob(db: DB, logId: string, payload: JobPayload): Promise<void> {
  const config = getMailerConfig();
  const t = getTransporter();

  if (!t || !config.host || !config.user) {
    const errorMsg = 'SMTP not configured on server (missing MAIL_HOST or MAIL_USER)';
    console.warn(`[Mailer] Cannot send email ${logId}: ${errorMsg}`);
    await db.exec(
      `UPDATE email_logs SET status = 'FAILED', attempts = 1, error_message = ? WHERE id = ?`,
      [errorMsg, logId],
    );
    return;
  }

  if (!config.pass) {
    const errorMsg = 'Missing Gmail App Password in .env (add 16-character App Password to MAIL_PASS)';
    console.warn(`[Mailer] Cannot send email ${logId}: ${errorMsg}`);
    await db.exec(
      `UPDATE email_logs SET status = 'FAILED', attempts = 1, error_message = ? WHERE id = ?`,
      [errorMsg, logId],
    );
    return;
  }

  const maxAttempts = 3;
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      await t.sendMail({
        from: `"${payload.fromName}" <${payload.fromAddress}>`,
        to: payload.toEmail,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });

      // Succeeded!
      await db.exec(
        `UPDATE email_logs SET status = 'SENT', attempts = ?, sent_at = now(), error_message = NULL WHERE id = ?`,
        [attempt, logId],
      );
      console.info(`[Mailer] Email ${logId} sent successfully to ${payload.toEmail} on attempt ${attempt}`);
      return;
    } catch (err: any) {
      lastError = err;
      console.warn(`[Mailer] Attempt ${attempt}/${maxAttempts} failed for email ${logId}: ${err.message}`);

      if (attempt < maxAttempts) {
        // Backoff: 1s, 4s
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // All retries failed
  const finalError = normalizeMailError(lastError);
  await db.exec(
    `UPDATE email_logs SET status = 'FAILED', attempts = ?, error_message = ? WHERE id = ?`,
    [attempt, finalError, logId],
  );
  console.error(`[Mailer] Email ${logId} marked as FAILED: ${finalError}`);
}

// ----------------------------------------------------------------------------
// Deletion Alert Emails for Store Owner
// ----------------------------------------------------------------------------

export interface DeletionAlertParams {
  tenantId: string;
  toEmail: string;
  entityType: 'branch' | 'manager' | 'counter' | 'cashier';
  entityName: string;
  entityCode?: string | null;
  branchName?: string | null;
  deletedByUserId: string;
  deletedByUserName: string;
  deletedByUserRole: string;
  impactDetails?: {
    countersCount?: number;
    cashiersCount?: number;
    managerName?: string | null;
  };
}

export async function getOwnerEmailForTenant(db: DB, tenantId: string): Promise<string | null> {
  // 1. Check owner_email column on tenants table
  const t = await db.one<any>('SELECT owner_email FROM tenants WHERE id = ?', [tenantId]);
  if (t?.owner_email && typeof t.owner_email === 'string' && t.owner_email.trim()) {
    return t.owner_email.trim().toLowerCase();
  }
  if (t?.ownerEmail && typeof t.ownerEmail === 'string' && t.ownerEmail.trim()) {
    return t.ownerEmail.trim().toLowerCase();
  }

  // 2. Fallback to active owner user's email
  const u = await db.one<any>(
    "SELECT email FROM users WHERE tenant_id = ? AND role = 'owner' AND active = true AND email IS NOT NULL AND deleted_at IS NULL LIMIT 1",
    [tenantId],
  );
  if (u?.email && typeof u.email === 'string' && u.email.trim()) {
    return u.email.trim().toLowerCase();
  }

  return null;
}

export function buildDeletionAlertEmail(
  params: DeletionAlertParams,
  storeName: string,
  loginUrl: string,
): { subject: string; text: string; html: string } {
  const typeLabels: Record<string, string> = {
    branch: 'Branch',
    manager: 'Store Manager',
    counter: 'Counter',
    cashier: 'Cashier',
  };
  const typeLabel = typeLabels[params.entityType] || 'Record';
  const subject = `[Security Alert] ${typeLabel} "${params.entityName}" permanently deleted`;
  const timeStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'medium' });

  // Plain-text version
  let text = `SECURITY ALERT: PERMANENT RECORD DELETION\n\n`;
  text += `Hello Store Owner,\n\n`;
  text += `A ${typeLabel.toLowerCase()} has been permanently deleted from your POS system:\n\n`;
  text += `• Entity Type: ${typeLabel}\n`;
  text += `• Name: ${params.entityName}\n`;
  if (params.entityCode) text += `• Identifier / Code: ${params.entityCode}\n`;
  if (params.branchName) text += `• Branch: ${params.branchName}\n`;
  text += `• Deleted By: ${params.deletedByUserName} (${params.deletedByUserRole.toUpperCase()})\n`;
  text += `• Timestamp: ${timeStr}\n\n`;

  if (params.impactDetails) {
    text += `Impact Breakdown:\n`;
    if (params.impactDetails.countersCount != null) text += `• Counters deleted: ${params.impactDetails.countersCount}\n`;
    if (params.impactDetails.cashiersCount != null) text += `• Cashiers deleted: ${params.impactDetails.cashiersCount}\n`;
    if (params.impactDetails.managerName) text += `• Manager unassigned: ${params.impactDetails.managerName}\n`;
    text += `\n`;
  }

  text += `This entity has been removed from the database. Historical invoices, shift summaries, and financial reports retain immutable snapshots for statutory audits.\n\n`;
  text += `POS System URL: ${loginUrl}\n`;

  // HTML version
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 32px 16px; background-color: #F8F7FF; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1A1830;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; margin: 0 auto; background: #FFFFFF; border: 1px solid #E6E4F0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(26,24,48,0.06);">
    <!-- Header -->
    <tr>
      <td style="background-color: #5B3BE8; padding: 26px 32px; text-align: left;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td>
              <div style="color: #FFFFFF; font-size: 20px; font-weight: 700; letter-spacing: -0.3px;">
                ${escapeHtml(storeName)}
              </div>
              <div style="color: rgba(255, 255, 255, 0.85); font-size: 13px; font-weight: 500; margin-top: 4px;">
                Security &amp; Permanent Deletion Notification
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <!-- Alert Banner -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FEE4E2; border-left: 4px solid #D92D20; border-radius: 8px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 14px 18px;">
              <div style="color: #912018; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
                Permanent Deletion Recorded
              </div>
              <div style="color: #B42318; font-size: 14px; margin-top: 3px; font-weight: 600;">
                A ${escapeHtml(typeLabel.toLowerCase())} has been permanently removed from your database.
              </div>
            </td>
          </tr>
        </table>

        <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5; color: #1A1830;">
          Hello Store Owner,
        </p>
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #4A4760;">
          This is an automated security alert confirming that <strong>${escapeHtml(params.entityName)}</strong> was permanently deleted from your POS system by <strong>${escapeHtml(params.deletedByUserName)}</strong>.
        </p>

        <!-- Record Details Card -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FCFBFF; border: 1px solid #ECEAF4; border-radius: 12px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 20px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px;">
                <tr>
                  <td style="padding: 6px 0; color: #5F5B76; width: 140px; font-weight: 600;">Entity Type</td>
                  <td style="padding: 6px 0; color: #1A1830; font-weight: 700;">${escapeHtml(typeLabel)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #5F5B76; font-weight: 600;">Name</td>
                  <td style="padding: 6px 0; color: #1A1830; font-weight: 700;">${escapeHtml(params.entityName)}</td>
                </tr>
                ${params.entityCode ? `
                <tr>
                  <td style="padding: 6px 0; color: #5F5B76; font-weight: 600;">Code / Username</td>
                  <td style="padding: 6px 0; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #5B3BE8;">${escapeHtml(params.entityCode)}</td>
                </tr>
                ` : ''}
                ${params.branchName ? `
                <tr>
                  <td style="padding: 6px 0; color: #5F5B76; font-weight: 600;">Branch</td>
                  <td style="padding: 6px 0; color: #1A1830; font-weight: 600;">${escapeHtml(params.branchName)}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 6px 0; color: #5F5B76; font-weight: 600;">Deleted By</td>
                  <td style="padding: 6px 0; color: #1A1830; font-weight: 600;">${escapeHtml(params.deletedByUserName)} <span style="color: #7B7793; font-size: 12px;">(${escapeHtml(params.deletedByUserRole.toUpperCase())})</span></td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #5F5B76; font-weight: 600;">Timestamp</td>
                  <td style="padding: 6px 0; color: #5F5B76;">${escapeHtml(timeStr)}</td>
                </tr>
              </table>

              ${params.impactDetails ? `
              <div style="border-top: 1px dashed #DAD8E6; margin-top: 14px; padding-top: 14px;">
                <div style="font-size: 12px; font-weight: 700; color: #5F5B76; text-transform: uppercase; margin-bottom: 8px;">Cascading Impact Summary:</div>
                <div style="font-size: 13px; color: #4A4760; line-height: 1.5;">
                  ${params.impactDetails.countersCount != null ? `• ${params.impactDetails.countersCount} linked counter(s) removed<br/>` : ''}
                  ${params.impactDetails.cashiersCount != null ? `• ${params.impactDetails.cashiersCount} linked cashier account(s) deleted<br/>` : ''}
                  ${params.impactDetails.managerName ? `• Manager ${escapeHtml(params.impactDetails.managerName)} unassigned<br/>` : ''}
                </div>
              </div>
              ` : ''}
            </td>
          </tr>
        </table>

        <!-- Assurance Box -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F1F8F5; border: 1px solid #D1E9DE; border-radius: 10px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 14px 18px; font-size: 13px; color: #0F6B4F; line-height: 1.5;">
              <strong>Data Integrity Guarantee:</strong> All past invoices, tax collections, customer payment histories, and day-end shift reports remain fully preserved in your database with immutable audit snapshot names for GST compliance.
            </td>
          </tr>
        </table>

        <!-- CTA Button -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center" style="padding: 6px 0 16px;">
              <a href="${loginUrl}" target="_blank" style="display: inline-block; background-color: #5B3BE8; color: #FFFFFF; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 28px; border-radius: 8px; box-shadow: 0 2px 8px rgba(91,59,232,0.25);">
                Open Management Dashboard
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #FAF9FD; border-top: 1px solid #ECEAF4; padding: 20px 32px; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #8C89A0; line-height: 1.5;">
          This security alert was automatically dispatched by ${escapeHtml(storeName)} POS.<br/>
          If you did not authorize this deletion, please log in immediately and review user access.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  return { subject, text, html };
}

export async function enqueueDeletionAlertEmail(
  db: DB,
  params: DeletionAlertParams,
): Promise<{ logId: string; status: 'QUEUED' }> {
  const logId = newId('eml');
  const config = getMailerConfig();

  // 1. Persist QUEUED record in DB
  await db.exec(
    `INSERT INTO email_logs (id, tenant_id, user_id, to_email, type, status, attempts, created_by, created_at)
     VALUES (?, ?, NULL, ?, 'DELETION_ALERT', 'QUEUED', 0, ?, now())`,
    [logId, params.tenantId, params.toEmail, params.deletedByUserId],
  );

  // 2. Fetch tenant name if possible
  const tRow = await db.one<any>('SELECT name FROM tenants WHERE id = ?', [params.tenantId]);
  const storeName = tRow?.name || config.fromName || 'Shree Krishna Supermarket';

  // 3. Build email content in-memory
  const { subject, text, html } = buildDeletionAlertEmail(params, storeName, config.appLoginUrl!);

  // 4. Dispatch async background worker
  setImmediate(() => {
    processEmailJob(db, logId, {
      fromName: config.fromName || 'Shree Krishna Supermarket',
      fromAddress: config.fromAddress || 'no-reply@billing.local',
      toEmail: params.toEmail,
      subject,
      text,
      html,
    }).catch((err) => {
      console.error(`[Mailer Worker] Uncaught error in deletion alert email job ${logId}:`, err);
    });
  });

  return { logId, status: 'QUEUED' };
}
