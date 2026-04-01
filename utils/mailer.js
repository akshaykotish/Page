import nodemailer from 'nodemailer';

/**
 * Production Email Utility
 *
 * Features:
 * - Multi-provider SMTP support (Gmail, Brevo, Custom)
 * - Connection pooling with cached transporter
 * - Automatic retry with exponential backoff
 * - Connection verification on startup
 * - Structured logging
 * - Send queue for burst protection
 * - HTML email templates for different types
 * - Attachment handling (base64, MIME)
 * - Email queue with retry
 *
 * Priority: Gmail > Brevo > Custom SMTP
 */

let _cachedTransporter = null;
let _cachedProvider = null;
let _verified = false;

// ─── Mail Config ──────────────────────────────────────────────────────────────

export function getMailConfig() {
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return {
      provider: 'gmail',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      fromEmail: process.env.MAIL_FROM_EMAIL || process.env.GMAIL_USER,
      fromName: process.env.MAIL_FROM_NAME || 'Akshay Kotish & Co.',
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    };
  }

  if (process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_KEY) {
    return {
      provider: 'brevo',
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user: process.env.BREVO_SMTP_USER, pass: process.env.BREVO_SMTP_KEY },
      fromEmail: process.env.MAIL_FROM_EMAIL || process.env.BREVO_SMTP_USER,
      fromName: process.env.MAIL_FROM_NAME || 'Akshay Kotish & Co.',
      pool: true,
      maxConnections: 3,
      maxMessages: 50,
    };
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      provider: 'custom',
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      fromEmail: process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER,
      fromName: process.env.MAIL_FROM_NAME || 'Akshay Kotish & Co.',
      pool: true,
      maxConnections: 3,
      maxMessages: 50,
    };
  }

  return null;
}

// ─── Transporter ──────────────────────────────────────────────────────────────

export function createTransporter() {
  const config = getMailConfig();
  if (!config) {
    throw new Error('No email provider configured. Set GMAIL_USER+GMAIL_APP_PASSWORD, BREVO_SMTP_USER+BREVO_SMTP_KEY, SMTP_HOST+SMTP_USER+SMTP_PASS, or ZOHO_MAIL_USER+ZOHO_MAIL_PASS.');
  }

  if (_cachedTransporter && _cachedProvider === config.provider) {
    return _cachedTransporter;
  }

  _cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    pool: config.pool,
    maxConnections: config.maxConnections,
    maxMessages: config.maxMessages,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    logger: false,
    debug: false,
  });
  _cachedProvider = config.provider;

  console.log(JSON.stringify({
    level: 'info',
    type: 'MAIL_PROVIDER',
    message: `Using ${config.provider} SMTP (${config.host}:${config.port})`,
    pool: config.pool,
    timestamp: new Date().toISOString(),
  }));

  return _cachedTransporter;
}

// ─── Connection Verification ──────────────────────────────────────────────────

export async function verifyMailConnection() {
  if (_verified) return true;
  try {
    const transporter = createTransporter();
    await transporter.verify();
    _verified = true;
    console.log(JSON.stringify({
      level: 'info',
      type: 'MAIL_VERIFIED',
      message: `SMTP connection verified (${_cachedProvider})`,
      timestamp: new Date().toISOString(),
    }));
    return true;
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      type: 'MAIL_VERIFY_FAILED',
      message: err.message,
      provider: _cachedProvider,
      timestamp: new Date().toISOString(),
    }));
    return false;
  }
}

// ─── From Address Builder ─────────────────────────────────────────────────────

export function getFromAddress(aliasEmail, aliasName) {
  const config = getMailConfig();
  if (!config) throw new Error('No email provider configured.');
  const email = aliasEmail || config.fromEmail;
  const name = aliasName || config.fromName;
  return `"${name}" <${email}>`;
}

// ─── Retry Logic ──────────────────────────────────────────────────────────────

