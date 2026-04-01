import { Router } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, UnauthorizedError, NotFoundError, ValidationError, ForbiddenError } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import { postJournalEntry } from '../utils/ledger.js';

const router = Router();

// ─── Razorpay SDK (single account for all apps) ─────────────────────────────

let _razorpay;
function getRazorpay() {
  if (!_razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay credentials not configured');
    }
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
}

// ─── Cashfree Config ─────────────────────────────────────────────────────────

function getCashfreeConfig() {
  const env = process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox';
  return {
    appId: process.env.CASHFREE_APP_ID,
    secretKey: process.env.CASHFREE_SECRET_KEY,
    baseUrl: env === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg',
    apiVersion: '2023-08-01',
  };
}

async function cashfreeRequest(path, method, body = null) {
  const cfg = getCashfreeConfig();
  if (!cfg.appId || !cfg.secretKey) {
    throw new Error('Cashfree credentials not configured');
  }
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': cfg.appId,
      'x-client-secret': cfg.secretKey,
      'x-api-version': cfg.apiVersion,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${cfg.baseUrl}${path}`, opts);
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message || data?.error || `Cashfree error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.cfResponse = data;
    throw err;
  }
  return data;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateApiKey(mode = 'live') {
  return (mode === 'test' ? 'ak_test_' : 'ak_live_') + crypto.randomBytes(24).toString('hex');
}

function generateSecretKey(mode = 'live') {
  return (mode === 'test' ? 'sk_test_' : 'sk_live_') + crypto.randomBytes(32).toString('hex');
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function isIpAllowed(clientIp, whitelistedIPs) {
  if (!whitelistedIPs || whitelistedIPs.length === 0) return true;
  const normalized = clientIp.replace(/^::ffff:/, '');
  return whitelistedIPs.includes(normalized) || whitelistedIPs.includes('0.0.0.0');
}

// ─── Authenticate incoming app request ───────────────────────────────────────

async function authenticateApiRequest(req) {
  let apiKey, apiSecret;

  // Basic Auth (Razorpay-style)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const colonIdx = decoded.indexOf(':');
    if (colonIdx > -1) {
      apiKey = decoded.slice(0, colonIdx);
      apiSecret = decoded.slice(colonIdx + 1);
    }
  }

  // Header-based
  if (!apiKey) {
    apiKey = req.headers['x-api-key'];
    apiSecret = req.headers['x-api-secret'];
  }

  // Cashfree-style
  if (!apiKey) {
    apiKey = req.headers['x-client-id'];
    apiSecret = req.headers['x-client-secret'];
  }

  if (!apiKey || !apiSecret) {
    throw new UnauthorizedError('API key and secret required');
  }

  const secretHash = hashSecret(apiSecret);
  const keySnap = await db.collection('gateway_api_keys')
    .where('apiKey', '==', apiKey)
    .where('active', '==', true)
    .limit(1)
    .get();

  if (keySnap.empty) throw new UnauthorizedError('Invalid API key');

  const keyDoc = keySnap.docs[0];
  const keyData = keyDoc.data();

  if (keyData.secretHash !== secretHash) throw new UnauthorizedError('Invalid API secret');

  const clientIp = req.ip || req.connection?.remoteAddress || '';
  if (!isIpAllowed(clientIp, keyData.whitelistedIPs)) {
    throw new ForbiddenError(`IP ${clientIp.replace(/^::ffff:/, '')} not whitelisted`);
  }

  // Update usage stats (fire-and-forget)
  keyDoc.ref.update({
    requestCount: (keyData.requestCount || 0) + 1,
    lastUsed: new Date().toISOString(),
  }).catch(() => {});

  return { keyDoc, keyData, clientIp, appName: keyData.name };
}

// ─── Log + Accounting helpers ────────────────────────────────────────────────

async function logApiCall(data) {
  await db.collection('gateway_api_logs').add({
    ...data,
    timestamp: new Date().toISOString(),
  });
}

async function recordTransaction(txn) {
  const docRef = await db.collection('gateway_transactions').add({
    ...txn,
    createdAt: new Date().toISOString(),
  });
  return docRef.id;
}

