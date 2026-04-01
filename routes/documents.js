import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { validate, validateQuery } from '../middleware/validator.js';
import { sendEmail, getMailConfig } from '../utils/mailer.js';

const router = Router();
router.use(verifyToken);

// From-alias mapping based on document type
const DOC_TYPE_ALIAS = {
  Letter:    'letter@akshaykotish.com',
  Invoice:   'bills@akshaykotish.com',
  Notice:    'legal@akshaykotish.com',
  Agreement: 'legal@akshaykotish.com',
  General:   'documents@akshaykotish.com',
};

const VALID_DOC_TYPES = ['letter', 'invoice', 'notice', 'agreement', 'general'];
const VALID_STATUSES = ['draft', 'review', 'approved', 'published', 'archived'];
const VALID_PERMISSIONS = ['view', 'edit', 'comment', 'download'];

// ─── Helper: Pagination defaults ──────────────────────────────────────────────

function getPaginationParams(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ─── Helper: Log audit event ──────────────────────────────────────────────────

async function logAudit(documentId, userId, action, details = {}) {
  await db.collection('document_audit_log').add({
    documentId,
    userId,
    action,
    details,
    timestamp: new Date().toISOString(),
  });
}

// ─── Get all documents with pagination, search, and advanced filters ─────────

router.get('/', validateQuery({
  page: 'optionalString', limit: 'optionalString', search: 'optionalString',
  type: 'optionalString', author: 'optionalString', status: 'optionalString',
  category: 'optionalString', tag: 'optionalString',
  dateFrom: 'optionalString', dateTo: 'optionalString',
}), asyncHandler(async (req, res) => {
  const { skip, limit, page } = getPaginationParams(req);
  const { search, type, author, status, category, tag, dateFrom, dateTo } = req.query;

  let query = db.collection('documents');

  if (type) query = query.where('type', '==', type.toLowerCase());
  if (author) query = query.where('author', '==', author);
  if (status) query = query.where('status', '==', status);
  if (category) query = query.where('category', '==', category);

  const snapshot = await query.orderBy('updatedAt', 'desc').get();
  let docs = snapshot.docs;

  // In-memory filters for fields Firestore can't combine
  if (search) {
    const s = search.toLowerCase();
    docs = docs.filter(doc => {
      const d = doc.data();
      return (d.title || '').toLowerCase().includes(s) ||
             (d.content || '').toLowerCase().includes(s) ||
             (d.tags || []).some(t => t.toLowerCase().includes(s));
    });
  }
  if (tag) {
    docs = docs.filter(doc => (doc.data().tags || []).includes(tag));
  }
  if (dateFrom) {
    docs = docs.filter(doc => (doc.data().createdAt || '') >= dateFrom);
  }
  if (dateTo) {
    docs = docs.filter(doc => (doc.data().createdAt || '') <= dateTo + 'T23:59:59');
  }

  const total = docs.length;
  const paginated = docs.slice(skip, skip + limit);

  console.info(JSON.stringify({
    level: 'info', action: 'list_documents', userId: req.user.uid,
    filters: { search: !!search, type: !!type, author: !!author, status: !!status, category: !!category, tag: !!tag },
    pagination: { page, limit, total },
    timestamp: new Date().toISOString(),
  }));

  res.json({
    data: paginated.map(doc => ({ id: doc.id, ...doc.data() })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
}));

// ─── Get single document ──────────────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('documents').doc(req.params.id).get();
  if (!doc.exists) throw new NotFoundError('Document');

  await logAudit(req.params.id, req.user.uid, 'view');
  res.json({ id: doc.id, ...doc.data() });
}));

// ─── Create document ──────────────────────────────────────────────────────────

router.post('/', validate('createDocument'), asyncHandler(async (req, res) => {
  const { title, content, type, category, tags, status: docStatus } = req.body;

  if (!title || title.trim().length === 0) {
    throw new ValidationError('Document title is required');
  }

  const docType = type && typeof type === 'string' ? type.toLowerCase() : 'general';
  if (!VALID_DOC_TYPES.includes(docType)) {
    throw new ValidationError('Invalid document type', [`Type must be one of: ${VALID_DOC_TYPES.join(', ')}`]);
  }

  const initialStatus = docStatus && VALID_STATUSES.includes(docStatus) ? docStatus : 'draft';

  const document = {
    title: title.trim(),
    content: content || '',
    type: docType,
    status: initialStatus,
    category: category || '',
    tags: Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : [],
    author: req.user.uid,
    authorEmail: req.user.email || '',
    version: 1,
    sharedWith: [],
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const docRef = await db.collection('documents').add(document);

  // Save initial version
  await db.collection('documents').doc(docRef.id).collection('versions').add({
    version: 1,
    title: document.title,
    content: document.content,
    editedBy: req.user.uid,
    editedByEmail: req.user.email || '',
    createdAt: new Date().toISOString(),
  });

  await logAudit(docRef.id, req.user.uid, 'create', { title });

  console.info(JSON.stringify({
    level: 'info', action: 'create_document', documentId: docRef.id,
    title, type: docType, userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, ...document });
}));

// ─── Update document (with versioning) ──────────────────────────────────────

router.put('/:id', asyncHandler(async (req, res) => {
  const { title, content, type, category, tags, status: docStatus, expiresAt } = req.body;

  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) throw new NotFoundError('Document');

  const existing = docSnap.data();
  const update = { updatedAt: new Date().toISOString() };

  if (title !== undefined) update.title = title.trim();
  if (content !== undefined) update.content = content;
  if (type !== undefined) update.type = type.toLowerCase();
  if (category !== undefined) update.category = category;
  if (tags !== undefined) update.tags = Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : [];
  if (docStatus !== undefined && VALID_STATUSES.includes(docStatus)) update.status = docStatus;
  if (expiresAt !== undefined) update.expiresAt = expiresAt;

  // Bump version if content or title changed
  const contentChanged = content !== undefined && content !== existing.content;
  const titleChanged = title !== undefined && title.trim() !== existing.title;

  if (contentChanged || titleChanged) {
    const newVersion = (existing.version || 1) + 1;
    update.version = newVersion;

    await db.collection('documents').doc(req.params.id).collection('versions').add({
      version: newVersion,
      title: update.title || existing.title,
      content: update.content !== undefined ? update.content : existing.content,
      editedBy: req.user.uid,
      editedByEmail: req.user.email || '',
      createdAt: new Date().toISOString(),
    });
  }

  await db.collection('documents').doc(req.params.id).update(update);
  await logAudit(req.params.id, req.user.uid, 'edit', { fields: Object.keys(update) });

  console.info(JSON.stringify({
    level: 'info', action: 'update_document', documentId: req.params.id,
    userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, version: update.version || existing.version });
}));

// ─── Delete document ─────────────────────────────────────────────────────────

router.delete('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('documents').doc(req.params.id).get();
  if (!doc.exists) throw new NotFoundError('Document');

  await db.collection('documents').doc(req.params.id).delete();
  await logAudit(req.params.id, req.user.uid, 'delete');

  console.info(JSON.stringify({
    level: 'info', action: 'delete_document', documentId: req.params.id,
    userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.status(204).send();
}));

// ─── Get version history ────────────────────────────────────────────────────

router.get('/:id/versions', asyncHandler(async (req, res) => {
  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) throw new NotFoundError('Document');

  const snapshot = await db.collection('documents').doc(req.params.id)
    .collection('versions').orderBy('createdAt', 'desc').get();

  const versions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(versions);
}));

// ─── Get specific version ───────────────────────────────────────────────────

router.get('/:id/versions/:versionId', asyncHandler(async (req, res) => {
  const vSnap = await db.collection('documents').doc(req.params.id)
    .collection('versions').doc(req.params.versionId).get();
  if (!vSnap.exists) throw new NotFoundError('Version');
  res.json({ id: vSnap.id, ...vSnap.data() });
}));

// ─── Restore a version ─────────────────────────────────────────────────────

router.post('/:id/versions/:versionId/restore', asyncHandler(async (req, res) => {
  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) throw new NotFoundError('Document');

  const vSnap = await db.collection('documents').doc(req.params.id)
    .collection('versions').doc(req.params.versionId).get();
  if (!vSnap.exists) throw new NotFoundError('Version');

  const vData = vSnap.data();
  const existing = docSnap.data();
  const newVersion = (existing.version || 1) + 1;

  await db.collection('documents').doc(req.params.id).update({
    title: vData.title,
    content: vData.content,
    version: newVersion,
    updatedAt: new Date().toISOString(),
  });

  await db.collection('documents').doc(req.params.id).collection('versions').add({
    version: newVersion,
    title: vData.title,
    content: vData.content,
    editedBy: req.user.uid,
    editedByEmail: req.user.email || '',
    restoredFrom: req.params.versionId,
    createdAt: new Date().toISOString(),
  });

  await logAudit(req.params.id, req.user.uid, 'restore_version', { fromVersion: req.params.versionId });

  res.json({ success: true, version: newVersion });
}));

// ─── Share document ─────────────────────────────────────────────────────────

router.post('/:id/share', asyncHandler(async (req, res) => {
  const { email, permissions } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new ValidationError('Valid email is required');
  }

  const perms = Array.isArray(permissions) ? permissions.filter(p => VALID_PERMISSIONS.includes(p)) : ['view'];
  if (perms.length === 0) perms.push('view');

  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) throw new NotFoundError('Document');

  const existing = docSnap.data();
  const sharedWith = existing.sharedWith || [];

  const idx = sharedWith.findIndex(s => s.email === email);
  if (idx >= 0) {
    sharedWith[idx].permissions = perms;
    sharedWith[idx].updatedAt = new Date().toISOString();
  } else {
    sharedWith.push({
      email,
      permissions: perms,
      sharedBy: req.user.uid,
      sharedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  await db.collection('documents').doc(req.params.id).update({ sharedWith });
  await logAudit(req.params.id, req.user.uid, 'share', { email, permissions: perms });

  res.json({ success: true, sharedWith });
}));

// ─── Remove share ───────────────────────────────────────────────────────────

router.delete('/:id/share/:email', asyncHandler(async (req, res) => {
  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) throw new NotFoundError('Document');

  const existing = docSnap.data();
  const sharedWith = (existing.sharedWith || []).filter(s => s.email !== req.params.email);

  await db.collection('documents').doc(req.params.id).update({ sharedWith });
  await logAudit(req.params.id, req.user.uid, 'unshare', { email: req.params.email });

  res.json({ success: true, sharedWith });
}));

// ─── Update document status (approval workflow) ──────────────────────────────

router.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!status || !VALID_STATUSES.includes(status)) {
    throw new ValidationError('Invalid status', [`Status must be one of: ${VALID_STATUSES.join(', ')}`]);
  }

  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) throw new NotFoundError('Document');

  await db.collection('documents').doc(req.params.id).update({
    status,
    updatedAt: new Date().toISOString(),
  });

  await logAudit(req.params.id, req.user.uid, 'status_change', { from: docSnap.data().status, to: status });

  res.json({ success: true, status });
}));

