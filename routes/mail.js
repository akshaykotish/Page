import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError, ConflictError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';
import { mailLimiter } from '../middleware/rateLimiter.js';
import { sendEmail, getMailConfig, wrapEmailHTML, processAttachments, queueEmail, getQueueStatus } from '../utils/mailer.js';

const router = Router();

// ===== HELPER: Generate thread ID from subject =====
function normalizeSubject(subject) {
  return (subject || '').replace(/^(Re|Fwd|Fw):\s*/gi, '').trim().toLowerCase();
}

function generateThreadId(subject, participants) {
  const norm = normalizeSubject(subject);
  const parts = (participants || []).map(p => p.toLowerCase()).sort().join(',');
  // Simple hash
  let hash = 0;
  const str = `${norm}::${parts}`;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `thread_${Math.abs(hash).toString(36)}`;
}

// ===== BREVO INBOUND WEBHOOK (no auth — Brevo calls this) =====
router.post('/inbound', asyncHandler(async (req, res) => {
  const { Uuid, MessageId, InReplyTo, From, To, Cc, ReplyTo, SentAtDate, Subject, RawHtmlBody, RawTextBody, Attachments, Headers } = req.body;

  // Parse sender
  const fromEmail = From?.Address || From?.Email || (typeof From === 'string' ? From : '');
  const fromName = From?.Name || '';

  // Parse recipients
  const toList = Array.isArray(To) ? To.map(t => t.Address || t.Email || t).filter(Boolean) : [To?.Address || To?.Email || String(To || '')];
  const ccList = Array.isArray(Cc) ? Cc.map(c => c.Address || c.Email || c).filter(Boolean) : [];

  // Build thread ID
  const allParticipants = [fromEmail, ...toList, ...ccList].filter(Boolean);
  const threadId = generateThreadId(Subject, allParticipants);

  const emailDoc = {
    messageId: MessageId || Uuid || '',
    inReplyTo: InReplyTo || '',
    from: fromEmail,
    fromName,
    to: toList,
    cc: ccList,
    replyTo: ReplyTo?.Address || ReplyTo?.Email || fromEmail,
    subject: Subject || '(No Subject)',
    html: RawHtmlBody || '',
    text: RawTextBody || '',
    attachments: (Attachments || []).map(a => ({
      name: a.Name || a.Filename || 'attachment',
      contentType: a.ContentType || '',
      size: a.ContentLength || 0,
      downloadUrl: a.DownloadToken || '',
    })),
    read: false,
    starred: false,
    folder: 'inbox',
    labels: [],
    threadId,
    receivedAt: SentAtDate || new Date().toISOString(),
    storedAt: new Date().toISOString(),
  };

  await db.collection('received_emails').add(emailDoc);

  // Update contact book with sender
  try {
    const contactSnap = await db.collection('email_contacts').where('email', '==', fromEmail.toLowerCase()).limit(1).get();
    if (contactSnap.empty) {
      await db.collection('email_contacts').add({
        email: fromEmail.toLowerCase(),
        name: fromName || '',
        lastContacted: new Date().toISOString(),
        source: 'inbound',
        frequency: 1,
      });
    } else {
      const contactDoc = contactSnap.docs[0];
      await contactDoc.ref.update({
        lastContacted: new Date().toISOString(),
        frequency: (contactDoc.data().frequency || 0) + 1,
        ...(fromName && !contactDoc.data().name ? { name: fromName } : {}),
      });
    }
  } catch (err) {
    console.warn(JSON.stringify({ level: 'warn', event: 'contact_update_failed', error: err.message }));
  }

  console.log(JSON.stringify({
    level: 'info',
    event: 'inbound_email_received',
    from: fromEmail,
    to: toList.join(', '),
    subject: Subject,
    threadId,
    timestamp: new Date().toISOString(),
  }));

  res.json({ status: 'ok' });
}));

router.use(verifyToken);