async function retryOperation(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNREFUSED' || err.code === 'ESOCKET' ||
        err.responseCode >= 500;

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
      console.warn(JSON.stringify({
        level: 'warn',
        type: 'MAIL_RETRY',
        attempt,
        maxRetries,
        error: err.message,
        delayMs: Math.round(delay),
        timestamp: new Date().toISOString(),
      }));
      await new Promise(resolve => setTimeout(resolve, delay));

      // Reset transporter on connection errors
      if (err.code === 'ECONNRESET' || err.code === 'ESOCKET') {
        _cachedTransporter = null;
        _verified = false;
      }
    }
  }
  throw lastError;
}

// ─── Attachment Processing ───────────────────────────────────────────────────

/**
 * Process attachments from various formats into nodemailer-compatible format.
 * Supports: base64 data URIs, raw base64, URL references, and pre-formatted objects.
 */
export function processAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];

  return attachments.map((att, idx) => {
    // Already a nodemailer-compatible object
    if (att.path || att.href) return att;

    const result = {
      filename: att.filename || att.name || `attachment-${idx + 1}`,
      contentType: att.contentType || att.type || 'application/octet-stream',
    };

    if (att.content) {
      // Base64 data URI: "data:image/png;base64,iVBOR..."
      if (typeof att.content === 'string' && att.content.startsWith('data:')) {
        const matches = att.content.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          result.contentType = matches[1];
          result.content = Buffer.from(matches[2], 'base64');
        } else {
          result.content = att.content;
        }
      } else if (typeof att.content === 'string') {
        // Assume raw base64
        result.content = Buffer.from(att.content, 'base64');
        result.encoding = 'base64';
      } else {
        result.content = att.content;
      }
    }

    if (att.cid) {
      result.cid = att.cid; // For inline/embedded images
    }

    return result;
  });
}

// ─── Email Queue ─────────────────────────────────────────────────────────────

const _emailQueue = [];
let _queueProcessing = false;
const MAX_QUEUE_SIZE = 100;
const QUEUE_PROCESS_INTERVAL = 1000; // 1 second between sends