// ─── Comments ───────────────────────────────────────────────────────────────

router.get('/:id/comments', asyncHandler(async (req, res) => {
  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) throw new NotFoundError('Document');

  const snapshot = await db.collection('documents').doc(req.params.id)
    .collection('comments').orderBy('createdAt', 'desc').get();

  res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
}));

router.post('/:id/comments', asyncHandler(async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new ValidationError('Comment text is required');
  }

  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) throw new NotFoundError('Document');

  const comment = {
    text: text.trim(),
    author: req.user.uid,
    authorEmail: req.user.email || '',
    createdAt: new Date().toISOString(),
  };

  const ref = await db.collection('documents').doc(req.params.id).collection('comments').add(comment);
  await logAudit(req.params.id, req.user.uid, 'comment', { commentId: ref.id });

  res.status(201).json({ id: ref.id, ...comment });
}));

router.delete('/:id/comments/:commentId', asyncHandler(async (req, res) => {
  const commentSnap = await db.collection('documents').doc(req.params.id)
    .collection('comments').doc(req.params.commentId).get();
  if (!commentSnap.exists) throw new NotFoundError('Comment');

  await db.collection('documents').doc(req.params.id)
    .collection('comments').doc(req.params.commentId).delete();

  res.status(204).send();
}));

// ─── Audit log ──────────────────────────────────────────────────────────────

