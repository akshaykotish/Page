import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const router = Router();
router.use(verifyToken);

// Helper: ensure the user is a client (or requesting their own data)
function requireClientOrSelf(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  // Allow clients and also admins viewing client data
  next();
}

function fmtCurrency(v) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v || 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

router.get('/dashboard', asyncHandler(async (req, res) => {
  const userId = req.user.uid;
  const userEmail = (req.user.email || '').toLowerCase();
  const userPhone = (req.user.phone || '').replace(/\s+/g, '');

  // Get invoices for this client
  const invoicesSnap = await db.collection('invoices').orderBy('createdAt', 'desc').get();
  const myInvoices = invoicesSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(inv => matchesClient(inv, userEmail, userPhone, userId));

  const totalBills = myInvoices.length;
  const unpaid = myInvoices.filter(inv => (inv.status || '').toLowerCase() !== 'paid');
  const paid = myInvoices.filter(inv => (inv.status || '').toLowerCase() === 'paid');
  const totalOutstanding = unpaid.reduce((s, inv) => s + (inv.total || inv.grandTotal || inv.amount || 0), 0);
  const totalPaid = paid.reduce((s, inv) => s + (inv.total || inv.grandTotal || inv.amount || 0), 0);

  // Get recent payments
  const paymentsSnap = await db.collection('razorpay_payments')
    .where('status', '==', 'paid')
    .orderBy('paidAt', 'desc')
    .limit(5)
    .get();
  const recentPayments = paymentsSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => {
      const invId = p.invoiceId;
      if (!invId) return false;
      return myInvoices.some(inv => inv.id === invId);
    });

  // Active projects
  const projectsSnap = await db.collection('projects')
    .where('status', 'in', ['active', 'in_progress'])
    .get();
  const myProjects = projectsSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => matchesClientProject(p, userEmail, userPhone, userId));

  // Unread messages
  const messagesSnap = await db.collection('client_messages')
    .where('clientId', '==', userId)
    .where('readByClient', '==', false)
    .get();
  const unreadMessages = messagesSnap.size;

  // Shared documents count
  const sharesSnap = await db.collection('client_shares')
    .where('clientId', '==', userId)
    .get();

  res.json({
    summary: {
      totalBills,
      unpaidBills: unpaid.length,
      totalOutstanding,
      totalPaid,
      activeProjects: myProjects.length,
      unreadMessages,
      sharedDocuments: sharesSnap.size,
    },
    recentInvoices: myInvoices.slice(0, 5).map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber || inv.number,
      date: inv.date || inv.invoiceDate || inv.createdAt,
      total: inv.total || inv.grandTotal || inv.amount || 0,
      status: inv.status || 'draft',
    })),
    recentPayments: recentPayments.map(p => ({
      id: p.id,
      amount: p.amount,
      paidAt: p.paidAt,
      invoiceId: p.invoiceId,
      method: p.method || 'razorpay',
    })),
    activeProjects: myProjects.slice(0, 3).map(p => ({
      id: p.id,
      name: p.name || p.title,
      status: p.status,
      progress: p.progress || 0,
    })),
  });
}));

// ═══════════════════════════════════════════════════════════════════════════
// BILLS / INVOICES
// ═══════════════════════════════════════════════════════════════════════════

router.get('/bills', asyncHandler(async (req, res) => {
  const userId = req.user.uid;
  const userEmail = (req.user.email || '').toLowerCase();
  const userPhone = (req.user.phone || '').replace(/\s+/g, '');

  const snapshot = await db.collection('invoices').orderBy('createdAt', 'desc').get();
  const invoices = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(inv => matchesClient(inv, userEmail, userPhone, userId));

  res.json({
    bills: invoices.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber || inv.number,
      date: inv.date || inv.invoiceDate || inv.createdAt,
      dueDate: inv.dueDate,
      subtotal: inv.subtotal || 0,
      tax: (inv.cgst || 0) + (inv.sgst || 0) + (inv.igst || 0) + (inv.totalTax || 0),
      total: inv.total || inv.grandTotal || inv.amount || 0,
      status: inv.status || 'draft',
      items: (inv.items || []).map(it => ({
        description: it.description || it.name,
        qty: it.qty || it.quantity || 1,
        rate: it.rate || it.price || 0,
        amount: (it.qty || 1) * (it.rate || it.price || 0),
      })),
      customer: inv.customer || {},
      paidDate: inv.paidDate,
    })),
  });
}));