async function createAccountingEntry(txn) {
  try {
    const amountInRupees = txn.platform === 'razorpay'
      ? txn.amount / 100  // Razorpay uses paise
      : txn.amount;       // Cashfree uses rupees

    await postJournalEntry({
      date: new Date().toISOString(),
      description: `${txn.platform.toUpperCase()} ${txn.type} via ${txn.appName} — ${txn.description || txn.orderId || ''}`,
      reference: txn.orderId || txn.linkId || txn.transactionId,
      source: 'gateway',
      sourceId: txn.transactionId,
      lines: [
        { account: 'Gateway Receivable', debit: amountInRupees, credit: 0 },
        { account: 'Accounts Receivable', debit: 0, credit: amountInRupees },
      ],
      createdBy: `gateway:${txn.apiKeyId}`,
    });
  } catch (err) {
    console.error('Gateway accounting entry failed:', err.message);
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// PROXY ENDPOINTS — App sends Razorpay-format payload, we forward to Razorpay
// ═════════════════════════════════════════════════════════════════════════════

// ─── POST /v1/razorpay/orders ────────────────────────────────────────────────
// App sends exact Razorpay payload → we create real Razorpay order
router.post('/v1/razorpay/orders', asyncHandler(async (req, res) => {
  const { keyDoc, keyData, clientIp, appName } = await authenticateApiRequest(req);
  const { amount, currency, receipt, notes, partial_payment } = req.body;

  if (!amount || typeof amount !== 'number' || amount < 100) {
    throw new ValidationError('amount is required and must be >= 100 (in paise)');
  }

  // Forward to real Razorpay
  const rzpOrder = await getRazorpay().orders.create({
    amount,
    currency: currency || 'INR',
    receipt: receipt || `gw_${uuidv4().slice(0, 8)}`,
    notes: {
      ...(notes || {}),
      _gateway_app: appName,
      _gateway_key_id: keyDoc.id,
    },
    partial_payment: partial_payment || false,
  });

  // Record in our DB for tracking
  const txnId = await recordTransaction({
    platform: 'razorpay',
    type: 'order',
    orderId: rzpOrder.id,
    amount,
    currency: currency || 'INR',
    status: rzpOrder.status,
    appName,
    apiKeyId: keyDoc.id,
    clientIp,
    receipt: receipt || null,
    notes: notes || {},
    razorpayResponse: rzpOrder,
  });

  // Accounting entry
  await createAccountingEntry({
    platform: 'razorpay',
    type: 'order',
    orderId: rzpOrder.id,
    amount,
    appName,
    apiKeyId: keyDoc.id,
    transactionId: txnId,
  });

  // Log
  await logApiCall({
    endpoint: '/v1/razorpay/orders',
    method: 'POST',
    apiKeyId: keyDoc.id,
    appName,
    platform: 'razorpay',
    status: 200,
    orderId: rzpOrder.id,
    amount,
    clientIp,
  });

  // Return exact Razorpay response to the app
  res.json(rzpOrder);
}));

// ─── POST /v1/razorpay/payment_links ────────────────────────────────────────
router.post('/v1/razorpay/payment_links', asyncHandler(async (req, res) => {
  const { keyDoc, keyData, clientIp, appName } = await authenticateApiRequest(req);
  const {
    amount, currency, accept_partial, first_min_partial_amount,
    description, customer, notify, reminder_enable,
    notes, callback_url, callback_method, expire_by,
  } = req.body;

  if (!amount || typeof amount !== 'number' || amount < 100) {
    throw new ValidationError('amount is required and must be >= 100 (in paise)');
  }

  // Forward to real Razorpay
  const rzpLink = await getRazorpay().paymentLink.create({
    amount,
    currency: currency || 'INR',
    accept_partial: accept_partial || false,
    first_min_partial_amount: first_min_partial_amount || 0,
    description: description || '',
    customer: customer || {},
    notify: notify || { sms: false, email: false },
    reminder_enable: reminder_enable !== undefined ? reminder_enable : true,
    notes: {
      ...(notes || {}),
      _gateway_app: appName,
      _gateway_key_id: keyDoc.id,
    },
    callback_url: callback_url || '',
    callback_method: callback_method || 'get',
    ...(expire_by ? { expire_by } : {}),
  });

  const txnId = await recordTransaction({
    platform: 'razorpay',
    type: 'payment_link',
    linkId: rzpLink.id,
    shortUrl: rzpLink.short_url,
    amount,
    currency: currency || 'INR',
    status: rzpLink.status,
    description: description || '',
    appName,
    apiKeyId: keyDoc.id,
    clientIp,
    razorpayResponse: rzpLink,
  });

  await createAccountingEntry({
    platform: 'razorpay',
    type: 'payment_link',
    linkId: rzpLink.id,
    amount,
    description,
    appName,
    apiKeyId: keyDoc.id,
    transactionId: txnId,
  });

  await logApiCall({
    endpoint: '/v1/razorpay/payment_links',
    method: 'POST',
    apiKeyId: keyDoc.id,
    appName,
    platform: 'razorpay',
    status: 200,
    linkId: rzpLink.id,
    amount,
    clientIp,
  });

  res.json(rzpLink);
}));

// ─── GET /v1/razorpay/orders/:orderId ────────────────────────────────────────
router.get('/v1/razorpay/orders/:orderId', asyncHandler(async (req, res) => {
  const { keyDoc, appName } = await authenticateApiRequest(req);

  const rzpOrder = await getRazorpay().orders.fetch(req.params.orderId);

  // Update local record status
  const snap = await db.collection('gateway_transactions')
    .where('orderId', '==', req.params.orderId)
    .where('apiKeyId', '==', keyDoc.id)
    .limit(1).get();
  if (!snap.empty && snap.docs[0].data().status !== rzpOrder.status) {
    snap.docs[0].ref.update({ status: rzpOrder.status, updatedAt: new Date().toISOString() });
  }

  await logApiCall({
    endpoint: `/v1/razorpay/orders/${req.params.orderId}`,
    method: 'GET',
    apiKeyId: keyDoc.id,
    appName,
    platform: 'razorpay',
    status: 200,
  });

  res.json(rzpOrder);
}));

// ─── POST /v1/razorpay/payments/:paymentId/capture ──────────────────────────
router.post('/v1/razorpay/payments/:paymentId/capture', asyncHandler(async (req, res) => {
  const { keyDoc, appName } = await authenticateApiRequest(req);
  const { amount, currency } = req.body;

  if (!amount) throw new ValidationError('amount is required');

  const captured = await getRazorpay().payments.capture(req.params.paymentId, amount, currency || 'INR');

  await logApiCall({
    endpoint: `/v1/razorpay/payments/${req.params.paymentId}/capture`,
    method: 'POST',
    apiKeyId: keyDoc.id,
    appName,
    platform: 'razorpay',
    status: 200,
    amount,
  });

  res.json(captured);
}));

// ─── GET /v1/razorpay/payments/:paymentId ───────────────────────────────────
router.get('/v1/razorpay/payments/:paymentId', asyncHandler(async (req, res) => {
  const { keyDoc, appName } = await authenticateApiRequest(req);

  const payment = await getRazorpay().payments.fetch(req.params.paymentId);

  await logApiCall({
    endpoint: `/v1/razorpay/payments/${req.params.paymentId}`,
    method: 'GET',
    apiKeyId: keyDoc.id,
    appName,
    platform: 'razorpay',
    status: 200,
  });

  res.json(payment);
}));

// ─── POST /v1/razorpay/refunds ──────────────────────────────────────────────
router.post('/v1/razorpay/payments/:paymentId/refund', asyncHandler(async (req, res) => {
  const { keyDoc, appName } = await authenticateApiRequest(req);
  const { amount, speed, notes } = req.body;

  const refund = await getRazorpay().payments.refund(req.params.paymentId, {
    amount,
    speed: speed || 'normal',
    notes: { ...(notes || {}), _gateway_app: appName },
  });

  await recordTransaction({
    platform: 'razorpay',
    type: 'refund',
    refundId: refund.id,
    paymentId: req.params.paymentId,
    amount: amount || refund.amount,
    status: refund.status,
    appName,
    apiKeyId: keyDoc.id,
  });

  await logApiCall({
    endpoint: `/v1/razorpay/payments/${req.params.paymentId}/refund`,
    method: 'POST',
    apiKeyId: keyDoc.id,
    appName,
    platform: 'razorpay',
    status: 200,
    refundId: refund.id,
  });

  res.json(refund);
}));


// ═════════════════════════════════════════════════════════════════════════════
// PROXY ENDPOINTS — App sends Cashfree-format payload, we forward to Cashfree
// ═════════════════════════════════════════════════════════════════════════════

// ─── POST /v1/cashfree/orders ────────────────────────────────────────────────
router.post('/v1/cashfree/orders', asyncHandler(async (req, res) => {
  const { keyDoc, keyData, clientIp, appName } = await authenticateApiRequest(req);
  const {
    order_id, order_amount, order_currency, customer_details,
    order_meta, order_expiry_time, order_note, order_tags,
  } = req.body;

  if (!order_amount || order_amount <= 0) {
    throw new ValidationError('order_amount is required and must be > 0');
  }
  if (!customer_details?.customer_id || !customer_details?.customer_phone) {
    throw new ValidationError('customer_details.customer_id and customer_details.customer_phone are required');
  }

  // Forward to real Cashfree
  const cfOrder = await cashfreeRequest('/orders', 'POST', {
    order_id: order_id || `gw_${uuidv4().slice(0, 12)}`,
    order_amount,
    order_currency: order_currency || 'INR',
    customer_details,
    order_meta: order_meta || {},
    order_expiry_time: order_expiry_time || undefined,
    order_note: order_note || undefined,
    order_tags: {
      ...(order_tags || {}),
      _gateway_app: appName,
    },
  });

  const txnId = await recordTransaction({
    platform: 'cashfree',
    type: 'order',
    orderId: cfOrder.order_id,
    cfOrderId: cfOrder.cf_order_id,
    amount: order_amount,
    currency: order_currency || 'INR',
    status: cfOrder.order_status,
    appName,
    apiKeyId: keyDoc.id,
    clientIp,
    paymentSessionId: cfOrder.payment_session_id,
    cashfreeResponse: cfOrder,
  });

  await createAccountingEntry({
    platform: 'cashfree',
    type: 'order',
    orderId: cfOrder.order_id,
    amount: order_amount,
    appName,
    apiKeyId: keyDoc.id,
    transactionId: txnId,
  });

  await logApiCall({
    endpoint: '/v1/cashfree/orders',
    method: 'POST',
    apiKeyId: keyDoc.id,
    appName,
    platform: 'cashfree',
    status: 200,
    orderId: cfOrder.order_id,
    amount: order_amount,
    clientIp,
  });

  res.json(cfOrder);
}));

// ─── GET /v1/cashfree/orders/:orderId ────────────────────────────────────────
router.get('/v1/cashfree/orders/:orderId', asyncHandler(async (req, res) => {
  const { keyDoc, appName } = await authenticateApiRequest(req);

  const cfOrder = await cashfreeRequest(`/orders/${req.params.orderId}`, 'GET');

  // Sync status
  const snap = await db.collection('gateway_transactions')
    .where('orderId', '==', req.params.orderId)
    .where('platform', '==', 'cashfree')
    .limit(1).get();
  if (!snap.empty && snap.docs[0].data().status !== cfOrder.order_status) {
    snap.docs[0].ref.update({ status: cfOrder.order_status, updatedAt: new Date().toISOString() });
  }

  await logApiCall({
    endpoint: `/v1/cashfree/orders/${req.params.orderId}`,
    method: 'GET',
    apiKeyId: keyDoc.id,
    appName,
    platform: 'cashfree',
    status: 200,
  });

  res.json(cfOrder);
}));

// ─── POST /v1/cashfree/links ────────────────────────────────────────────────
router.post('/v1/cashfree/links', asyncHandler(async (req, res) => {
  const { keyDoc, keyData, clientIp, appName } = await authenticateApiRequest(req);
  const {
    link_id, link_amount, link_currency, link_purpose,
    customer_details, link_partial_payments, link_minimum_partial_amount,
    link_expiry_time, link_notify, link_auto_reminders, link_notes, link_meta,
  } = req.body;

  if (!link_amount || link_amount <= 0) throw new ValidationError('link_amount required');
  if (!link_id) throw new ValidationError('link_id required');

  const cfLink = await cashfreeRequest('/links', 'POST', {
    link_id,
    link_amount,
    link_currency: link_currency || 'INR',
    link_purpose: link_purpose || '',
    customer_details: customer_details || {},
    link_partial_payments: link_partial_payments || false,
    link_minimum_partial_amount: link_minimum_partial_amount || null,
    link_expiry_time: link_expiry_time || undefined,
    link_notify: link_notify || { send_sms: false, send_email: false },
    link_auto_reminders: link_auto_reminders || false,
    link_notes: { ...(link_notes || {}), _gateway_app: appName },
    link_meta: link_meta || {},
  });

  const txnId = await recordTransaction({
    platform: 'cashfree',
    type: 'payment_link',
    linkId: cfLink.link_id || link_id,
    linkUrl: cfLink.link_url,
    amount: link_amount,
    currency: link_currency || 'INR',
    status: cfLink.link_status,
    appName,
    apiKeyId: keyDoc.id,
    clientIp,
    cashfreeResponse: cfLink,
  });

  await createAccountingEntry({
    platform: 'cashfree',
    type: 'payment_link',
    linkId: link_id,
    amount: link_amount,
    appName,
    apiKeyId: keyDoc.id,
    transactionId: txnId,
  });

  await logApiCall({
    endpoint: '/v1/cashfree/links',
    method: 'POST',
    apiKeyId: keyDoc.id,
    appName,
    platform: 'cashfree',
    status: 200,
    linkId: link_id,
    amount: link_amount,
    clientIp,
  });

  res.json(cfLink);
}));


// ═════════════════════════════════════════════════════════════════════════════
// WEBHOOK — Razorpay sends payment status updates here
// ═════════════════════════════════════════════════════════════════════════════

router.post('/webhooks/razorpay', asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret || !signature) {
    return res.status(400).json({ error: 'Webhook secret/signature missing' });
  }

  const expected = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(req.body)).digest('hex');
  if (signature !== expected) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const { event, payload } = req.body;
  const payment = payload?.payment?.entity;

  if (payment && (event === 'payment.captured' || event === 'payment.authorized')) {
    // Find matching gateway transaction by order_id
    const orderId = payment.order_id;
    if (orderId) {
      const snap = await db.collection('gateway_transactions')
        .where('orderId', '==', orderId)
        .where('platform', '==', 'razorpay')
        .limit(1).get();

      if (!snap.empty) {
        const txn = snap.docs[0];
        const txnData = txn.data();

        await txn.ref.update({
          status: event === 'payment.captured' ? 'paid' : 'authorized',
          paymentId: payment.id,
          paymentMethod: payment.method,
          paymentEmail: payment.email,
          paymentContact: payment.contact,
          paidAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Accounting: mark as received
        const amountRupees = payment.amount / 100;
        try {
          await postJournalEntry({
            date: new Date().toISOString(),
            description: `Payment received via ${txnData.appName} — ${payment.method} — ${payment.id}`,
            reference: payment.id,
            source: 'gateway_webhook',
            sourceId: txn.id,
            lines: [
              { account: 'Bank Account', debit: amountRupees, credit: 0 },
              { account: 'Gateway Receivable', debit: 0, credit: amountRupees },
            ],
            createdBy: `gateway:webhook`,
          });
        } catch (err) {
          console.error('Webhook accounting error:', err.message);
        }

        console.log(JSON.stringify({
          level: 'info',
          event: 'gateway_payment_received',
          orderId,
          paymentId: payment.id,
          appName: txnData.appName,
          amount: amountRupees,
          method: payment.method,
          timestamp: new Date().toISOString(),
        }));
      }
    }
  }

  res.json({ status: 'ok' });
}));


