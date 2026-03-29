import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError, ConflictError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';
import { mailLimiter } from '../middleware/rateLimiter.js';
import { sendEmail, getMailConfig } from '../utils/mailer.js';

const router = Router();

// ===== BREVO INBOUND WEBHOOK (no auth — Brevo calls this) =====
router.post('/inbound', asyncHandler(async (req, res) => {
  const { Uuid, MessageId, InReplyTo, From, To, Cc, ReplyTo, SentAtDate, Subject, RawHtmlBody, RawTextBody, Attachments, Headers } = req.body;

  // Parse sender
  const fromEmail = From?.Address || From?.Email || (typeof From === 'string' ? From : '');
  const fromName = From?.Name || '';

  // Parse recipients
  const toList = Array.isArray(To) ? To.map(t => t.Address || t.Email || t).filter(Boolean) : [To?.Address || To?.Email || String(To || '')];

  const emailDoc = {
    messageId: MessageId || Uuid || '',
    inReplyTo: InReplyTo || '',
    from: fromEmail,
    fromName,
    to: toList,
    cc: Array.isArray(Cc) ? Cc.map(c => c.Address || c.Email || c).filter(Boolean) : [],
    replyTo: ReplyTo?.Address || ReplyTo?.Email || fromEmail,
    subject: Subject || '(No Subject)',
    html: RawHtmlBody || '',
    text: RawTextBody || '',
    attachments: (Attachments || []).map(a => ({
      name: a.Name || a.Filename || 'attachment',
      contentType: a.ContentType || '',
      size: a.ContentLength || 0,
    })),
    read: false,
    starred: false,
    folder: 'inbox',
    receivedAt: SentAtDate || new Date().toISOString(),
    storedAt: new Date().toISOString(),
  };

  await db.collection('received_emails').add(emailDoc);
  console.log(JSON.stringify({
    level: 'info',
    event: 'inbound_email_received',
    from: fromEmail,
    to: toList.join(', '),
    subject: Subject,
    timestamp: new Date().toISOString(),
  }));

  res.json({ status: 'ok' });
}));

router.use(verifyToken);

// ===== GET INBOX WITH PAGINATION =====
router.get('/inbox', asyncHandler(async (req, res) => {
  const { folder, to, page = '1', limit = '50', search, unreadOnly } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let query = db.collection('received_emails');

  // Filter by recipient alias
  if (to) {
    query = query.where('to', 'array-contains', to.toLowerCase());
  }

  try {
    const snapshot = await query.orderBy('receivedAt', 'desc').get();
    let emails = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Apply filters
    if (folder && folder !== 'all') {
      emails = emails.filter(e => e.folder === folder);
    }
    if (unreadOnly === 'true') {
      emails = emails.filter(e => !e.read);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      emails = emails.filter(e =>
        (e.subject || '').toLowerCase().includes(searchLower) ||
        (e.from || '').toLowerCase().includes(searchLower) ||
        (e.text || '').toLowerCase().includes(searchLower)
      );
    }

    const total = emails.length;
    const paginatedEmails = emails.slice(offset, offset + limitNum);

    console.log(JSON.stringify({
      level: 'info',
      event: 'inbox_fetched',
      userId: req.user.uid,
      page: pageNum,
      limit: limitNum,
      total,
      returned: paginatedEmails.length,
      timestamp: new Date().toISOString(),
    }));

    res.json({
      emails: paginatedEmails,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'inbox_fetch_fallback',
      error: error.message,
      timestamp: new Date().toISOString(),
    }));

    // Fallback without composite index
    const snapshot = await db.collection('received_emails').get();
    let emails = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    emails.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
    if (to) emails = emails.filter(e => (e.to || []).some(t => t.toLowerCase().includes(to.toLowerCase())));
    if (folder && folder !== 'all') emails = emails.filter(e => e.folder === folder);
    if (unreadOnly === 'true') emails = emails.filter(e => !e.read);

    const total = emails.length;
    const paginatedEmails = emails.slice(offset, offset + limitNum);

    res.json({
      emails: paginatedEmails,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  }
}));

// ===== MARK EMAIL READ/UNREAD =====
router.patch('/inbox/:id', asyncHandler(async (req, res) => {
  const { read, starred, folder } = req.body;
  const docRef = db.collection('received_emails').doc(req.params.id);

  // Verify email exists
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new NotFoundError('Email');
  }

  const updates = {};
  if (read !== undefined) updates.read = Boolean(read);
  if (starred !== undefined) updates.starred = Boolean(starred);
  if (folder) updates.folder = String(folder).toLowerCase();

  await docRef.update(updates);

  console.log(JSON.stringify({
    level: 'info',
    event: 'email_updated',
    emailId: req.params.id,
    userId: req.user.uid,
    updates: Object.keys(updates),
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true });
}));

// ===== DELETE RECEIVED EMAIL =====
router.delete('/inbox/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('received_emails').doc(req.params.id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new NotFoundError('Email');
  }

  await docRef.delete();

  console.log(JSON.stringify({
    level: 'info',
    event: 'email_deleted',
    emailId: req.params.id,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true });
}));

// ===== UNREAD COUNT =====
router.get('/inbox/unread-count', asyncHandler(async (req, res) => {
  try {
    const snapshot = await db.collection('received_emails').where('read', '==', false).get();
    res.json({ count: snapshot.size });
  } catch {
    res.json({ count: 0 });
  }
}));

