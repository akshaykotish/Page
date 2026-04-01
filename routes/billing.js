import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { v4 as uuidv4 } from 'uuid';
import { sendEmail as dispatchEmail, getMailConfig } from '../utils/mailer.js';
import { postJournalEntry, reverseJournalEntry } from '../utils/ledger.js';

const router = Router();
router.use(verifyToken);

// ─── Helper Functions ─────────────────────────────────────────────────────

async function sendInvoiceEmail(invoice, reason = 'payment_received', attachments = []) {
  const email = invoice.customer?.email;
  if (!email) return null;

  const config = getMailConfig();
  if (!config) return null;

  const cn = process.env.COMPANY_NAME || 'Akshay Kotish & Co.';
  const ln = process.env.COMPANY_LEGAL_NAME || 'Akshay Lakshay Kotish Private Limited';
  const cin = process.env.COMPANY_CIN || 'U72900HR2022PTC101170';
  const gstin = process.env.COMPANY_GSTIN || '06AAWCA4919K1Z3';
  const addr = process.env.COMPANY_ADDRESS || 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027';
  const phone = process.env.COMPANY_PHONE || '+91 98967 70369';
  const website = process.env.COMPANY_WEBSITE || 'www.akshaykotish.com';
  const fmtCur = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v || 0);
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

  const items = invoice.items || [];
  const isInterstate = invoice.isInterstate;
  const subtotal = invoice.subtotal || items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
  const totalTax = invoice.totalTax || (invoice.cgst || 0) + (invoice.sgst || 0) + (invoice.igst || 0) || subtotal * 0.18;
  const total = invoice.total || subtotal + totalTax;
  const cgst = invoice.cgst || (isInterstate ? 0 : totalTax / 2);
  const sgst = invoice.sgst || (isInterstate ? 0 : totalTax / 2);
  const igst = invoice.igst || (isInterstate ? totalTax : 0);

  const isPaid = reason === 'payment_received';
  const subjectPrefix = isPaid ? 'Payment Received' : 'Invoice';

  const html = `
<div style="font-family:'Poppins','Inter',Arial,sans-serif;max-width:700px;margin:0 auto;color:#1a1a1a;">
  <!-- Header -->
  <div style="background:#ffffff;padding:28px 30px 20px;border-bottom:3px solid #2e7d32;border-radius:10px 10px 0 0;">
    <table style="width:100%;border:none;border-collapse:collapse;"><tr>
      <td style="border:none;padding:0;vertical-align:top;">
        <h1 style="margin:0;font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.5px;">${cn.toUpperCase()}</h1>
        <div style="font-size:10px;color:#64748b;margin-top:2px;font-weight:400;">A Brand of ${ln}</div>
        <div style="font-size:10px;color:#2e7d32;font-weight:600;margin-top:4px;">Chartered Accountants & Business Consultants</div>
      </td>
      <td style="border:none;padding:0;text-align:right;vertical-align:top;">
        <div style="font-size:24px;font-weight:800;color:${isPaid ? '#16a34a' : '#2e7d32'};">${isPaid ? 'PAID' : 'INVOICE'}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">${invoice.invoiceNumber || ''}</div>
      </td>
    </tr></table>
  </div>

  <!-- Body -->
  <div style="border:1px solid #e2e8f0;border-top:none;padding:30px;background:#fff;">
    ${isPaid ? `
    <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
      <div style="font-size:14px;font-weight:700;color:#16a34a;">Payment Received Successfully</div>
      <div style="font-size:12px;color:#15803d;margin-top:4px;">Thank you for your prompt payment.</div>
    </div>` : ''}

    <p style="font-size:14px;margin:0 0 16px;">Dear <strong>${invoice.customer?.name || 'Sir/Madam'}</strong>,</p>
    <p style="font-size:13px;color:#475569;line-height:1.6;margin:0 0 20px;">
      ${isPaid
        ? `We confirm receipt of payment for Invoice <strong>${invoice.invoiceNumber}</strong>. Please find the invoice details below for your records.`
        : `Please find attached your invoice <strong>${invoice.invoiceNumber}</strong>. Details are provided below.`}
    </p>

    <!-- Invoice Meta -->
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
      <tr>
        <td style="padding:6px 0;color:#64748b;width:30%;">Invoice Number</td>
        <td style="padding:6px 0;font-weight:600;">${invoice.invoiceNumber || ''}</td>
        <td style="padding:6px 0;color:#64748b;width:20%;">Date</td>
        <td style="padding:6px 0;font-weight:600;">${fmtDate(invoice.date || invoice.createdAt)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#64748b;">Customer GSTIN</td>
        <td style="padding:6px 0;font-weight:600;">${invoice.customer?.gstin || 'N/A'}</td>
        <td style="padding:6px 0;color:#64748b;">Due Date</td>
        <td style="padding:6px 0;font-weight:600;">${fmtDate(invoice.dueDate)}</td>
      </tr>
    </table>

    <!-- Items Table -->
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px 12px;text-align:left;border:1px solid #e2e8f0;font-weight:700;font-size:11px;text-transform:uppercase;color:#64748b;">#</th>
          <th style="padding:10px 12px;text-align:left;border:1px solid #e2e8f0;font-weight:700;font-size:11px;text-transform:uppercase;color:#64748b;">Description</th>
          <th style="padding:10px 12px;text-align:right;border:1px solid #e2e8f0;font-weight:700;font-size:11px;text-transform:uppercase;color:#64748b;">Qty</th>
          <th style="padding:10px 12px;text-align:right;border:1px solid #e2e8f0;font-weight:700;font-size:11px;text-transform:uppercase;color:#64748b;">Rate</th>
          <th style="padding:10px 12px;text-align:right;border:1px solid #e2e8f0;font-weight:700;font-size:11px;text-transform:uppercase;color:#64748b;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((it, i) => `
        <tr>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;">${i + 1}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;">${it.description || ''}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;">${it.qty || 0}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;">${fmtCur(it.rate)}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:600;">${fmtCur((it.qty || 0) * (it.rate || 0))}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <!-- Totals -->
    <table style="width:300px;margin-left:auto;font-size:13px;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#64748b;">Subtotal</td><td style="padding:6px 0;text-align:right;font-weight:600;">${fmtCur(subtotal)}</td></tr>
      ${isInterstate
        ? `<tr><td style="padding:6px 0;color:#64748b;">IGST</td><td style="padding:6px 0;text-align:right;">${fmtCur(igst)}</td></tr>`
        : `<tr><td style="padding:6px 0;color:#64748b;">CGST</td><td style="padding:6px 0;text-align:right;">${fmtCur(cgst)}</td></tr>
           <tr><td style="padding:6px 0;color:#64748b;">SGST</td><td style="padding:6px 0;text-align:right;">${fmtCur(sgst)}</td></tr>`}
      <tr style="border-top:2px solid #1e293b;">
        <td style="padding:10px 0;font-size:16px;font-weight:800;">Total</td>
        <td style="padding:10px 0;text-align:right;font-size:16px;font-weight:800;color:#2e7d32;">${fmtCur(total)}</td>
      </tr>
    </table>

    ${isPaid ? `
    <div style="background:#f0fdf4;border-radius:8px;padding:12px 16px;margin-top:20px;font-size:12px;color:#15803d;text-align:center;">
      <strong>Status: PAID</strong> — ${fmtDate(new Date().toISOString())}
    </div>` : ''}

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
    <p style="font-size:11px;color:#94a3b8;line-height:1.6;margin:0;">
      ${cn} | CIN: ${cin} | GSTIN: ${gstin}<br/>
      ${addr}<br/>
      ${config.fromEmail} | ${phone} | ${website}
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#f8fafc;padding:12px 30px;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
    <p style="font-size:10px;color:#94a3b8;margin:0;">This is a computer-generated invoice. For queries, contact us at ${config.fromEmail}</p>
  </div>