// ═════════════════════════════════════════════════════════════════════════════
// PROTECTED DASHBOARD ROUTES — Key Management, IP Whitelisting, Analytics
// ═════════════════════════════════════════════════════════════════════════════

router.use('/manage', verifyToken);

// ─── Generate API Key + Secret ───────────────────────────────────────────────

router.post('/manage/keys', asyncHandler(async (req, res) => {
  const { name, platform, mode, whitelistedIPs } = req.body;

  if (!name || !platform) throw new ValidationError('name and platform are required');
  if (!['razorpay', 'cashfree', 'all'].includes(platform)) {
    throw new ValidationError('platform must be razorpay, cashfree, or all');
  }

  const keyMode = mode === 'test' ? 'test' : 'live';
  const apiKey = generateApiKey(keyMode);
  const secretKey = generateSecretKey(keyMode);
  const secretHash = hashSecret(secretKey);

  const keyDoc = {
    apiKey,
    secretHash,
    name,
    platform,
    mode: keyMode,
    active: true,
    whitelistedIPs: Array.isArray(whitelistedIPs) ? whitelistedIPs : [],
    requestCount: 0,
    lastUsed: null,
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  };

  const docRef = await db.collection('gateway_api_keys').add(keyDoc);

  // Return secret ONLY on creation
  res.status(201).json({
    id: docRef.id,
    apiKey,
    secretKey,
    name,
    platform,
    mode: keyMode,
    active: true,
    whitelistedIPs: keyDoc.whitelistedIPs,
    createdAt: keyDoc.createdAt,
  });
}));