export function queueEmail(emailOptions) {
  if (_emailQueue.length >= MAX_QUEUE_SIZE) {
    throw new Error('Email queue is full. Please try again later.');
  }

  const queueItem = {
    id: `eq_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    options: emailOptions,
    attempts: 0,
    maxAttempts: 3,
    status: 'queued',
    queuedAt: new Date().toISOString(),
    error: null,
  };

  _emailQueue.push(queueItem);
  processQueue();
  return queueItem.id;
}

async function processQueue() {
  if (_queueProcessing) return;
  _queueProcessing = true;

  while (_emailQueue.length > 0) {
    const item = _emailQueue.find(i => i.status === 'queued');
    if (!item) break;

    item.status = 'sending';
    item.attempts++;

    try {
      await sendEmail(item.options);
      item.status = 'sent';
      item.sentAt = new Date().toISOString();
      // Remove sent items
      const idx = _emailQueue.indexOf(item);
      if (idx > -1) _emailQueue.splice(idx, 1);
    } catch (err) {
      if (item.attempts >= item.maxAttempts) {
        item.status = 'failed';
        item.error = err.message;
        console.error(JSON.stringify({
          level: 'error',
          type: 'QUEUE_SEND_FAILED',
          queueId: item.id,
          error: err.message,
          attempts: item.attempts,
          timestamp: new Date().toISOString(),
        }));
        // Remove failed items
        const idx = _emailQueue.indexOf(item);
        if (idx > -1) _emailQueue.splice(idx, 1);
      } else {
        item.status = 'queued'; // Re-queue for retry
        console.warn(JSON.stringify({
          level: 'warn',
          type: 'QUEUE_RETRY',
          queueId: item.id,
          attempt: item.attempts,
          error: err.message,
          timestamp: new Date().toISOString(),
        }));
      }
    }

    // Throttle between sends
    await new Promise(resolve => setTimeout(resolve, QUEUE_PROCESS_INTERVAL));
  }

  _queueProcessing = false;
}

export function getQueueStatus() {
  return {
    total: _emailQueue.length,
    queued: _emailQueue.filter(i => i.status === 'queued').length,
    sending: _emailQueue.filter(i => i.status === 'sending').length,
    failed: _emailQueue.filter(i => i.status === 'failed').length,
  };
}

// ─── HTML Email Templates ────────────────────────────────────────────────────

export function wrapEmailHTML(bodyHtml, options = {}) {
  const cn = process.env.COMPANY_NAME || 'Akshay Kotish & Co.';
  const ln = process.env.COMPANY_LEGAL_NAME || 'Akshay Lakshay Kotish Private Limited';
  const email = options.fromAlias || process.env.COMPANY_EMAIL || 'connect@akshaykotish.com';
  const phone = process.env.COMPANY_PHONE || '+91 98967 70369';
  const website = process.env.COMPANY_WEBSITE || 'www.akshaykotish.com';
  const addr = process.env.COMPANY_ADDRESS || 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027';

  // Append user signature if provided
  const signatureBlock = options.signature
    ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#666;">${options.signature}</div>`
    : '';

  return `<div style="font-family:'Segoe UI','Inter',Arial,sans-serif;max-width:650px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#1e293b;padding:20px 28px;border-radius:8px 8px 0 0;">
    <table style="width:100%;border-collapse:collapse;"><tr>
      <td style="border:none;padding:0;vertical-align:middle;">
        <h1 style="margin:0;font-size:18px;font-weight:800;color:#fff;letter-spacing:0.3px;">${cn.toUpperCase()}</h1>
        <div style="font-size:10px;color:#94a3b8;margin-top:2px;font-style:italic;">${ln}</div>
      </td>
      <td style="border:none;padding:0;text-align:right;vertical-align:middle;">
        <div style="font-size:11px;color:#94a3b8;">${email}</div>
        <div style="font-size:11px;color:#c0e040;font-weight:600;margin-top:2px;">${website}</div>
      </td>
    </tr></table>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:28px 28px 24px;">
    <div style="font-size:14px;line-height:1.75;color:#333;">
      ${bodyHtml}
    </div>
    ${signatureBlock}
    <div style="margin-top:28px;padding-top:16px;border-top:2px solid #e2e8f0;">
      <table style="width:100%;border-collapse:collapse;font-size:11px;color:#94a3b8;"><tr>
        <td style="border:none;padding:0;vertical-align:top;">
          <strong style="color:#1e293b;">${cn}</strong><br/>
          ${addr}
        </td>
        <td style="border:none;padding:0;text-align:right;vertical-align:top;">
          ${phone}<br/>
          <span style="color:#2e7d32;font-weight:700;">${website}</span>
        </td>
      </tr></table>
    </div>
  </div>
  <div style="background:#f8fafc;padding:10px 28px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
    <p style="font-size:10px;color:#94a3b8;margin:0;">Sent from ${cn} &nbsp;&bull;&nbsp; ${email}</p>
  </div>
</div>`;
}

// ─── Send Email ───────────────────────────────────────────────────────────────

/**
 * Send an email with automatic retry and connection recovery.
 */
export async function sendEmail({ to, subject, html, text, from, fromName, attachments, replyTo, cc, bcc, inReplyTo, references, headers }) {
  const startTime = Date.now();

  const result = await retryOperation(async () => {
    const transporter = createTransporter();
    const fromAddress = from
      ? getFromAddress(from, fromName)
      : getFromAddress(null, fromName);

    const processedAttachments = processAttachments(attachments || []);

    const mailOptions = {
      from: fromAddress,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(cc ? { cc: Array.isArray(cc) ? cc.join(', ') : cc } : {}),
      ...(bcc ? { bcc: Array.isArray(bcc) ? bcc.join(', ') : bcc } : {}),
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(references ? { references: Array.isArray(references) ? references.join(' ') : references } : {}),
      ...(headers ? { headers } : {}),
      attachments: processedAttachments,
    };

    return await transporter.sendMail(mailOptions);
  });

  const duration = Date.now() - startTime;

  console.log(JSON.stringify({
    level: 'info',
    type: 'EMAIL_SENT',
    to: Array.isArray(to) ? to : [to],
    subject: subject?.substring(0, 100),
    messageId: result.messageId,
    provider: _cachedProvider,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
  }));

  return result;
}

/**
 * Check if email service is configured and available.
 */
export function isMailConfigured() {
  return getMailConfig() !== null;
}

/**
 * Get the current mail provider name.
 */
export function getMailProvider() {
  const config = getMailConfig();
  return config?.provider || null;
}