router.get('/:id/audit', asyncHandler(async (req, res) => {
  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) throw new NotFoundError('Document');

  const snapshot = await db.collection('document_audit_log')
    .where('documentId', '==', req.params.id)
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get();

  res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
}));

// ─── Bulk operations ────────────────────────────────────────────────────────

router.post('/bulk/delete', asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('ids array is required');
  }
  if (ids.length > 50) {
    throw new ValidationError('Cannot delete more than 50 documents at once');
  }

  const batch = db.batch();
  for (const id of ids) {
    batch.delete(db.collection('documents').doc(id));
  }
  await batch.commit();

  for (const id of ids) {
    await logAudit(id, req.user.uid, 'bulk_delete');
  }

  console.info(JSON.stringify({
    level: 'info', action: 'bulk_delete_documents', count: ids.length,
    userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, deleted: ids.length });
}));

router.post('/bulk/status', asyncHandler(async (req, res) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) throw new ValidationError('ids array is required');
  if (!status || !VALID_STATUSES.includes(status)) throw new ValidationError('Valid status is required');

  const batch = db.batch();
  const now = new Date().toISOString();
  for (const id of ids) {
    batch.update(db.collection('documents').doc(id), { status, updatedAt: now });
  }
  await batch.commit();

  res.json({ success: true, updated: ids.length, status });
}));