// ===== GET EMAILS (unified inbox with folder/search/thread support) =====
router.get('/inbox', asyncHandler(async (req, res) => {
  const { folder, to, page = '1', limit = '50', search, unreadOnly, starred, label, threadId } = req.query;
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
    if (starred === 'true') {
      emails = emails.filter(e => e.starred);
    }
    if (label) {
      emails = emails.filter(e => (e.labels || []).includes(label));
    }
    if (threadId) {
      emails = emails.filter(e => e.threadId === threadId);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      emails = emails.filter(e =>
        (e.subject || '').toLowerCase().includes(searchLower) ||
        (e.from || '').toLowerCase().includes(searchLower) ||
        (e.fromName || '').toLowerCase().includes(searchLower) ||
        (e.text || '').toLowerCase().includes(searchLower) ||
        (e.html || '').toLowerCase().includes(searchLower) ||
        (e.to || []).some(t => t.toLowerCase().includes(searchLower))
      );
    }

    const total = emails.length;
    const unread = emails.filter(e => !e.read).length;
    const paginatedEmails = emails.slice(offset, offset + limitNum);

    res.json({
      emails: paginatedEmails,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
      unread,
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
    if (starred === 'true') emails = emails.filter(e => e.starred);
    if (label) emails = emails.filter(e => (e.labels || []).includes(label));
    if (threadId) emails = emails.filter(e => e.threadId === threadId);

    const total = emails.length;
    const unread = emails.filter(e => !e.read).length;
    const paginatedEmails = emails.slice(offset, offset + limitNum);

    res.json({
      emails: paginatedEmails,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
      unread,
    });
  }
}));

// ===== GET THREADS (grouped conversations) =====
router.get('/threads', asyncHandler(async (req, res) => {
  const { folder, page = '1', limit = '30', search } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 30));
  const offset = (pageNum - 1) * limitNum;

  const snapshot = await db.collection('received_emails').get();
  let emails = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  emails.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));

  if (folder && folder !== 'all') {
    emails = emails.filter(e => e.folder === folder);
  }
  if (search) {
    const q = search.toLowerCase();
    emails = emails.filter(e =>
      (e.subject || '').toLowerCase().includes(q) ||
      (e.from || '').toLowerCase().includes(q) ||
      (e.text || '').toLowerCase().includes(q)
    );
  }

  // Group by threadId
  const threadMap = {};
  emails.forEach(e => {
    const tid = e.threadId || e.id;
    if (!threadMap[tid]) {
      threadMap[tid] = {
        threadId: tid,
        subject: normalizeSubject(e.subject) || e.subject,
        lastEmail: e,
        emails: [],
        unreadCount: 0,
        participants: new Set(),
        lastDate: e.receivedAt,
      };
    }
    threadMap[tid].emails.push(e);
    if (!e.read) threadMap[tid].unreadCount++;
    threadMap[tid].participants.add(e.from);
    (e.to || []).forEach(t => threadMap[tid].participants.add(t));
    if (e.receivedAt > threadMap[tid].lastDate) {
      threadMap[tid].lastDate = e.receivedAt;
      threadMap[tid].lastEmail = e;
    }
  });

  let threads = Object.values(threadMap).map(t => ({
    ...t,
    participants: Array.from(t.participants),
    count: t.emails.length,
    emails: undefined, // Don't send all emails in list view
  }));
  threads.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));

  const total = threads.length;
  const paginatedThreads = threads.slice(offset, offset + limitNum);

  res.json({
    threads: paginatedThreads,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
}));

