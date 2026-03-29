import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import crypto from 'crypto';
import { asyncHandler, ValidationError, NotFoundError, ServiceUnavailableError } from '../middleware/errorHandler.js';

const router = Router();
router.use(verifyToken);
router.use(requireRole('superadmin', 'admin'));

const POSTE_API_URL = process.env.POSTE_API_URL || 'https://mail.akshaykotish.com';
const POSTE_ADMIN_EMAIL = process.env.POSTE_ADMIN_EMAIL || '';
const POSTE_ADMIN_PASSWORD = process.env.POSTE_ADMIN_PASSWORD || '';
const POSTE_REQUEST_TIMEOUT = 15000; // 15 seconds

// Structured logger for mailbox events
function logMailboxEvent(eventType, data) {
  console.log(JSON.stringify({
    level: 'info',
    service: 'poste',
    eventType,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

function getAuthHeader() {
  const credentials = Buffer.from(`${POSTE_ADMIN_EMAIL}:${POSTE_ADMIN_PASSWORD}`).toString('base64');
  return `Basic ${credentials}`;
}

async function posteRequest(method, endpoint, body = null) {
  if (!POSTE_ADMIN_EMAIL || !POSTE_ADMIN_PASSWORD) {
    throw new ServiceUnavailableError('Poste.io credentials not configured');
  }

  const url = `${POSTE_API_URL}/admin/api/v1${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POSTE_REQUEST_TIMEOUT);

  try {
    const options = {
      method,
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const errMsg = data?.message || data?.error || `Poste.io API error (${response.status})`;
      const err = new Error(errMsg);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ServiceUnavailableError(`Poste.io request timeout (${POSTE_REQUEST_TIMEOUT}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ===== CHECK CONFIGURATION =====
function isConfigured() {
  return !!(POSTE_ADMIN_EMAIL && POSTE_ADMIN_PASSWORD);
}

// ===== LIST ALL MAILBOXES =====
router.get('/', asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    return res.json({
      configured: false,
      message: 'Poste.io not configured. Set POSTE_API_URL, POSTE_ADMIN_EMAIL, POSTE_ADMIN_PASSWORD in environment variables.',
      boxes: [],
    });
  }

  try {
    const data = await posteRequest('GET', '/boxes');
    logMailboxEvent('mailboxes_listed', { count: Array.isArray(data) ? data.length : 0 });
    res.json(Array.isArray(data) ? data : (data.boxes || data));
  } catch (error) {
    logMailboxEvent('mailboxes_list_failed', { error: error.message });
    res.status(error.status || 500).json({
      configured: false,
      error: error.message,
      boxes: [],
    });
  }
}));

// ===== GET SINGLE MAILBOX =====
router.get('/mailboxes/:email', asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    throw new ServiceUnavailableError('Poste.io not configured');
  }

  const email = decodeURIComponent(req.params.email);

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('Invalid email format');
  }

  const data = await posteRequest('GET', `/boxes/${encodeURIComponent(email)}`);

  logMailboxEvent('mailbox_fetched', { email });
  res.json(data);
}));

// ===== CREATE MAILBOX =====
router.post('/mailboxes', asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    throw new ServiceUnavailableError('Poste.io not configured');
  }

  const { email, name, password, employeeId } = req.body;

  if (!email || email.trim().length === 0) {
    throw new ValidationError('Email address is required');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new ValidationError('Invalid email format');
  }

  if (!name || name.trim().length === 0) {
    throw new ValidationError('Mailbox name is required');
  }

  if (!password || password.trim().length === 0) {
    throw new ValidationError('Password is required');
  }

  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters long');
  }

  const data = await posteRequest('POST', `/boxes/${encodeURIComponent(email)}`, {
    name,
    passwordPlaintext: password,
  });

  logMailboxEvent('mailbox_created', { email, name });

  // If employeeId provided, update the employee doc in Firestore
  if (employeeId && employeeId.trim().length > 0) {
    try {
      await db.collection('employees').doc(employeeId).update({
        emailAlias: email,
        updatedAt: new Date().toISOString(),
      });

      logMailboxEvent('employee_email_alias_updated', { email, employeeId });
    } catch (firestoreErr) {
      console.error('Failed to update employee emailAlias:', firestoreErr.message);
      // Don't fail the whole request — mailbox was created successfully
      logMailboxEvent('employee_update_failed', { email, employeeId, error: firestoreErr.message });
    }
  }

  res.status(201).json({
    success: true,
    data,
    message: `Mailbox ${email} created successfully.`,
  });
}));

// ===== DELETE MAILBOX =====
router.delete('/mailboxes/:email', asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    throw new ServiceUnavailableError('Poste.io not configured');
  }

  const email = decodeURIComponent(req.params.email);

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('Invalid email format');
  }

  const data = await posteRequest('DELETE', `/boxes/${encodeURIComponent(email)}`);

  logMailboxEvent('mailbox_deleted', { email });

  res.json({
    success: true,
    data,
    message: `Mailbox ${email} deleted.`,
  });
}));

// ===== GENERATE RANDOM PASSWORD =====
router.post('/generate-password', asyncHandler(async (req, res) => {
  const length = 16;
  const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  const bytes = crypto.randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i++) {
    password += charset[bytes[i] % charset.length];
  }

  logMailboxEvent('password_generated', { length });

  res.json({ password });
}));

export default router;