// ─── List API Keys ───────────────────────────────────────────────────────────

router.get('/manage/keys', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('gateway_api_keys').orderBy('createdAt', 'desc').get();
  res.json(snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id, apiKey: d.apiKey, name: d.name, platform: d.platform,
      mode: d.mode, active: d.active, whitelistedIPs: d.whitelistedIPs || [],
      requestCount: d.requestCount || 0, lastUsed: d.lastUsed,
      createdBy: d.createdBy, createdAt: d.createdAt,
    };
  }));
}));

// ─── Revoke API Key ──────────────────────────────────────────────────────────

router.delete('/manage/keys/:id', asyncHandler(async (req, res) => {
  const docRef = db.collection('gateway_api_keys').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('API key not found');
  await docRef.update({ active: false, revokedAt: new Date().toISOString(), revokedBy: req.user.uid });
  res.json({ success: true });
}));

// ─── Update IP Whitelist ─────────────────────────────────────────────────────

router.put('/manage/keys/:id/ips', asyncHandler(async (req, res) => {
  const { whitelistedIPs } = req.body;
  if (!Array.isArray(whitelistedIPs)) throw new ValidationError('whitelistedIPs must be an array');

  const ipRegex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  for (const ip of whitelistedIPs) {
    if (ip !== '0.0.0.0' && !ipRegex.test(ip)) throw new ValidationError(`Invalid IP: ${ip}`);
  }

  const docRef = db.collection('gateway_api_keys').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) throw new NotFoundError('API key not found');
  await docRef.update({ whitelistedIPs, updatedAt: new Date().toISOString() });
  res.json({ success: true, whitelistedIPs });
}));