// ===== GET SINGLE THREAD =====
router.get('/threads/:threadId', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('received_emails').get();
  const emails = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(e => e.threadId === req.params.threadId)
    .sort((a, b) => (a.receivedAt || '').localeCompare(b.receivedAt || ''));

  if (emails.length === 0) {
    throw new NotFoundError('Thread');
  }

  // Also get sent emails for this thread
  const sentSnap = await db.collection('sent_emails').get();
  const sentEmails = sentSnap.docs
    .map(d => ({ id: d.id, ...d.data(), _type: 'sent' }))
    .filter(e => e.threadId === req.params.threadId)
    .sort((a, b) => (a.sentAt || '').localeCompare(b.sentAt || ''));

  // Merge and sort
  const allEmails = [...emails.map(e => ({ ...e, _type: 'received' })), ...sentEmails];
  allEmails.sort((a, b) => {
    const dateA = a.receivedAt || a.sentAt || '';
    const dateB = b.receivedAt || b.sentAt || '';
    return dateA.localeCompare(dateB);
  });

  res.json({
    threadId: req.params.threadId,
    subject: emails[0]?.subject || '',
    emails: allEmails,
  });
}));

// ===== UPDATE EMAIL (read, starred, folder, labels) =====
router.patch('/inbox/:id', asyncHandler(async (req, res) => {
  const { read, starred, folder, labels, addLabel, removeLabel } = req.body;
  const docRef = db.collection('received_emails').doc(req.params.id);

  const doc = await docRef.get();
  if (!doc.exists) {
    throw new NotFoundError('Email');
  }

  const updates = {};
  if (read !== undefined) updates.read = Boolean(read);
  if (starred !== undefined) updates.starred = Boolean(starred);
  if (folder) updates.folder = String(folder).toLowerCase();
  if (labels) updates.labels = Array.isArray(labels) ? labels : [labels];

  // Add/remove individual labels
  if (addLabel) {
    const currentLabels = doc.data().labels || [];
    if (!currentLabels.includes(addLabel)) {
      updates.labels = [...currentLabels, addLabel];
    }
  }
  if (removeLabel) {
    const currentLabels = doc.data().labels || [];
    updates.labels = currentLabels.filter(l => l !== removeLabel);
  }

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

// ===== BULK OPERATIONS =====
router.post('/bulk', asyncHandler(async (req, res) => {
  const { ids, action, folder, label } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('Bulk operation failed', ['ids array is required']);
  }
  if (!action) {
    throw new ValidationError('Bulk operation failed', ['action is required']);
  }

  const batch = db.batch();
  let count = 0;

  for (const id of ids.slice(0, 50)) { // Max 50 at a time
    const docRef = db.collection('received_emails').doc(id);
    switch (action) {
      case 'markRead':
        batch.update(docRef, { read: true });
        break;
      case 'markUnread':
        batch.update(docRef, { read: false });
        break;
      case 'star':
        batch.update(docRef, { starred: true });
        break;
      case 'unstar':
        batch.update(docRef, { starred: false });
        break;
      case 'move':
        if (!folder) throw new ValidationError('Bulk move failed', ['folder is required']);
        batch.update(docRef, { folder });
        break;
      case 'addLabel':
        // We need to read each doc for label operations
        break;
      case 'delete':
        batch.update(docRef, { folder: 'trash' });
        break;
      case 'permanentDelete':
        batch.delete(docRef);
        break;
      default:
        throw new ValidationError('Bulk operation failed', [`Unknown action: ${action}`]);
    }
    count++;
  }

  // For label operations we need individual reads
  if (action === 'addLabel' && label) {
    for (const id of ids.slice(0, 50)) {
      const docRef = db.collection('received_emails').doc(id);
      const doc = await docRef.get();
      if (doc.exists) {
        const currentLabels = doc.data().labels || [];
        if (!currentLabels.includes(label)) {
          batch.update(docRef, { labels: [...currentLabels, label] });
        }
      }
    }
  }

  await batch.commit();

  console.log(JSON.stringify({
    level: 'info',
    event: 'bulk_operation',
    action,
    count,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, count });
}));

// ===== DELETE RECEIVED EMAIL =====
router.delete('/inbox/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('received_emails').doc(req.params.id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new NotFoundError('Email');
  }

  // Move to trash first, permanent delete only if already in trash
  if (doc.data().folder === 'trash') {
    await docRef.delete();
  } else {
    await docRef.update({ folder: 'trash' });
  }

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
    // Count by folder
    const counts = { total: 0, inbox: 0 };
    snapshot.docs.forEach(d => {
      const data = d.data();
      if (data.folder !== 'trash' && data.folder !== 'spam') {
        counts.total++;
        if (!data.folder || data.folder === 'inbox') counts.inbox++;
      }
    });
    res.json({ count: counts.total, inbox: counts.inbox });
  } catch {
    res.json({ count: 0, inbox: 0 });
  }
}));