</div>`;

  try {
    await dispatchEmail({
      to: email,
      subject: `${subjectPrefix} — ${invoice.invoiceNumber} | ${fmtCur(total)} | ${cn}`,
      html,
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    await db.collection('sent_emails').add({
      to: email,
      subject: `${subjectPrefix} — ${invoice.invoiceNumber}`,
      type: isPaid ? 'payment_receipt' : 'invoice',
      invoiceId: invoice.id || '',
      sentAt: new Date().toISOString(),
    });

    console.log(JSON.stringify({
      level: 'info',
      operation: 'invoice_email_sent',
      invoiceId: invoice.id,
      email,
      reason,
      timestamp: new Date().toISOString(),
    }));

    return { success: true, to: email };
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      operation: 'invoice_email_failed',
      invoiceId: invoice.id,
      error: err.message,
      timestamp: new Date().toISOString(),
    }));
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INVOICE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Get all invoices with pagination and filtering
router.get('/invoices', apiLimiter, asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const { status, customer, startDate, endDate } = req.query;

  let query = db.collection('invoices');

  // Apply status filter
  if (status) {
    query = query.where('status', '==', status);
  }

  // Apply customer filter
  if (customer) {
    query = query.where('customer.name', '>=', customer)
      .where('customer.name', '<=', customer + '\uf8ff');
  }

  // Build ordered query
  query = query.orderBy('status', 'desc').orderBy('createdAt', 'desc');

  const snapshot = await query.get();
  let invoices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Apply date range filter (client-side due to Firestore limitations)
  if (startDate || endDate) {
    invoices = invoices.filter(inv => {
      const invDate = new Date(inv.date || inv.createdAt);
      const isAfterStart = !startDate || invDate >= new Date(startDate);
      const isBeforeEnd = !endDate || invDate <= new Date(endDate);
      return isAfterStart && isBeforeEnd;
    });
  }

  const totalInvoices = invoices.length;
  const totalPages = Math.ceil(totalInvoices / limit);
  const paginatedInvoices = invoices.slice(offset, offset + limit);

  console.log(JSON.stringify({
    level: 'info',
    operation: 'list_invoices',
    userId: req.user.uid,
    page,
    limit,
    total: totalInvoices,
    filters: { status, customer, startDate, endDate },
    timestamp: new Date().toISOString(),
  }));

  res.json({
    data: paginatedInvoices,
    pagination: { page, limit, total: totalInvoices, pages: totalPages },
  });
}));

// Get single invoice
router.get('/invoices/:id', apiLimiter, asyncHandler(async (req, res) => {
  const doc = await db.collection('invoices').doc(req.params.id).get();
  if (!doc.exists) {
    throw new NotFoundError('Invoice');
  }

  res.json({ id: doc.id, ...doc.data() });
}));

// Create invoice
router.post('/invoices', apiLimiter, asyncHandler(async (req, res) => {
  const { customer, items, notes, dueDate, companyState } = req.body;

  // Input validation
  if (!customer || !customer.name) {
    throw new ValidationError('customer.name required');
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items array required with at least one item');
  }

  // Validate items
  items.forEach((item, index) => {
    if (!item.description || !item.qty || !item.rate || item.gstRate === undefined) {
      throw new ValidationError(`Item ${index + 1}: description, qty, rate, and gstRate required`);
    }
    if (item.qty <= 0 || item.rate <= 0) {
      throw new ValidationError(`Item ${index + 1}: qty and rate must be positive numbers`);
    }
  });

  // Auto-generate invoice number using transaction
  const counterRef = db.collection('counters').doc('invoice');
  const counter = await db.runTransaction(async (t) => {
    const doc = await t.get(counterRef);
    const newCount = (doc.exists ? doc.data().count : 0) + 1;
    t.set(counterRef, { count: newCount });
    return newCount;
  });

  const _fy = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const invoiceNumber = `ALKPL/${_fy}-${_fy + 1}/${String(counter).padStart(4, '0')}`;

  // Calculate GST (existing logic preserved exactly)
  let subtotal = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;
  const isInterstate = customer.state !== (companyState || 'Haryana');

  const calculatedItems = items.map(item => {
    const amount = item.qty * item.rate;
    const gstAmount = amount * (item.gstRate / 100);
    subtotal += amount;

    if (isInterstate) {
      totalIGST += gstAmount;
    } else {
      totalCGST += gstAmount / 2;
      totalSGST += gstAmount / 2;
    }

    return { ...item, amount, gstAmount };
  });

  const total = subtotal + totalCGST + totalSGST + totalIGST;

  const invoice = {
    invoiceNumber,
    date: new Date().toISOString(),
    dueDate: dueDate || new Date(Date.now() + 30 * 86400000).toISOString(),
    customer,
    items: calculatedItems,
    subtotal,
    cgst: totalCGST,
    sgst: totalSGST,
    igst: totalIGST,
    isInterstate,
    total,
    status: 'draft',
    notes: notes || '',
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  };

  const docRef = await db.collection('invoices').add(invoice);

  // Create journal entry for the invoice (existing logic preserved exactly)
  await postJournalEntry({
    date: invoice.date,
    description: `Invoice ${invoiceNumber} — ${customer.name}`,
    reference: invoiceNumber,
    source: 'billing',
    sourceId: docRef.id,
    lines: [
      { account: 'Accounts Receivable', debit: total, credit: 0 },
      { account: 'Sales Revenue', debit: 0, credit: subtotal },
      { account: isInterstate ? 'IGST Payable' : 'CGST Payable', debit: 0, credit: isInterstate ? totalIGST : totalCGST },
      ...(!isInterstate ? [{ account: 'SGST Payable', debit: 0, credit: totalSGST }] : []),
    ],
    createdBy: req.user.uid,
  });

  console.log(JSON.stringify({
    level: 'info',
    operation: 'invoice_created',
    invoiceId: docRef.id,
    invoiceNumber,
    userId: req.user.uid,
    customer: customer.name,
    total,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, ...invoice });
}));

// Send invoice email
router.post('/invoices/:id/send-email', apiLimiter, asyncHandler(async (req, res) => {
  const docSnap = await db.collection('invoices').doc(req.params.id).get();
  if (!docSnap.exists) {
    throw new NotFoundError('Invoice');
  }

  const invoice = { id: docSnap.id, ...docSnap.data() };
  const reason = req.body.reason || (invoice.status === 'paid' ? 'payment_received' : 'invoice_sent');

  const attachments = [];
  if (req.body.pdfBase64 && req.body.fileName) {
    attachments.push({
      filename: req.body.fileName,
      content: Buffer.from(req.body.pdfBase64, 'base64'),
      contentType: 'application/pdf',
    });
  }

  const result = await sendInvoiceEmail(invoice, reason, attachments);

  if (result?.success) {
    console.log(JSON.stringify({
      level: 'info',
      operation: 'invoice_email_endpoint',
      invoiceId: req.params.id,
      email: result.to,
      timestamp: new Date().toISOString(),
    }));

    res.json({ success: true, message: `Invoice emailed to ${result.to}` });
  } else {
    throw new ValidationError(result?.error || 'No customer email found');
  }
}));

// Update invoice status
router.patch('/invoices/:id/status', apiLimiter, asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!status) {
    throw new ValidationError('status required');
  }

  const docSnap = await db.collection('invoices').doc(req.params.id).get();
  if (!docSnap.exists) {
    throw new NotFoundError('Invoice');
  }

  const updateData = {
    status,
    updatedAt: new Date().toISOString(),
    ...(status === 'paid' ? { paidDate: new Date().toISOString() } : {}),
  };

  await db.collection('invoices').doc(req.params.id).update(updateData);

  // When marked as paid, post payment journal entry and send email
  if (status === 'paid') {
    try {
      const invoice = { id: docSnap.id, ...docSnap.data() };

      // Post payment journal entry (existing logic preserved exactly)
      await postJournalEntry({
        date: new Date().toISOString(),
        description: `Payment received for ${invoice.invoiceNumber || req.params.id}`,
        reference: `PAY-${invoice.invoiceNumber || req.params.id}`,
        source: 'billing',
        sourceId: req.params.id,
        lines: [
          { account: 'Bank Account', debit: invoice.total, credit: 0 },
          { account: 'Accounts Receivable', debit: 0, credit: invoice.total },
        ],
        createdBy: req.user.uid,
      });

      await sendInvoiceEmail(invoice, 'payment_received');

      console.log(JSON.stringify({
        level: 'info',
        operation: 'invoice_marked_paid',
        invoiceId: req.params.id,
        userId: req.user.uid,
        timestamp: new Date().toISOString(),
      }));
    } catch (emailErr) {
      console.error(JSON.stringify({
        level: 'warn',
        operation: 'invoice_payment_email_failed',
        invoiceId: req.params.id,
        error: emailErr.message,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  res.json({ success: true, message: 'Invoice status updated' });
}));

// Delete invoice
router.delete('/invoices/:id', apiLimiter, asyncHandler(async (req, res) => {
  const docSnap = await db.collection('invoices').doc(req.params.id).get();
  if (!docSnap.exists) {
    throw new NotFoundError('Invoice');
  }

  // Reverse the original journal entry if one exists (existing logic preserved exactly)
  const journalSnap = await db.collection('journal_entries')
    .where('sourceId', '==', req.params.id)
    .where('source', '==', 'billing')
    .limit(1)
    .get();

  if (!journalSnap.empty) {
    await reverseJournalEntry(
      journalSnap.docs[0].id,
      `Invoice ${req.params.id} deleted`,
      req.user.uid,
    );
  }

  await db.collection('invoices').doc(req.params.id).delete();

  console.log(JSON.stringify({
    level: 'info',
    operation: 'invoice_deleted',
    invoiceId: req.params.id,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, message: 'Invoice deleted' });
}));

export { sendInvoiceEmail };
export default router;