router.get('/bills/:id', asyncHandler(async (req, res) => {
  const invoiceDoc = await db.collection('invoices').doc(req.params.id).get();
  if (!invoiceDoc.exists) throw new NotFoundError('Invoice');

  const inv = { id: invoiceDoc.id, ...invoiceDoc.data() };
  const userEmail = (req.user.email || '').toLowerCase();
  const userPhone = (req.user.phone || '').replace(/\s+/g, '');

  if (!matchesClient(inv, userEmail, userPhone, req.user.uid)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Get payment history for this invoice
  const paymentsSnap = await db.collection('razorpay_payments')
    .where('invoiceId', '==', req.params.id)
    .orderBy('createdAt', 'desc')
    .get();
  const payments = paymentsSnap.docs.map(doc => ({
    id: doc.id,
    amount: doc.data().amount,
    status: doc.data().status,
    method: doc.data().method || 'razorpay',
    paidAt: doc.data().paidAt,
    createdAt: doc.data().createdAt,
  }));

  res.json({
    invoice: {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber || inv.number,
      date: inv.date || inv.invoiceDate || inv.createdAt,
      dueDate: inv.dueDate,
      subtotal: inv.subtotal || 0,
      cgst: inv.cgst || 0,
      sgst: inv.sgst || 0,
      igst: inv.igst || 0,
      totalTax: inv.totalTax || 0,
      total: inv.total || inv.grandTotal || inv.amount || 0,
      status: inv.status || 'draft',
      items: inv.items || [],
      customer: inv.customer || {},
      notes: inv.notes || '',
      terms: inv.terms || '',
      paidDate: inv.paidDate,
    },
    payments,
  });
}));

// Pay bill via Razorpay payment link
router.post('/bills/:id/pay', asyncHandler(async (req, res) => {
  const invoiceDoc = await db.collection('invoices').doc(req.params.id).get();
  if (!invoiceDoc.exists) throw new NotFoundError('Invoice');

  const inv = { id: invoiceDoc.id, ...invoiceDoc.data() };
  const userEmail = (req.user.email || '').toLowerCase();
  const userPhone = (req.user.phone || '').replace(/\s+/g, '');

  if (!matchesClient(inv, userEmail, userPhone, req.user.uid)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if ((inv.status || '').toLowerCase() === 'paid') {
    return res.status(400).json({ error: 'Invoice is already paid' });
  }

  const amount = inv.total || inv.grandTotal || inv.amount || 0;
  if (amount <= 0) throw new ValidationError('Invalid invoice amount');

  // Create Razorpay payment link via the internal API
  const Razorpay = (await import('razorpay')).default;
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  const paymentLink = await razorpay.paymentLink.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    description: `Payment for Invoice ${inv.invoiceNumber || inv.number || ''}`.trim(),
    customer: {
      name: req.user.name || inv.customer?.name || '',
      email: req.user.email || inv.customer?.email || '',
      contact: req.user.phone || inv.customer?.phone || '',
    },
    notify: { sms: true, email: true },
    reminder_enable: true,
    notes: {
      invoice_id: inv.id,
      invoice_number: inv.invoiceNumber || '',
      source: 'client_portal',
    },
    callback_url: '',
    callback_method: '',
  });

  // Record payment attempt
  await db.collection('razorpay_payments').add({
    razorpayPaymentLinkId: paymentLink.id,
    amount,
    currency: 'INR',
    status: 'created',
    description: `Invoice ${inv.invoiceNumber || ''}`,
    invoiceId: inv.id,
    clientId: req.user.uid,
    source: 'client_portal',
    createdAt: new Date().toISOString(),
  });

  res.json({
    paymentLink: paymentLink.short_url,
    paymentLinkId: paymentLink.id,
    amount,
  });
}));