// ===== FOLDER COUNTS =====
router.get('/folder-counts', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('received_emails').get();
  const counts = { inbox: 0, starred: 0, sent: 0, drafts: 0, trash: 0, spam: 0 };
  const unreadCounts = { inbox: 0, starred: 0, sent: 0, drafts: 0, trash: 0, spam: 0 };
  const labelCounts = {};

  snapshot.docs.forEach(d => {
    const data = d.data();
    const folder = data.folder || 'inbox';
    counts[folder] = (counts[folder] || 0) + 1;
    if (!data.read) {
      unreadCounts[folder] = (unreadCounts[folder] || 0) + 1;
    }
    if (data.starred) {
      counts.starred++;
      if (!data.read) unreadCounts.starred++;
    }
    (data.labels || []).forEach(l => {
      labelCounts[l] = (labelCounts[l] || 0) + 1;
    });
  });

  // Get sent count
  try {
    const sentSnap = await db.collection('sent_emails').get();
    counts.sent = sentSnap.size;
  } catch {}

  // Get drafts count
  try {
    const draftsSnap = await db.collection('email_drafts').get();
    counts.drafts = draftsSnap.size;
  } catch {}

  res.json({ counts, unreadCounts, labelCounts });
}));

// ===== SEND EMAIL (with CC, BCC, attachments, threading) =====
router.post('/send', mailLimiter, asyncHandler(async (req, res) => {
  const { to, cc, bcc, subject, html, text, attachments, fromAlias, fromName, replyTo, inReplyTo, threadId, signature } = req.body;

  if (!to || !subject || (!html && !text)) {
    throw new ValidationError('Email validation failed', ['to, subject, and html/text are required']);
  }

  // Wrap user HTML in professional branded template
  const wrappedHtml = wrapEmailHTML(html || text, { fromAlias, signature });

  const info = await sendEmail({
    to: Array.isArray(to) ? to : to.split(',').map(s => s.trim()),
    subject,
    html: wrappedHtml,
    text,
    from: fromAlias || undefined,
    fromName: fromName || undefined,
    cc: cc ? (Array.isArray(cc) ? cc : cc.split(',').map(s => s.trim())) : undefined,
    bcc: bcc ? (Array.isArray(bcc) ? bcc : bcc.split(',').map(s => s.trim())) : undefined,
    replyTo,
    inReplyTo,
    attachments,
  });

  // Compute thread ID
  const allRecipients = [
    ...(Array.isArray(to) ? to : [to]),
    ...(cc ? (Array.isArray(cc) ? cc : [cc]) : []),
  ];
  const computedThreadId = threadId || generateThreadId(subject, [fromAlias || getMailConfig()?.fromEmail || '', ...allRecipients]);

  // Log sent email
  await db.collection('sent_emails').add({
    to: Array.isArray(to) ? to : to.split(',').map(s => s.trim()),
    cc: cc ? (Array.isArray(cc) ? cc : cc.split(',').map(s => s.trim())) : [],
    bcc: bcc ? (Array.isArray(bcc) ? bcc : bcc.split(',').map(s => s.trim())) : [],
    subject,
    html: wrappedHtml,
    text: text || '',
    fromAlias: fromAlias || getMailConfig()?.fromEmail || '',
    fromName: fromName || 'Akshay Kotish & Co.',
    type: 'manual',
    messageId: info.messageId,
    inReplyTo: inReplyTo || '',
    threadId: computedThreadId,
    sentBy: req.user.uid,
    sentAt: new Date().toISOString(),
    attachments: (attachments || []).map(a => ({
      name: a.filename || a.name || 'attachment',
      contentType: a.contentType || a.type || '',
      size: a.size || 0,
    })),
  });

  // Update contacts
  const recipientEmails = [
    ...(Array.isArray(to) ? to : to.split(',').map(s => s.trim())),
    ...(cc ? (Array.isArray(cc) ? cc : cc.split(',').map(s => s.trim())) : []),
  ];
  for (const email of recipientEmails) {
    try {
      const contactSnap = await db.collection('email_contacts').where('email', '==', email.toLowerCase().trim()).limit(1).get();
      if (contactSnap.empty) {
        await db.collection('email_contacts').add({
          email: email.toLowerCase().trim(),
          name: '',
          lastContacted: new Date().toISOString(),
          source: 'outbound',
          frequency: 1,
        });
      } else {
        const doc = contactSnap.docs[0];
        await doc.ref.update({
          lastContacted: new Date().toISOString(),
          frequency: (doc.data().frequency || 0) + 1,
        });
      }
    } catch {}
  }

  console.log(JSON.stringify({
    level: 'info',
    event: 'email_sent',
    to,
    cc,
    subject,
    userId: req.user.uid,
    messageId: info.messageId,
    threadId: computedThreadId,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ success: true, messageId: info.messageId, threadId: computedThreadId });
}));

// ===== SCHEDULE EMAIL =====
router.post('/schedule', mailLimiter, asyncHandler(async (req, res) => {
  const { to, cc, bcc, subject, html, text, fromAlias, fromName, scheduledAt, attachments } = req.body;

  if (!to || !subject || (!html && !text)) {
    throw new ValidationError('Scheduled email validation failed', ['to, subject, and html/text are required']);
  }
  if (!scheduledAt) {
    throw new ValidationError('Scheduled email validation failed', ['scheduledAt is required']);
  }

  const schedDate = new Date(scheduledAt);
  if (isNaN(schedDate.getTime()) || schedDate <= new Date()) {
    throw new ValidationError('Scheduled email validation failed', ['scheduledAt must be a future date']);
  }

  const docRef = await db.collection('scheduled_emails').add({
    to,
    cc: cc || [],
    bcc: bcc || [],
    subject,
    html: html || '',
    text: text || '',
    fromAlias: fromAlias || '',
    fromName: fromName || '',
    attachments: attachments || [],
    scheduledAt: schedDate.toISOString(),
    status: 'pending',
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ success: true, id: docRef.id, scheduledAt: schedDate.toISOString() });
}));

// ===== GET SCHEDULED EMAILS =====
router.get('/scheduled', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('scheduled_emails').get();
  const emails = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(e => e.status === 'pending')
    .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
  res.json(emails);
}));

