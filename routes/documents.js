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

// ─── Helper: Pagination defaults ──────────────────────────────────────────────

function getPaginationParams(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ─── Get all documents with pagination and search ───────────────────────────

router.get('/', validateQuery({ page: 'optionalString', limit: 'optionalString', search: 'optionalString', type: 'optionalString', author: 'optionalString' }), asyncHandler(async (req, res) => {
  const { skip, limit, page } = getPaginationParams(req);
  const { search, type, author } = req.query;

  let query = db.collection('documents');

  // Apply filters by type or author if provided
  if (type) {
    query = query.where('type', '==', type.toLowerCase());
  }
  if (author) {
    query = query.where('author', '==', author);
  }

  const snapshot = await query.orderBy('updatedAt', 'desc').get();
  let docs = snapshot.docs;

  // Apply search filter (title/content-based) in memory
  if (search) {
    const searchLower = search.toLowerCase();
    docs = docs.filter(doc => {
      const data = doc.data();
      return (data.title || '').toLowerCase().includes(searchLower) ||
             (data.content || '').toLowerCase().includes(searchLower);
    });
  }

  const total = docs.length;
  const paginated = docs.slice(skip, skip + limit);

  console.info(JSON.stringify({
    level: 'info',
    action: 'list_documents',
    userId: req.user.uid,
    filters: { search: !!search, type: !!type, author: !!author },
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
  if (!doc.exists) {
    throw new NotFoundError('Document');
  }
  res.json({ id: doc.id, ...doc.data() });
}));

// ─── Create document ──────────────────────────────────────────────────────────

router.post('/', validate('createDocument'), asyncHandler(async (req, res) => {
  const { title, content, type } = req.body;

  // Validate required fields
  if (!title || title.trim().length === 0) {
    throw new ValidationError('Document title is required');
  }

  const docType = type && typeof type === 'string' ? type.toLowerCase() : 'general';
  const validTypes = ['letter', 'invoice', 'notice', 'agreement', 'general'];
  if (!validTypes.includes(docType)) {
    throw new ValidationError('Invalid document type', [`Type must be one of: ${validTypes.join(', ')}`]);
  }

  const document = {
    title: title.trim(),
    content: content || '',
    type: docType,
    author: req.user.uid,
    authorEmail: req.user.email || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const docRef = await db.collection('documents').add(document);

  console.info(JSON.stringify({
    level: 'info',
    action: 'create_document',
    documentId: docRef.id,
    title: title,
    type: docType,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, ...document });
}));

// ─── Update document ─────────────────────────────────────────────────────────

router.put('/:id', asyncHandler(async (req, res) => {
  const { title, content, type } = req.body;

  // Verify document exists
  const doc = await db.collection('documents').doc(req.params.id).get();
  if (!doc.exists) {
    throw new NotFoundError('Document');
  }

  const update = { updatedAt: new Date().toISOString() };
  if (title !== undefined) update.title = title.trim();
  if (content !== undefined) update.content = content;
  if (type !== undefined) update.type = type.toLowerCase();

  await db.collection('documents').doc(req.params.id).update(update);

  console.info(JSON.stringify({
    level: 'info',
    action: 'update_document',
    documentId: req.params.id,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true });
}));

// ─── Delete document ─────────────────────────────────────────────────────────

router.delete('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('documents').doc(req.params.id).get();
  if (!doc.exists) {
    throw new NotFoundError('Document');
  }

  await db.collection('documents').doc(req.params.id).delete();

  console.info(JSON.stringify({
    level: 'info',
    action: 'delete_document',
    documentId: req.params.id,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.status(204).send();
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

  // Build the full letterpad HTML email
  const html = `
<div style="font-family:'Inter','Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;color:#1a1a1a;">
  <!-- Header — same style as invoice emails -->
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

  <!-- Statutory bar -->
  <div style="background:#f8fafc;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;padding:8px 30px;font-size:10px;color:#64748b;font-family:'Courier New',monospace;">
    GSTIN: ${gstin} &nbsp;&bull;&nbsp; CIN: ${cin} &nbsp;&bull;&nbsp; PAN: ${pan}
  </div>

  <!-- Body -->
  <div style="border:1px solid #e2e8f0;border-top:none;padding:30px;background:#fff;">
    ${coverMessage ? `
    <!-- Cover Message -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:11px;color:#2563eb;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Cover Note</div>
      <p style="font-size:13px;color:#1e40af;line-height:1.6;margin:0;white-space:pre-wrap;">${coverMessage}</p>
    </div>` : ''}

    ${pdfBase64 ? `
    <!-- PDF Attachment Notice -->
    <div style="background:#fef9c3;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:24px;display:flex;align-items:center;">
      <span style="font-size:13px;color:#854d0e;">&#128206; PDF document <strong>${pdfFileName || 'document.pdf'}</strong> is attached to this email.</span>
    </div>` : ''}

    <!-- Document Title -->
    <div style="border-bottom:2px solid #2e7d32;padding-bottom:10px;margin-bottom:20px;">
      <h2 style="margin:0;font-size:18px;font-weight:700;color:#1e293b;">${docTitle}</h2>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Ref: DOC-${req.params.id.substring(0, 8).toUpperCase()} &nbsp;|&nbsp; Date: ${today}</div>
    </div>

    <!-- Document Content -->
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;line-height:1.8;color:#1a1a1a;">
      ${document.content || '<p>—</p>'}
    </div>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:30px 0 20px;" />

    <!-- Company Footer inside body -->
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

  <!-- Footer -->
  <div style="background:#f8fafc;padding:12px 30px;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
    <p style="font-size:10px;color:#94a3b8;margin:0;">
      This document has been sent from ${cn}. For queries, contact ${senderAlias} or ${phone}.
    </p>
  </div>
</div>`;

  // Attachments
  const attachments = [];
  if (pdfBase64 && pdfFileName) {
    attachments.push({
      filename: pdfFileName,
      content: Buffer.from(pdfBase64, 'base64'),
      contentType: 'application/pdf',
    });
  }

  await sendEmail({
    to,
    subject: emailSubject,
    html,
    from: senderAlias,
    fromName: cn,
    attachments,
  });

  // Log to sent_emails
  await db.collection('sent_emails').add({
    to,
    subject: emailSubject,
    fromAlias: senderAlias,
    fromName: cn,
    type: 'document',
    documentId: document.id,
    documentTitle: docTitle,
    documentType: docType,
    hasPDF: !!pdfBase64,
    sentBy: req.user.uid,
    sentAt: new Date().toISOString(),
  });

  console.info(JSON.stringify({
    level: 'info',
    action: 'send_document_email',
    documentId: req.params.id,
    recipient: to,
    hasPDF: !!pdfBase64,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, message: `Document emailed to ${to} from ${senderAlias}` });
}));

export default router;