// ===== PROFESSIONAL EMAIL WRAPPER =====
function wrapEmailHTML(bodyHtml, options = {}) {
  const cn = process.env.COMPANY_NAME || 'Akshay Kotish & Co.';
  const ln = process.env.COMPANY_LEGAL_NAME || 'Akshay Lakshay Kotish Private Limited';
  const email = options.fromAlias || process.env.COMPANY_EMAIL || 'connect@akshaykotish.com';
  const phone = process.env.COMPANY_PHONE || '+91 98967 70369';
  const website = process.env.COMPANY_WEBSITE || 'www.akshaykotish.com';
  const addr = process.env.COMPANY_ADDRESS || 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027';

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

// ===== SEND EMAIL =====
router.post('/send', mailLimiter, validate('sendMail'), asyncHandler(async (req, res) => {
  const { to, subject, html, attachments, fromAlias, fromName } = req.body;

  if (!to || !subject || !html) {
    throw new ValidationError('Email validation failed', ['to, subject, and html are required']);
  }

  // Wrap user HTML in professional branded template
  const wrappedHtml = wrapEmailHTML(html, { fromAlias });

  const info = await sendEmail({
    to,
    subject,
    html: wrappedHtml,
    from: fromAlias || undefined,
    fromName: fromName || undefined,
    attachments,
  });

  // Log sent email
  await db.collection('sent_emails').add({
    to,
    subject,
    fromAlias: fromAlias || getMailConfig()?.fromEmail || '',
    fromName: fromName || 'Akshay Kotish & Co.',
    type: 'manual',
    sentBy: req.user.uid,
    sentAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({
    level: 'info',
    event: 'email_sent',
    to,
    subject,
    userId: req.user.uid,
    messageId: info.messageId,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ success: true, messageId: info.messageId });
}));

// ===== GET MAIL CONFIG STATUS =====
router.get('/status', asyncHandler(async (req, res) => {
  const config = getMailConfig();
  if (!config) {
    return res.json({ configured: false, provider: null });
  }
  res.json({
    configured: true,
    provider: config.provider,
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    host: config.host,
    port: config.port,
  });
}));

// ===== GET SENT EMAILS WITH PAGINATION =====
router.get('/sent', asyncHandler(async (req, res) => {
  const { page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  try {
    const snapshot = await db.collection('sent_emails')
      .orderBy('sentAt', 'desc')
      .get();

    let emails = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const total = emails.length;
    const paginatedEmails = emails.slice(offset, offset + limitNum);

    res.json({
      emails: paginatedEmails,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'sent_emails_fetch_fallback',
      error: error.message,
      timestamp: new Date().toISOString(),
    }));

    // Fallback without index
    const snapshot = await db.collection('sent_emails').get();
    let emails = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));

    const total = emails.length;
    const paginatedEmails = emails.slice(offset, offset + limitNum);

    res.json({
      emails: paginatedEmails,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  }
}));

// ===== MANAGE EMAIL ALIASES =====
router.post('/aliases', validate({ alias: 'string', employeeId: 'optionalString', employeeName: 'optionalString', displayName: 'optionalString', forwardTo: 'optionalString' }), asyncHandler(async (req, res) => {
  const { alias, employeeId, employeeName, displayName, forwardTo } = req.body;

  if (!alias || alias.trim().length === 0) {
    throw new ValidationError('Alias validation failed', ['alias is required']);
  }

  // Check for duplicates
  const existing = await db.collection('email_aliases').where('alias', '==', alias.toLowerCase().trim()).get();
  if (!existing.empty) {
    throw new ConflictError(`Alias ${alias} already exists`);
  }

  await db.collection('email_aliases').add({
    alias: alias.toLowerCase().trim(),
    employeeId: employeeId || null,
    employeeName: employeeName || '',
    displayName: displayName || '',
    forwardTo: forwardTo || '',
    active: true,
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({
    level: 'info',
    event: 'alias_created',
    alias,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({
    success: true,
    message: `Alias ${alias} created. Send emails from this address via your configured SMTP. For receiving, add a Cloudflare Email Routing rule.`
  });
}));

router.get('/aliases', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('email_aliases').get();
  res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
}));

router.delete('/aliases/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_aliases').doc(req.params.id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new NotFoundError('Email alias');
  }

  await docRef.delete();

  console.log(JSON.stringify({
    level: 'info',
    event: 'alias_deleted',
    aliasId: req.params.id,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true });
}));

// ===== EMAIL TEMPLATES =====
router.get('/templates', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('email_templates').get();
  res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
}));

router.post('/templates', validate({ name: 'string', subject: 'string', body: 'string', type: 'optionalString' }), asyncHandler(async (req, res) => {
  const { name, subject, body, type } = req.body;

  if (!name || !subject || !body) {
    throw new ValidationError('Template validation failed', ['name, subject, and body are required']);
  }

  const docRef = await db.collection('email_templates').add({
    name: name.trim(),
    subject: subject.trim(),
    body: body.trim(),
    type: type || 'general',
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({
    level: 'info',
    event: 'template_created',
    templateId: docRef.id,
    userId: req.user.uid,
    templateName: name,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, success: true });
}));

router.delete('/templates/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_templates').doc(req.params.id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new NotFoundError('Email template');
  }

  await docRef.delete();

  console.log(JSON.stringify({
    level: 'info',
    event: 'template_deleted',
    templateId: req.params.id,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true });
}));

export default router;
