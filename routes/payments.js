import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, UnauthorizedError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';
import { v4 as uuidv4 } from 'uuid';
import { postJournalEntry } from '../utils/ledger.js';

const router = Router();

// ===== API KEY VALIDATION HELPER =====
async function validateApiKey(apiKey) {
  if (!apiKey) {
    throw new UnauthorizedError('API key required');
  }

  const keyDoc = await db.collection('api_keys').where('key', '==', apiKey).where('active', '==', true).get();
  if (keyDoc.empty) {
    throw new UnauthorizedError('Invalid API key');
  }

  return keyDoc.docs[0];
}

// ===== PUBLIC API — RECORD PAYMENT (API KEY AUTH) =====
router.post('/api/record', asyncHandler(async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const keyDoc = await validateApiKey(apiKey);

  const { amount, type, method, reference, description, invoiceId, metadata } = req.body;

  if (!amount || !type) {
    throw new ValidationError('Payment validation failed', ['amount and type are required']);
  }

  const payment = {
    paymentId: `PAY-${uuidv4().slice(0, 8).toUpperCase()}`,
    amount: parseFloat(amount),
    type: type || 'incoming',
    method: method || 'other',
    reference: reference || '',
    description: description || '',
    invoiceId: invoiceId || null,
    metadata: metadata || {},
    status: 'completed',
    source: 'api',
    apiKeyId: keyDoc.id,
    date: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  if (payment.amount <= 0) {
    throw new ValidationError('Payment validation failed', ['amount must be greater than 0']);
  }

  const docRef = await db.collection('payments').add(payment);

  // Create journal entry for API payment
  await postJournalEntry({
    date: payment.date,
    description: `API Payment ${payment.paymentId} — ${description || ''}`,
    reference: payment.paymentId,
    source: 'payments_api',
    sourceId: docRef.id,
    lines: type === 'incoming'
      ? [
        { account: 'Bank Account', debit: payment.amount, credit: 0 },
        { account: 'Accounts Receivable', debit: 0, credit: payment.amount }
      ]
      : [
        { account: 'Accounts Payable', debit: payment.amount, credit: 0 },
        { account: 'Bank Account', debit: 0, credit: payment.amount }
      ],
    createdBy: `api:${keyDoc.id}`
  });

  // Log API call
  await db.collection('api_logs').add({
    endpoint: '/api/payments/api/record',
    method: 'POST',
    apiKeyId: keyDoc.id,
    paymentId: docRef.id,
    status: 201,
    timestamp: new Date().toISOString()
  });

  // If linked to invoice, update invoice status
  if (invoiceId) {
    await db.collection('invoices').doc(invoiceId).update({
      status: 'paid',
      paidDate: new Date().toISOString()
    });
  }

  console.log(JSON.stringify({
    level: 'info',
    event: 'payment_recorded_via_api',
    paymentId: payment.paymentId,
    amount: payment.amount,
    type: payment.type,
    apiKeyId: keyDoc.id,
    timestamp: new Date().toISOString()
  }));

  res.status(201).json({ success: true, paymentId: payment.paymentId, id: docRef.id });
}));

// ===== PROTECTED ROUTES =====
router.use(verifyToken);

// ===== GET ALL PAYMENTS WITH PAGINATION AND FILTERING =====
router.get('/', asyncHandler(async (req, res) => {
  const { type, from, to, invoiceId, page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let query = db.collection('payments').orderBy('createdAt', 'desc');

  if (type) {
    query = query.where('type', '==', type);
  }

  const snapshot = await query.get();
  let payments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Apply additional filters
  if (from) {
    payments = payments.filter(p => p.date >= from);
  }
  if (to) {
    payments = payments.filter(p => p.date <= to);
  }
  if (invoiceId) {
    payments = payments.filter(p => p.invoiceId === invoiceId);
  }

  const total = payments.length;
  const paginatedPayments = payments.slice(offset, offset + limitNum);

  console.log(JSON.stringify({
    level: 'info',
    event: 'payments_fetched',
    userId: req.user.uid,
    filters: { type, from, to, invoiceId },
    page: pageNum,
    limit: limitNum,
    total,
    returned: paginatedPayments.length,
    timestamp: new Date().toISOString()
  }));

  res.json({
    payments: paginatedPayments,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum)
    }
  });
}));

// ===== RECORD PAYMENT (DASHBOARD) =====
router.post('/', validate('createPayment'), asyncHandler(async (req, res) => {
  const { amount, type, method, reference, description, invoiceId } = req.body;

  if (amount <= 0) {
    throw new ValidationError('Payment validation failed', ['amount must be greater than 0']);
  }

  const payment = {
    paymentId: `PAY-${uuidv4().slice(0, 8).toUpperCase()}`,
    amount: parseFloat(amount),
    type: type || 'incoming',
    method: method || 'bank_transfer',
    reference: reference || '',
    description: description || '',
    invoiceId: invoiceId || null,
    status: 'completed',
    source: 'dashboard',
    createdBy: req.user.uid,
    date: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  const docRef = await db.collection('payments').add(payment);

  // Create journal entry
  await postJournalEntry({
    date: payment.date,
    description: `Payment ${payment.paymentId} — ${description}`,
    reference: payment.paymentId,
    source: 'payments',
    sourceId: docRef.id,
    lines: type === 'incoming'
      ? [
        { account: 'Bank Account', debit: payment.amount, credit: 0 },
        { account: 'Accounts Receivable', debit: 0, credit: payment.amount }
      ]
      : [
        { account: 'Accounts Payable', debit: payment.amount, credit: 0 },
        { account: 'Bank Account', debit: 0, credit: payment.amount }
      ],
    createdBy: req.user.uid
  });

  if (invoiceId) {
    await db.collection('invoices').doc(invoiceId).update({
      status: 'paid',
      paidDate: payment.date
    });
  }

  console.log(JSON.stringify({
    level: 'info',
    event: 'payment_created',
    paymentId: payment.paymentId,
    amount: payment.amount,
    type: payment.type,
    userId: req.user.uid,
    timestamp: new Date().toISOString()
  }));

  res.status(201).json({ id: docRef.id, ...payment });
}));

// ===== GENERATE API KEY =====
router.post('/api-keys', validate({ name: 'optionalString' }), asyncHandler(async (req, res) => {
  const key = `ak_${uuidv4().replace(/-/g, '')}`;
  const apiKey = {
    key,
    name: req.body.name || 'Default',
    active: true,
    createdBy: req.user.uid,
    createdAt: new Date().toISOString()
  };

  const docRef = await db.collection('api_keys').add(apiKey);

  console.log(JSON.stringify({
    level: 'info',
    event: 'api_key_created',
    apiKeyId: docRef.id,
    userId: req.user.uid,
    keyName: apiKey.name,
    timestamp: new Date().toISOString()
  }));

  res.status(201).json({ id: docRef.id, ...apiKey });
}));

// ===== GET API KEYS =====
router.get('/api-keys', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('api_keys').orderBy('createdAt', 'desc').get();
  res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
}));

// ===== GET API LOGS WITH PAGINATION =====
router.get('/api-logs', asyncHandler(async (req, res) => {
  const { page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const snapshot = await db.collection('api_logs').orderBy('timestamp', 'desc').get();
  let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const total = logs.length;
  const paginatedLogs = logs.slice(offset, offset + limitNum);

  res.json({
    logs: paginatedLogs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum)
    }
  });
}));

export default router;