// ===== CANCEL SCHEDULED EMAIL =====
router.delete('/scheduled/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('scheduled_emails').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Scheduled email');
  await docRef.update({ status: 'cancelled' });
  res.json({ success: true });
}));

// ===== DRAFTS =====
router.get('/drafts', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('email_drafts').get();
  const drafts = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.createdBy === req.user.uid)
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  res.json(drafts);
}));

router.post('/drafts', asyncHandler(async (req, res) => {
  const { to, cc, bcc, subject, html, text, fromAlias, fromName, attachments, threadId } = req.body;

  const docRef = await db.collection('email_drafts').add({
    to: to || '',
    cc: cc || '',
    bcc: bcc || '',
    subject: subject || '',
    html: html || '',
    text: text || '',
    fromAlias: fromAlias || '',
    fromName: fromName || '',
    attachments: attachments || [],
    threadId: threadId || '',
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  res.status(201).json({ success: true, id: docRef.id });
}));

router.put('/drafts/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_drafts').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Draft');

  const { to, cc, bcc, subject, html, text, fromAlias, fromName, attachments } = req.body;
  await docRef.update({
    to: to ?? doc.data().to,
    cc: cc ?? doc.data().cc,
    bcc: bcc ?? doc.data().bcc,
    subject: subject ?? doc.data().subject,
    html: html ?? doc.data().html,
    text: text ?? doc.data().text,
    fromAlias: fromAlias ?? doc.data().fromAlias,
    fromName: fromName ?? doc.data().fromName,
    attachments: attachments ?? doc.data().attachments,
    updatedAt: new Date().toISOString(),
  });

  res.json({ success: true });
}));