// ─── Get API Logs ────────────────────────────────────────────────────────────

router.get('/manage/logs', asyncHandler(async (req, res) => {
  const { platform, appName, page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const snapshot = await db.collection('gateway_api_logs').orderBy('timestamp', 'desc').get();
  let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  if (platform) logs = logs.filter(l => l.platform === platform);
  if (appName) logs = logs.filter(l => l.appName === appName);

  const total = logs.length;
  res.json({
    logs: logs.slice(offset, offset + limitNum),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
}));

// ─── Get Transactions (per-app payment tracking) ────────────────────────────

router.get('/manage/transactions', asyncHandler(async (req, res) => {
  const { platform, appName, status, page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const snapshot = await db.collection('gateway_transactions').orderBy('createdAt', 'desc').get();
  let txns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  if (platform) txns = txns.filter(t => t.platform === platform);
  if (appName) txns = txns.filter(t => t.appName === appName);
  if (status) txns = txns.filter(t => t.status === status);

  const total = txns.length;
  res.json({
    transactions: txns.slice(offset, offset + limitNum),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
}));

// ─── Dashboard Stats + Per-App Breakdown ─────────────────────────────────────

router.get('/manage/stats', asyncHandler(async (req, res) => {
  const [keysSnap, logsSnap, txnsSnap] = await Promise.all([
    db.collection('gateway_api_keys').where('active', '==', true).get(),
    db.collection('gateway_api_logs').get(),
    db.collection('gateway_transactions').get(),
  ]);

  const logs = logsSnap.docs.map(d => d.data());
  const txns = txnsSnap.docs.map(d => d.data());
  const today = new Date().toISOString().split('T')[0];

  // Per-app breakdown
  const appBreakdown = {};
  for (const txn of txns) {
    const app = txn.appName || 'Unknown';
    if (!appBreakdown[app]) {
      appBreakdown[app] = { orders: 0, paid: 0, totalAmount: 0, paidAmount: 0, razorpay: 0, cashfree: 0 };
    }
    appBreakdown[app].orders++;
    if (txn.platform === 'razorpay') appBreakdown[app].razorpay++;
    if (txn.platform === 'cashfree') appBreakdown[app].cashfree++;

    const amt = txn.platform === 'razorpay' ? (txn.amount || 0) / 100 : (txn.amount || 0);
    appBreakdown[app].totalAmount += amt;

    if (txn.status === 'paid' || txn.status === 'captured') {
      appBreakdown[app].paid++;
      appBreakdown[app].paidAmount += amt;
    }
  }

  res.json({
    activeKeys: keysSnap.size,
    totalRequests: logsSnap.size,
    todayRequests: logs.filter(l => l.timestamp?.startsWith(today)).length,
    totalTransactions: txns.length,
    paidTransactions: txns.filter(t => t.status === 'paid' || t.status === 'captured').length,
    totalVolume: txns.reduce((sum, t) => {
      return sum + (t.platform === 'razorpay' ? (t.amount || 0) / 100 : (t.amount || 0));
    }, 0),
    razorpayTransactions: txns.filter(t => t.platform === 'razorpay').length,
    cashfreeTransactions: txns.filter(t => t.platform === 'cashfree').length,
    appBreakdown,
  });
}));

export default router;