router.post('/bulk/share', asyncHandler(async (req, res) => {
  const { ids, email, permissions } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) throw new ValidationError('ids array is required');
  if (!email || !email.includes('@')) throw new ValidationError('Valid email is required');

  const perms = Array.isArray(permissions) ? permissions.filter(p => VALID_PERMISSIONS.includes(p)) : ['view'];

  for (const id of ids) {
    const docSnap = await db.collection('documents').doc(id).get();
    if (!docSnap.exists) continue;
    const existing = docSnap.data();
    const sharedWith = existing.sharedWith || [];
    const idx = sharedWith.findIndex(s => s.email === email);
    if (idx >= 0) {
      sharedWith[idx].permissions = perms;
      sharedWith[idx].updatedAt = new Date().toISOString();
    } else {
      sharedWith.push({ email, permissions: perms, sharedBy: req.user.uid, sharedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    await db.collection('documents').doc(id).update({ sharedWith });
  }

  res.json({ success: true, shared: ids.length });
}));

// ─── Get all categories ─────────────────────────────────────────────────────

router.get('/meta/categories', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('documents').get();
  const categories = new Set();
  snapshot.docs.forEach(d => {
    const cat = d.data().category;
    if (cat) categories.add(cat);
  });
  res.json([...categories].sort());
}));

// ─── Get all tags ───────────────────────────────────────────────────────────

router.get('/meta/tags', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('documents').get();
  const tags = new Set();
  snapshot.docs.forEach(d => {
    (d.data().tags || []).forEach(t => tags.add(t));
  });
  res.json([...tags].sort());
}));

// ─── Send document via email ──────────────────────────────────────────────────