router.delete('/drafts/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_drafts').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Draft');
  await docRef.delete();
  res.json({ success: true });
}));

// ===== SIGNATURES =====
router.get('/signatures', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('email_signatures').get();
  const signatures = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.userId === req.user.uid);
  res.json(signatures);
}));

router.post('/signatures', asyncHandler(async (req, res) => {
  const { name, html, isDefault } = req.body;
  if (!name || !html) {
    throw new ValidationError('Signature validation failed', ['name and html are required']);
  }

  // If setting as default, unset existing default
  if (isDefault) {
    const existing = await db.collection('email_signatures')
      .where('userId', '==', req.user.uid)
      .where('isDefault', '==', true)
      .get();
    const batch = db.batch();
    existing.docs.forEach(d => batch.update(d.ref, { isDefault: false }));
    await batch.commit();
  }

  const docRef = await db.collection('email_signatures').add({
    name,
    html,
    isDefault: Boolean(isDefault),
    userId: req.user.uid,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ success: true, id: docRef.id });
}));

router.put('/signatures/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_signatures').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Signature');

  const { name, html, isDefault } = req.body;

  if (isDefault) {
    const existing = await db.collection('email_signatures')
      .where('userId', '==', req.user.uid)
      .where('isDefault', '==', true)
      .get();
    const batch = db.batch();
    existing.docs.forEach(d => {
      if (d.id !== req.params.id) batch.update(d.ref, { isDefault: false });
    });
    await batch.commit();
  }

  await docRef.update({
    ...(name !== undefined ? { name } : {}),
    ...(html !== undefined ? { html } : {}),
    ...(isDefault !== undefined ? { isDefault: Boolean(isDefault) } : {}),
    updatedAt: new Date().toISOString(),
  });

  res.json({ success: true });
}));

router.delete('/signatures/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_signatures').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Signature');
  await docRef.delete();
  res.json({ success: true });
}));

// ===== CONTACTS / ADDRESS BOOK =====
router.get('/contacts', asyncHandler(async (req, res) => {
  const { q } = req.query;
  const snapshot = await db.collection('email_contacts').get();
  let contacts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

  if (q) {
    const query = q.toLowerCase();
    contacts = contacts.filter(c =>
      (c.email || '').toLowerCase().includes(query) ||
      (c.name || '').toLowerCase().includes(query) ||
      (c.company || '').toLowerCase().includes(query)
    );
  }

  // Sort by frequency (most contacted first)
  contacts.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
  res.json(contacts.slice(0, 50));
}));

router.post('/contacts', asyncHandler(async (req, res) => {
  const { email, name, company, phone, notes } = req.body;
  if (!email) throw new ValidationError('Contact validation failed', ['email is required']);

  // Check duplicate
  const existing = await db.collection('email_contacts').where('email', '==', email.toLowerCase().trim()).limit(1).get();
  if (!existing.empty) {
    throw new ConflictError('Contact already exists');
  }

  const docRef = await db.collection('email_contacts').add({
    email: email.toLowerCase().trim(),
    name: name || '',
    company: company || '',
    phone: phone || '',
    notes: notes || '',
    lastContacted: null,
    source: 'manual',
    frequency: 0,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ success: true, id: docRef.id });
}));