// Download invoice (returns invoice data for PDF generation client-side)
router.get('/bills/:id/download', asyncHandler(async (req, res) => {
  const invoiceDoc = await db.collection('invoices').doc(req.params.id).get();
  if (!invoiceDoc.exists) throw new NotFoundError('Invoice');

  const inv = { id: invoiceDoc.id, ...invoiceDoc.data() };
  const userEmail = (req.user.email || '').toLowerCase();
  const userPhone = (req.user.phone || '').replace(/\s+/g, '');

  if (!matchesClient(inv, userEmail, userPhone, req.user.uid)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({ invoice: inv });
}));

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTS / DOWNLOADS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/documents', asyncHandler(async (req, res) => {
  const userId = req.user.uid;

  // Client shares (documents shared by admin)
  const sharesSnap = await db.collection('client_shares')
    .where('clientId', '==', userId)
    .orderBy('sharedAt', 'desc')
    .get();
  const shares = sharesSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    source: 'shared',
  }));

  // Also fetch shared documents from documents collection
  const docsSnap = await db.collection('documents')
    .where('sharedWith', 'array-contains', userId)
    .get();
  const sharedDocs = docsSnap.docs.map(doc => ({
    id: doc.id,
    title: doc.data().title || doc.data().name,
    type: doc.data().type || 'document',
    data: doc.data().url || doc.data().fileUrl || '',
    sharedAt: doc.data().sharedAt || doc.data().createdAt,
    source: 'document',
    category: doc.data().category || 'general',
  }));

  // Paid invoice receipts
  const userEmail = (req.user.email || '').toLowerCase();
  const userPhone = (req.user.phone || '').replace(/\s+/g, '');
  const invoicesSnap = await db.collection('invoices')
    .where('status', '==', 'paid')
    .orderBy('paidDate', 'desc')
    .get();
  const receipts = invoicesSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(inv => matchesClient(inv, userEmail, userPhone, userId))
    .map(inv => ({
      id: inv.id,
      title: `Receipt - ${inv.invoiceNumber || inv.number || 'Invoice'}`,
      type: 'receipt',
      invoiceNumber: inv.invoiceNumber || inv.number,
      total: inv.total || inv.grandTotal || inv.amount || 0,
      paidDate: inv.paidDate,
      source: 'receipt',
    }));

  res.json({
    documents: [...shares, ...sharedDocs],
    receipts,
  });
}));

router.get('/documents/:id/download', asyncHandler(async (req, res) => {
  // Check in client_shares first
  const shareDoc = await db.collection('client_shares').doc(req.params.id).get();
  if (shareDoc.exists) {
    const data = shareDoc.data();
    if (data.clientId !== req.user.uid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return res.json({ document: { id: shareDoc.id, ...data } });
  }

  // Check in documents collection
  const docDoc = await db.collection('documents').doc(req.params.id).get();
  if (docDoc.exists) {
    const data = docDoc.data();
    if (!(data.sharedWith || []).includes(req.user.uid)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return res.json({ document: { id: docDoc.id, ...data } });
  }

  throw new NotFoundError('Document');
}));

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

router.get('/messages', asyncHandler(async (req, res) => {
  const userId = req.user.uid;

  const snapshot = await db.collection('client_messages')
    .where('clientId', '==', userId)
    .orderBy('createdAt', 'desc')
    .get();

  const messages = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  // Group by threadId
  const threads = {};
  messages.forEach(msg => {
    const threadId = msg.threadId || msg.id;
    if (!threads[threadId]) {
      threads[threadId] = {
        threadId,
        subject: msg.subject || 'No Subject',
        messages: [],
        lastMessage: null,
        unread: 0,
      };
    }
    threads[threadId].messages.push(msg);
    if (!msg.readByClient) threads[threadId].unread++;
    if (!threads[threadId].lastMessage || new Date(msg.createdAt) > new Date(threads[threadId].lastMessage.createdAt)) {
      threads[threadId].lastMessage = msg;
    }
  });

  res.json({
    threads: Object.values(threads).sort((a, b) =>
      new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0)
    ),
    totalUnread: messages.filter(m => !m.readByClient).length,
  });
}));

router.post('/messages', asyncHandler(async (req, res) => {
  const { subject, body, threadId, attachments } = req.body;

  if (!body || typeof body !== 'string' || !body.trim()) {
    throw new ValidationError('Message body is required');
  }

  const message = {
    clientId: req.user.uid,
    clientName: req.user.name || 'Client',
    clientEmail: req.user.email || '',
    subject: subject || 'No Subject',
    body: body.trim(),
    threadId: threadId || null, // null = new thread
    attachments: attachments || [],
    sender: 'client',
    readByClient: true,
    readByAdmin: false,
    createdAt: new Date().toISOString(),
  };

  const docRef = await db.collection('client_messages').add(message);

  // If no threadId, set it to the doc id (new thread)
  if (!threadId) {
    await docRef.update({ threadId: docRef.id });
    message.threadId = docRef.id;
  }

  res.status(201).json({ id: docRef.id, ...message });
}));

// Mark messages as read
router.put('/messages/:threadId/read', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('client_messages')
    .where('clientId', '==', req.user.uid)
    .where('threadId', '==', req.params.threadId)
    .where('readByClient', '==', false)
    .get();

  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, { readByClient: true });
  });
  await batch.commit();

  res.json({ success: true, marked: snapshot.size });
}));

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/projects', asyncHandler(async (req, res) => {
  const userId = req.user.uid;
  const userEmail = (req.user.email || '').toLowerCase();
  const userPhone = (req.user.phone || '').replace(/\s+/g, '');

  const snapshot = await db.collection('projects').orderBy('createdAt', 'desc').get();
  const projects = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => matchesClientProject(p, userEmail, userPhone, userId));

  res.json({
    projects: projects.map(p => ({
      id: p.id,
      name: p.name || p.title,
      description: p.description || '',
      status: p.status || 'active',
      progress: p.progress || 0,
      startDate: p.startDate,
      endDate: p.endDate || p.dueDate,
      milestones: (p.milestones || []).map(m => ({
        title: m.title || m.name,
        status: m.status || 'pending',
        dueDate: m.dueDate,
        completedDate: m.completedDate,
      })),
      deliverables: (p.deliverables || []).map(d => ({
        title: d.title || d.name,
        status: d.status || 'pending',
        description: d.description || '',
      })),
      team: (p.team || []).map(t => ({
        name: t.name,
        role: t.role,
      })),
      createdAt: p.createdAt,
    })),
  });
}));