router.post('/:id/send-email', validate('sendDocumentEmail'), asyncHandler(async (req, res) => {
  const docSnap = await db.collection('documents').doc(req.params.id).get();
  if (!docSnap.exists) {
    throw new NotFoundError('Document');
  }

  const document = { id: docSnap.id, ...docSnap.data() };
  const { to, subject, coverMessage, fromAlias, pdfBase64, pdfFileName } = req.body;

  if (!to || typeof to !== 'string' || !to.includes('@')) {
    throw new ValidationError('Valid recipient email (to) is required');
  }

  const config = getMailConfig();
  if (!config) {
    throw new Error('Email provider not configured');
  }

  const cn  = process.env.COMPANY_NAME || 'Akshay Kotish & Co.';
  const ln  = process.env.COMPANY_LEGAL_NAME || 'Akshay Lakshay Kotish Private Limited';
  const cin = process.env.COMPANY_CIN || 'U72900HR2022PTC101170';
  const gstin = process.env.COMPANY_GSTIN || '06AAWCA4919K1Z3';
  const pan = process.env.COMPANY_PAN || 'AAWCA4919K';
  const addr  = process.env.COMPANY_ADDRESS || 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027';
  const phone = process.env.COMPANY_PHONE || '+91 98967 70369';
  const website = process.env.COMPANY_WEBSITE || 'www.akshaykotish.com';
  const tagline = 'Chartered Accountants & Business Consultants';

  const docType = document.type || 'General';
  const docTitle = document.title || 'Document';
  const senderAlias = fromAlias || DOC_TYPE_ALIAS[docType] || 'documents@akshaykotish.com';
  const emailSubject = subject || `${docType}: ${docTitle} | ${cn}`;
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  const html = `
<div style="font-family:'Inter','Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#1e293b;color:#fff;padding:24px 30px;border-radius:10px 10px 0 0;">
    <table style="width:100%;border:none;border-collapse:collapse;"><tr>
      <td style="border:none;padding:0;vertical-align:top;">
        <h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.3px;">${cn.toUpperCase()}</h1>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-style:italic;">${ln}</div>
        <div style="font-size:10px;color:#c0e040;margin-top:4px;font-weight:600;">${tagline}</div>
      </td>
      <td style="border:none;padding:0;text-align:right;vertical-align:top;">
        <div style="font-size:20px;font-weight:900;color:#c0e040;text-transform:uppercase;letter-spacing:1px;">${docType}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${today}</div>
      </td>
    </tr></table>
  </div>
  <div style="background:#f8fafc;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;padding:8px 30px;font-size:10px;color:#64748b;font-family:'Courier New',monospace;">
    GSTIN: ${gstin} &nbsp;&bull;&nbsp; CIN: ${cin} &nbsp;&bull;&nbsp; PAN: ${pan}
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;padding:30px;background:#fff;">
    ${coverMessage ? `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:11px;color:#2563eb;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Cover Note</div>
      <p style="font-size:13px;color:#1e40af;line-height:1.6;margin:0;white-space:pre-wrap;">${coverMessage}</p>
    </div>` : ''}
    ${pdfBase64 ? `
    <div style="background:#fef9c3;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:24px;display:flex;align-items:center;">
      <span style="font-size:13px;color:#854d0e;">&#128206; PDF document <strong>${pdfFileName || 'document.pdf'}</strong> is attached to this email.</span>
    </div>` : ''}
    <div style="border-bottom:2px solid #2e7d32;padding-bottom:10px;margin-bottom:20px;">
      <h2 style="margin:0;font-size:18px;font-weight:700;color:#1e293b;">${docTitle}</h2>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Ref: DOC-${req.params.id.substring(0, 8).toUpperCase()} &nbsp;|&nbsp; Date: ${today}</div>
    </div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;line-height:1.8;color:#1a1a1a;">
      ${document.content || '<p>—</p>'}
    </div>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:30px 0 20px;" />
    <table style="width:100%;border-collapse:collapse;font-size:11px;color:#94a3b8;"><tr>
      <td style="border:none;padding:0;vertical-align:top;">
        <strong style="color:#1e293b;">${cn}</strong><br/>
        ${addr}
      </td>
      <td style="border:none;padding:0;text-align:right;vertical-align:top;">
        ${senderAlias}<br/>
        ${phone}<br/>
        <span style="color:#2e7d32;font-weight:700;">${website}</span>
      </td>
    </tr></table>
  </div>
  <div style="background:#f8fafc;padding:12px 30px;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
    <p style="font-size:10px;color:#94a3b8;margin:0;">
      This document has been sent from ${cn}. For queries, contact ${senderAlias} or ${phone}.
    </p>
  </div>
</div>`;

  const attachments = [];
  if (pdfBase64 && pdfFileName) {
    attachments.push({
      filename: pdfFileName,
      content: Buffer.from(pdfBase64, 'base64'),
      contentType: 'application/pdf',
    });
  }

  await sendEmail({ to, subject: emailSubject, html, from: senderAlias, fromName: cn, attachments });

  await db.collection('sent_emails').add({
    to, subject: emailSubject, fromAlias: senderAlias, fromName: cn,
    type: 'document', documentId: document.id, documentTitle: docTitle,
    documentType: docType, hasPDF: !!pdfBase64,
    sentBy: req.user.uid, sentAt: new Date().toISOString(),
  });

  await logAudit(req.params.id, req.user.uid, 'email_sent', { to });

  console.info(JSON.stringify({
    level: 'info', action: 'send_document_email', documentId: req.params.id,
    recipient: to, hasPDF: !!pdfBase64, userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, message: `Document emailed to ${to} from ${senderAlias}` });
}));

export default router;