router.put('/contacts/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_contacts').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Contact');

  const { name, company, phone, notes } = req.body;
  await docRef.update({
    ...(name !== undefined ? { name } : {}),
    ...(company !== undefined ? { company } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(notes !== undefined ? { notes } : {}),
    updatedAt: new Date().toISOString(),
  });

  res.json({ success: true });
}));

router.delete('/contacts/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_contacts').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Contact');
  await docRef.delete();
  res.json({ success: true });
}));

// ===== LABELS =====
router.get('/labels', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('email_labels').get();
  const labels = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(labels);
}));

router.post('/labels', asyncHandler(async (req, res) => {
  const { name, color } = req.body;
  if (!name) throw new ValidationError('Label validation failed', ['name is required']);

  const docRef = await db.collection('email_labels').add({
    name: name.trim(),
    color: color || '#6366f1',
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ success: true, id: docRef.id });
}));

router.delete('/labels/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_labels').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Label');
  await docRef.delete();
  res.json({ success: true });
}));

// ===== CUSTOM FOLDERS =====
router.get('/folders', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('email_folders').get();
  const folders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(folders);
}));

router.post('/folders', asyncHandler(async (req, res) => {
  const { name, color, icon } = req.body;
  if (!name) throw new ValidationError('Folder validation failed', ['name is required']);

  const reserved = ['inbox', 'sent', 'drafts', 'trash', 'spam', 'starred', 'all'];
  if (reserved.includes(name.toLowerCase().trim())) {
    throw new ConflictError(`"${name}" is a reserved folder name`);
  }

  const docRef = await db.collection('email_folders').add({
    name: name.trim(),
    slug: name.trim().toLowerCase().replace(/\s+/g, '-'),
    color: color || '#6366f1',
    icon: icon || 'folder',
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ success: true, id: docRef.id });
}));

router.put('/folders/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_folders').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Folder');

  const { name, color, icon } = req.body;
  await docRef.update({
    ...(name !== undefined ? { name, slug: name.trim().toLowerCase().replace(/\s+/g, '-') } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(icon !== undefined ? { icon } : {}),
    updatedAt: new Date().toISOString(),
  });
  res.json({ success: true });
}));

router.delete('/folders/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('email_folders').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('Folder');

  // Move emails in this folder back to inbox
  const folderSlug = doc.data().slug;
  const emailSnap = await db.collection('received_emails').where('folder', '==', folderSlug).get();
  if (!emailSnap.empty) {
    const batch = db.batch();
    emailSnap.docs.forEach(d => batch.update(d.ref, { folder: 'inbox' }));
    await batch.commit();
  }

  await docRef.delete();
  res.json({ success: true });
}));

// ===== READ RECEIPTS =====
router.post('/read-receipt', asyncHandler(async (req, res) => {
  const { emailId, messageId } = req.body;

  await db.collection('read_receipts').add({
    emailId: emailId || '',
    messageId: messageId || '',
    readBy: req.user.uid,
    readAt: new Date().toISOString(),
  });

  res.json({ success: true });
}));

router.get('/read-receipts/:emailId', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('read_receipts').where('emailId', '==', req.params.emailId).get();
  const receipts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(receipts);
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
    queueStatus: getQueueStatus(),
  });
}));

// ===== GET SENT EMAILS WITH PAGINATION =====
router.get('/sent', asyncHandler(async (req, res) => {
  const { page = '1', limit = '50', search } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  try {
    const snapshot = await db.collection('sent_emails')
      .orderBy('sentAt', 'desc')
      .get();

    let emails = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    if (search) {
      const q = search.toLowerCase();
      emails = emails.filter(e =>
        (Array.isArray(e.to) ? e.to.join(' ') : e.to || '').toLowerCase().includes(q) ||
        (e.subject || '').toLowerCase().includes(q) ||
        (e.fromAlias || '').toLowerCase().includes(q)
      );
    }

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
router.post('/aliases', asyncHandler(async (req, res) => {
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

router.post('/templates', asyncHandler(async (req, res) => {
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