router.get('/projects/:id', asyncHandler(async (req, res) => {
  const projectDoc = await db.collection('projects').doc(req.params.id).get();
  if (!projectDoc.exists) throw new NotFoundError('Project');

  const p = { id: projectDoc.id, ...projectDoc.data() };
  const userEmail = (req.user.email || '').toLowerCase();
  const userPhone = (req.user.phone || '').replace(/\s+/g, '');

  if (!matchesClientProject(p, userEmail, userPhone, req.user.uid)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({ project: p });
}));

// ═══════════════════════════════════════════════════════════════════════════
// RECEIPTS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/receipts', asyncHandler(async (req, res) => {
  const userId = req.user.uid;
  const userEmail = (req.user.email || '').toLowerCase();
  const userPhone = (req.user.phone || '').replace(/\s+/g, '');

  const snapshot = await db.collection('invoices')
    .where('status', '==', 'paid')
    .orderBy('paidDate', 'desc')
    .get();

  const receipts = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(inv => matchesClient(inv, userEmail, userPhone, userId))
    .map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber || inv.number,
      total: inv.total || inv.grandTotal || inv.amount || 0,
      paidDate: inv.paidDate,
      customer: inv.customer,
    }));

  res.json({ receipts });
}));

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════

router.get('/profile', asyncHandler(async (req, res) => {
  const userDoc = await db.collection('users').doc(req.user.uid).get();
  if (!userDoc.exists) throw new NotFoundError('User');

  const data = userDoc.data();
  res.json({
    id: userDoc.id,
    name: data.name,
    email: data.email,
    phone: data.phone,
    company: data.company || '',
    address: data.address || '',
    gstin: data.gstin || '',
    pan: data.pan || '',
    createdAt: data.createdAt,
  });
}));

router.put('/profile', asyncHandler(async (req, res) => {
  const { name, company, address, gstin, pan } = req.body;
  const update = { updatedAt: new Date().toISOString() };

  if (name && typeof name === 'string') update.name = name.trim();
  if (company !== undefined) update.company = (company || '').trim();
  if (address !== undefined) update.address = (address || '').trim();
  if (gstin !== undefined) update.gstin = (gstin || '').trim();
  if (pan !== undefined) update.pan = (pan || '').trim();

  await db.collection('users').doc(req.user.uid).update(update);

  res.json({ success: true, message: 'Profile updated' });
}));

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function matchesClient(inv, userEmail, userPhone, userId) {
  // Match by clientId
  if (inv.clientId === userId) return true;

  const custEmail = (inv.customerEmail || inv.clientEmail || inv.customer?.email || '').toLowerCase();
  const custPhone = (inv.customerPhone || inv.clientPhone || inv.customer?.phone || '').replace(/\s+/g, '');

  if (userEmail && custEmail && custEmail === userEmail) return true;
  if (userPhone && custPhone && userPhone.length >= 10 && custPhone.includes(userPhone.slice(-10))) return true;

  return false;
}

function matchesClientProject(p, userEmail, userPhone, userId) {
  if (p.clientId === userId) return true;
  if (p.client?.id === userId) return true;

  const clientEmail = (p.clientEmail || p.client?.email || '').toLowerCase();
  const clientPhone = (p.clientPhone || p.client?.phone || '').replace(/\s+/g, '');

  if (userEmail && clientEmail && clientEmail === userEmail) return true;
  if (userPhone && clientPhone && userPhone.length >= 10 && clientPhone.includes(userPhone.slice(-10))) return true;

  // Check if user is in project members
  if (Array.isArray(p.members)) {
    if (p.members.some(m => m.id === userId || (m.email || '').toLowerCase() === userEmail)) return true;
  }

  return false;
}

export default router;
