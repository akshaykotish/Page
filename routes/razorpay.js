import { Router } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../firebase-admin.js';
import { sendEmail as dispatchEmail, getMailConfig } from '../utils/mailer.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { postJournalEntry } from '../utils/ledger.js';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';
import { webhookLimiter } from '../middleware/rateLimiter.js';

const router = Router();

let _razorpay;
function getRazorpay() {
  if (!_razorpay) {
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
}

// Structured logger for payment events
function logPaymentEvent(eventType, data) {
  console.log(JSON.stringify({
    level: 'info',
    service: 'razorpay',
    eventType,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

// ===== PUBLIC: Verify webhook signature and handle payment events =====
router.post('/webhook', webhookLimiter, asyncHandler(async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'Missing signature header' });
  }

  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    logPaymentEvent('webhook_signature_mismatch', {
      path: req.path,
      ip: req.ip,
    });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const { event, payload } = req.body;

  // Check for idempotency — skip duplicate webhooks
  const webhookIdempotencyKey = `${event}:${payload?.payment?.entity?.id || payload?.payment_link?.entity?.id}`;
  const existingWebhook = await db.collection('webhook_events')
    .where('idempotencyKey', '==', webhookIdempotencyKey)
    .limit(1)
    .get();

  if (!existingWebhook.empty) {
    logPaymentEvent('webhook_duplicate', { event, idempotencyKey: webhookIdempotencyKey });
    return res.json({ status: 'ok', duplicate: true });
  }

  logPaymentEvent('webhook_received', { event, paymentId: payload?.payment?.entity?.id });

  if (event === 'payment.captured' || event === 'payment_link.paid') {
    const payment = payload.payment?.entity || payload.payment_link?.entity;
    if (!payment) {
      return res.json({ status: 'ok' });
    }

    // Find and update matching razorpay_payment record
    const snap = await db.collection('razorpay_payments')
      .where('razorpayOrderId', '==', payment.order_id || '')
      .limit(1).get();

    if (!snap.empty) {
      await snap.docs[0].ref.update({
        status: 'captured',
        razorpayPaymentId: payment.id,
        method: payment.method,
        capturedAt: new Date().toISOString(),
      });
      logPaymentEvent('payment_captured', { paymentId: payment.id, orderId: payment.order_id });
    }

    // Also check payment links
    if (event === 'payment_link.paid') {
      const linkEntity = payload.payment_link?.entity;
      if (linkEntity) {
        const linkSnap = await db.collection('razorpay_payments')
          .where('razorpayPaymentLinkId', '==', linkEntity.id)
          .limit(1).get();

        if (!linkSnap.empty) {
          await linkSnap.docs[0].ref.update({
            status: 'paid',
            razorpayPaymentId: linkEntity.payments?.[0]?.payment_id || '',
            paidAt: new Date().toISOString(),
          });

          logPaymentEvent('payment_link_paid', { linkId: linkEntity.id });

          // If linked to invoice, mark it paid and send receipt email
          const record = linkSnap.docs[0].data();
          if (record.invoiceId) {
            await db.collection('invoices').doc(record.invoiceId).update({
              status: 'paid',
              paidDate: new Date().toISOString(),
            });
            // Send payment receipt email
            try {
              const invDoc = await db.collection('invoices').doc(record.invoiceId).get();
              if (invDoc.exists) {
                const inv = { id: invDoc.id, ...invDoc.data() };
                if (inv.customer?.email) {
                  const { sendInvoiceEmail } = await import('./billing.js');
                  if (sendInvoiceEmail) {
                    await sendInvoiceEmail(inv, 'payment_received');
                  }
                }
              }
            } catch (emailErr) {
              console.error('Webhook receipt email error:', emailErr.message);
            }
          }
        }
      }
    }
  }

  // Record webhook event for idempotency
  await db.collection('webhook_events').add({
    idempotencyKey: webhookIdempotencyKey,
    event,
    paymentId: payload?.payment?.entity?.id || payload?.payment_link?.entity?.id,
    receivedAt: new Date().toISOString(),
  });

  res.json({ status: 'ok' });
}));

// ===== PUBLIC: API key-based payment capture (for subsidiaries) =====
router.post('/api/capture', asyncHandler(async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const keyDoc = await db.collection('api_keys')
    .where('key', '==', apiKey)
    .where('active', '==', true)
    .limit(1)
    .get();

  if (keyDoc.empty) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { amount, currency, description, customer, invoiceId, callbackUrl } = req.body;

  if (!amount || parseFloat(amount) <= 0) {
    throw new ValidationError('Amount must be greater than 0');
  }

  const amountInPaise = Math.round(parseFloat(amount) * 100);

  // Create Razorpay order
  const order = await getRazorpay().orders.create({
    amount: amountInPaise,
    currency: currency || 'INR',
    receipt: `rcpt_${uuidv4().slice(0, 8)}`,
    notes: {
      description: description || '',
      customer_name: customer?.name || '',
      invoice_id: invoiceId || '',
      source: 'api',
      api_key_id: keyDoc.docs[0].id,
    },
  });

  // Save to DB
  const record = {
    razorpayOrderId: order.id,
    amount: parseFloat(amount),
    currency: currency || 'INR',
    status: 'created',
    description: description || '',
    customer: customer || {},
    invoiceId: invoiceId || null,
    source: 'api',
    apiKeyId: keyDoc.docs[0].id,
    callbackUrl: callbackUrl || '',
    createdAt: new Date().toISOString(),
  };

  const docRef = await db.collection('razorpay_payments').add(record);

  // Log API call
  logPaymentEvent('api_payment_created', {
    orderId: order.id,
    apiKeyId: keyDoc.docs[0].id,
    amount: parseFloat(amount),
  });

  await db.collection('api_logs').add({
    endpoint: '/api/razorpay/api/capture',
    method: 'POST',
    apiKeyId: keyDoc.docs[0].id,
    orderId: order.id,
    status: 201,
    timestamp: new Date().toISOString(),
  });

  res.status(201).json({
    success: true,
    orderId: order.id,
    amount: parseFloat(amount),
    currency: currency || 'INR',
    keyId: process.env.RAZORPAY_KEY_ID,
    recordId: docRef.id,
  });
}));

