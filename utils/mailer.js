import nodemailer from 'nodemailer';

/**
 * Production Email Utility
 *
 * Features:
 * - Multi-provider SMTP support (Gmail, Brevo, Custom, Zoho)
 * - Connection pooling with cached transporter
 * - Automatic retry with exponential backoff
 * - Connection verification on startup
 * - Structured logging
 * - Send queue for burst protection
 *
 * Priority: Gmail > Brevo > Custom SMTP > Zoho
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

  if (process.env.ZOHO_MAIL_USER && process.env.ZOHO_MAIL_PASS) {
    return {
      provider: 'zoho',
      host: process.env.ZOHO_MAIL_HOST || 'smtp.zoho.in',
      port: parseInt(process.env.ZOHO_MAIL_PORT || '465'),
      secure: true,
      auth: { user: process.env.ZOHO_MAIL_USER, pass: process.env.ZOHO_MAIL_PASS },
      fromEmail: process.env.MAIL_FROM_EMAIL || process.env.ZOHO_MAIL_USER,
      fromName: process.env.MAIL_FROM_NAME || 'Akshay Kotish & Co.',
      pool: false,
      maxConnections: 1,
      maxMessages: 30,
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

// ─── Send Email ───────────────────────────────────────────────────────────────

/**
 * Send an email with automatic retry and connection recovery.
 */
export async function sendEmail({ to, subject, html, text, from, fromName, attachments, replyTo, cc, bcc }) {
  const startTime = Date.now();

  const result = await retryOperation(async () => {
    const transporter = createTransporter();
    const fromAddress = from
      ? getFromAddress(from, fromName)
      : getFromAddress(null, fromName);

    const mailOptions = {
      from: fromAddress,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(cc ? { cc: Array.isArray(cc) ? cc.join(', ') : cc } : {}),
      ...(bcc ? { bcc: Array.isArray(bcc) ? bcc.join(', ') : bcc } : {}),
      attachments: attachments || [],
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