// ===== PROTECTED ROUTES =====
router.use(verifyToken);

// Create Razorpay order (from dashboard)
router.post('/orders', asyncHandler(async (req, res) => {
  const { amount, currency, description, customer, invoiceId } = req.body;

  if (!amount || parseFloat(amount) <= 0) {
    throw new ValidationError('Amount must be greater than 0');
  }

  const amountInPaise = Math.round(parseFloat(amount) * 100);

  const order = await getRazorpay().orders.create({
    amount: amountInPaise,
    currency: currency || 'INR',
    receipt: `rcpt_${uuidv4().slice(0, 8)}`,
    notes: {
      description: description || '',
      customer_name: customer?.name || '',
      invoice_id: invoiceId || '',
      source: 'dashboard',
    },
  });

  const record = {
    razorpayOrderId: order.id,
    amount: parseFloat(amount),
    currency: currency || 'INR',
    status: 'created',
    description: description || '',
    customer: customer || {},
    invoiceId: invoiceId || null,
    source: 'dashboard',
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  };

  const docRef = await db.collection('razorpay_payments').add(record);

  logPaymentEvent('dashboard_order_created', {
    orderId: order.id,
    userId: req.user.uid,
    amount: parseFloat(amount),
  });

  res.status(201).json({
    success: true,
    orderId: order.id,
    amount: parseFloat(amount),
    keyId: process.env.RAZORPAY_KEY_ID,
    recordId: docRef.id,
  });
}));

// Verify payment after Razorpay checkout
router.post('/verify', asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new ValidationError('Missing required payment verification fields');
  }

  // Verify signature
  const generated = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (generated !== razorpay_signature) {
    logPaymentEvent('payment_verification_failed', { orderId: razorpay_order_id });
    return res.status(400).json({ error: 'Payment verification failed' });
  }

  // Update record
  const snap = await db.collection('razorpay_payments')
    .where('razorpayOrderId', '==', razorpay_order_id)
    .limit(1).get();

  if (!snap.empty) {
    const record = snap.data();
    await snap.docs[0].ref.update({
      status: 'paid',
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      paidAt: new Date().toISOString(),
    });

    // Record in main payments collection
    const payment = {
      paymentId: `PAY-${uuidv4().slice(0, 8).toUpperCase()}`,
      amount: record.amount,
      type: 'incoming',
      method: 'razorpay',
      reference: razorpay_payment_id,
      description: record.description,
      invoiceId: record.invoiceId || null,
      status: 'completed',
      source: 'razorpay',
      createdBy: req.user.uid,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    await db.collection('payments').add(payment);

    logPaymentEvent('payment_verified', {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      amount: record.amount,
      userId: req.user.uid,
    });

    // Journal entry (with idempotency check)
    const existingJournal = await db.collection('journal_entries')
      .where('reference', '==', razorpay_payment_id)
      .limit(1)
      .get();

    if (existingJournal.empty) {
      await postJournalEntry({
        date: payment.date,
        description: `Razorpay Payment ${razorpay_payment_id} — ${record.description}`,
        reference: razorpay_payment_id,
        source: 'razorpay',
        sourceId: snap.docs[0].id,
        lines: [
          { account: 'Razorpay Account', debit: record.amount, credit: 0 },
          { account: 'Accounts Receivable', debit: 0, credit: record.amount },
        ],
        createdBy: req.user.uid,
      });
    }

    // If linked to invoice, mark paid and send receipt
    if (record.invoiceId) {
      await db.collection('invoices').doc(record.invoiceId).update({
        status: 'paid',
        paidDate: new Date().toISOString(),
      });
      try {
        const invDoc = await db.collection('invoices').doc(record.invoiceId).get();
        if (invDoc.exists) {
          const { sendInvoiceEmail } = await import('./billing.js');
          if (sendInvoiceEmail) {
            await sendInvoiceEmail({ id: invDoc.id, ...invDoc.data() }, 'payment_received');
          }
        }
      } catch (emailErr) {
        console.error('Verify receipt email error:', emailErr.message);
      }
    }
  }

  res.json({ success: true, paymentId: razorpay_payment_id });
}));

// ===== CREATE PAYMENT LINK & SEND VIA EMAIL =====
router.post('/payment-link', asyncHandler(async (req, res) => {
  const { amount, description, customer, invoiceId, sendEmail } = req.body;

  if (!amount || parseFloat(amount) <= 0) {
    throw new ValidationError('Amount must be greater than 0');
  }

  if (sendEmail && (!customer?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))) {
    throw new ValidationError('Valid customer email required to send payment link');
  }

  const amountInPaise = Math.round(parseFloat(amount) * 100);

  const linkOptions = {
    amount: amountInPaise,
    currency: 'INR',
    description: description || 'Payment',
    customer: {
      name: customer?.name || '',
      email: customer?.email || '',
      contact: customer?.phone || '',
    },
    notify: { sms: false, email: false }, // We handle email ourselves
    callback_url: '',
    callback_method: 'get',
    notes: {
      invoice_id: invoiceId || '',
      source: 'dashboard',
    },
  };

  const link = await getRazorpay().paymentLink.create(linkOptions);

  // Save record
  const record = {
    razorpayPaymentLinkId: link.id,
    razorpayPaymentLinkUrl: link.short_url,
    amount: parseFloat(amount),
    currency: 'INR',
    status: 'created',
    description: description || '',
    customer: customer || {},
    invoiceId: invoiceId || null,
    source: 'payment_link',
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  };

  const docRef = await db.collection('razorpay_payments').add(record);

  logPaymentEvent('payment_link_created', {
    linkId: link.id,
    userId: req.user.uid,
    amount: parseFloat(amount),
  });

  // Send email if requested
  let emailSent = false;
  if (sendEmail && customer?.email) {
    try {
      const companyName = process.env.COMPANY_NAME || 'Akshay Kotish & Co.';
      const mailConfig = getMailConfig();

      await dispatchEmail({
        to: customer.email,
        subject: `Payment Request — ₹${parseFloat(amount).toLocaleString('en-IN')} | ${companyName}`,
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0;">
            <div style="background: #2e7d32; padding: 24px 30px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #fff; margin: 0; font-size: 22px;">${companyName}</h1>
              <p style="color: #c0e040; margin: 4px 0 0; font-size: 13px;">Payment Request</p>
            </div>
            <div style="background: #fff; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">
              <p style="font-size: 15px; color: #333;">Dear <strong>${customer.name || 'Sir/Madam'}</strong>,</p>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                We are writing to request payment for the following:
              </p>
              <div style="background: #f8f8f8; border: 2px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                <div style="font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Amount Due</div>
                <div style="font-size: 32px; font-weight: 900; color: #1a1a1a; margin: 8px 0;">₹${parseFloat(amount).toLocaleString('en-IN')}</div>
                ${description ? `<div style="font-size: 13px; color: #666;">${description}</div>` : ''}
                ${invoiceId ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">Invoice Reference: ${invoiceId}</div>` : ''}
              </div>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${link.short_url}" style="display: inline-block; background: #2e7d32; color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 800; font-size: 15px; letter-spacing: 0.5px;">
                  Pay Now
                </a>
              </div>
              <p style="font-size: 12px; color: #999; text-align: center;">
                Secure payment powered by Razorpay. Click the button above or use this link:<br/>
                <a href="${link.short_url}" style="color: #2e7d32;">${link.short_url}</a>
              </p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
              <p style="font-size: 12px; color: #999;">
                If you have already made this payment, please disregard this email.<br/>
                For queries, contact us at ${mailConfig?.fromEmail || 'connect@akshaykotish.com'}
              </p>
            </div>
            <div style="background: #1a1a1a; padding: 16px 30px; border-radius: 0 0 12px 12px; text-align: center;">
              <p style="color: #888; font-size: 11px; margin: 0;">${companyName} &bull; GSTIN: ${process.env.COMPANY_GSTIN || ''}</p>
            </div>
          </div>
        `,
      });
      emailSent = true;

      logPaymentEvent('payment_link_email_sent', {
        linkId: link.id,
        to: customer.email,
      });
    } catch (emailErr) {
      console.error('Payment email error:', emailErr);
      logPaymentEvent('payment_link_email_failed', {
        linkId: link.id,
        error: emailErr.message,
      });
    }
  }

  res.status(201).json({
    success: true,
    paymentLinkId: link.id,
    paymentLinkUrl: link.short_url,
    amount: parseFloat(amount),
    emailSent,
    recordId: docRef.id,
  });
}));

// List all razorpay payment records
router.get('/', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('razorpay_payments')
    .orderBy('createdAt', 'desc')
    .get();
  const results = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(results);
}));

// Get Razorpay payment link status
router.get('/link/:linkId', asyncHandler(async (req, res) => {
  const { linkId } = req.params;
  if (!linkId || linkId.length === 0) {
    throw new ValidationError('Payment link ID is required');
  }

  const link = await getRazorpay().paymentLink.fetch(linkId);
  res.json(link);
}));

export default router;
