import { Router } from 'express';
import { auth, db } from '../firebase-admin.js';
import { verifyToken, requireRole, requirePermission, ALL_PERMISSIONS, ROLE_TEMPLATES, resolvePermissions, getAllPermissionKeys } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError, ConflictError, UnauthorizedError, ForbiddenError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';
import { otpLimiter, authLimiter, apiLimiter } from '../middleware/rateLimiter.js';
import { sendEmail as dispatchEmail, getMailConfig } from '../utils/mailer.js';

const router = Router();
const SUPERADMIN_PHONE = '+919896770369';

// ─── Helper Functions ─────────────────────────────────────────────────────

async function logAuth(action, identifier, details = {}) {
  console.log(JSON.stringify({
    level: 'info',
    action: 'auth_log',
    operation: action,
    identifier,
    ...details,
    timestamp: new Date().toISOString(),
  }));

  await db.collection('auth_logs').add({
    action,
    identifier,
    ...details,
    timestamp: new Date().toISOString(),
  });
}

async function invalidateUserCache(userId) {
  // Placeholder for cache invalidation logic
  // In production, integrate with Redis or similar
  console.log(JSON.stringify({
    level: 'debug',
    operation: 'cache_invalidate',
    userId,
    timestamp: new Date().toISOString(),
  }));
}

async function ensureSuperadmin() {
  try {
    const existing = await db.collection('users').where('phone', '==', SUPERADMIN_PHONE).get();
    if (existing.empty) {
      await db.collection('users').add({
        phone: SUPERADMIN_PHONE,
        email: 'akshaykotish@gmail.com',
        name: 'Akshay Kotish',
        role: 'superadmin',
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      console.log(JSON.stringify({
        level: 'info',
        operation: 'superadmin_init',
        phone: SUPERADMIN_PHONE,
        timestamp: new Date().toISOString(),
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      operation: 'superadmin_init_failed',
      error: error.message,
      timestamp: new Date().toISOString(),
    }));
  }
}

ensureSuperadmin();

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL OTP ENDPOINTS (no auth required)
// ═══════════════════════════════════════════════════════════════════════════

// Email OTP - Send
router.post('/email-otp', otpLimiter, validate('emailOtp'), asyncHandler(async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

  // Store in Firestore
  await db.collection('email_otps').add({
    email: normalizedEmail,
    otp,
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  const mailConfig = getMailConfig();
  if (!mailConfig) {
    throw new Error('Email service not configured. Set GMAIL_USER+GMAIL_APP_PASSWORD, BREVO_SMTP_USER+BREVO_SMTP_KEY, or SMTP_HOST+SMTP_USER+SMTP_PASS.');
  }

  // Beautiful HTML email template
  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0faf0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="420" cellpadding="0" cellspacing="0" style="background:#ffffff;border:4px solid #1a1a1a;border-radius:14px;box-shadow:8px 8px 0 #1a1a1a;overflow:hidden;">
        <tr><td style="background:#c0e040;padding:24px;text-align:center;border-bottom:4px solid #1a1a1a;">
          <div style="display:inline-block;width:48px;height:48px;background:#fff;border:3px solid #1a1a1a;border-radius:10px;line-height:48px;font-family:Georgia,serif;font-weight:900;font-size:20px;color:#1a1a1a;">AK</div>
          <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#1a1a1a;margin:12px 0 0;">Akshay Kotish &amp; Co.</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="font-size:18px;font-weight:800;color:#1a1a1a;margin:0 0 8px;">Your Login Code</h2>
          <p style="font-size:14px;color:#666;margin:0 0 24px;line-height:1.5;">Use the code below to sign in. This code expires in 5 minutes.</p>
          <div style="background:#f5f5f0;border:3px solid #1a1a1a;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
            <span style="font-family:'Courier New',monospace;font-size:36px;font-weight:900;letter-spacing:8px;color:#1a1a1a;">${otp}</span>
          </div>
          <p style="font-size:12px;color:#999;margin:0;line-height:1.5;">If you did not request this code, please ignore this email. Do not share this code with anyone.</p>
        </td></tr>
        <tr><td style="background:#f5f5f0;padding:16px;text-align:center;border-top:2px solid #eee;">
          <p style="font-size:11px;color:#999;margin:0;">Akshay Kotish &amp; Co. &mdash; Chartered Accountants</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await dispatchEmail({
    to: normalizedEmail,
    subject: `${otp} — Your Login Code | AK & Co.`,
    html: htmlBody,
  });

  await logAuth('email_otp_sent', normalizedEmail);

  console.log(JSON.stringify({
    level: 'info',
    operation: 'otp_sent',
    email: normalizedEmail,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, message: 'OTP sent to your email' });
}));

// Email OTP - Verify
router.post('/verify-email-otp', authLimiter, validate('verifyOtp'), asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  // Look up OTP in Firestore
  const otpSnapshot = await db.collection('email_otps')
    .where('email', '==', normalizedEmail)
    .where('otp', '==', otp)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (otpSnapshot.empty) {
    throw new UnauthorizedError('Invalid OTP. Please check and try again.');
  }

  const otpDoc = otpSnapshot.docs[0];
  const otpData = otpDoc.data();

  // Check expiry
  if (new Date() > new Date(otpData.expiresAt)) {
    await otpDoc.ref.delete();
    throw new UnauthorizedError('OTP expired. Please request a new one.');
  }

  // Find user by email in users collection
  const userSnapshot = await db.collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (userSnapshot.empty) {
    throw new ForbiddenError('Email not registered. Contact administrator for access.');
  }

  const userDoc = userSnapshot.docs[0];
  const userData = userDoc.data();

  if (userData.status === 'inactive') {
    throw new ForbiddenError('Account deactivated. Contact administrator.');
  }

  // Create Firebase custom token using the Firestore document ID as uid
  const customToken = await auth.createCustomToken(userDoc.id);

  // Delete used OTP
  await otpDoc.ref.delete();

  // Clean up any other OTPs for this email
  const oldOtps = await db.collection('email_otps').where('email', '==', normalizedEmail).get();
  const batch = db.batch();
  oldOtps.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  // Update last login
  await db.collection('users').doc(userDoc.id).update({
    lastLogin: new Date().toISOString(),
  }).catch(() => {});

  await invalidateUserCache(userDoc.id);
  await logAuth('email_otp_verified', normalizedEmail, { userId: userDoc.id, role: userData.role });

  console.log(JSON.stringify({
    level: 'info',
    operation: 'otp_verified',
    userId: userDoc.id,
    email: normalizedEmail,
    role: userData.role,
    timestamp: new Date().toISOString(),
  }));

  const userPermissions = resolvePermissions({ ...userData, uid: userDoc.id });
  res.json({
    token: customToken,
    user: {
      id: userDoc.id,
      name: userData.name,
      email: userData.email,
      role: userData.role,
      permissions: userPermissions,
      customRole: userData.customRole || null,
    },
  });
}));

// ═══════════════════════════════════════════════════════════════════════════
// USER AUTHENTICATION ENDPOINTS (verify-token required)
// ═══════════════════════════════════════════════════════════════════════════

// Check if phone is registered (called after Firebase phone auth)
router.post('/check-user', verifyToken, asyncHandler(async (req, res) => {
  await logAuth('login_success', req.user.phone, { userId: req.user.uid, role: req.user.role });

  await db.collection('users').doc(req.user.uid).update({
    lastLogin: new Date().toISOString(),
  }).catch(() => {});

  await invalidateUserCache(req.user.uid);

  console.log(JSON.stringify({
    level: 'info',
    operation: 'user_check',
    userId: req.user.uid,
    phone: req.user.phone,
    timestamp: new Date().toISOString(),
  }));

  const permissions = resolvePermissions(req.user);
  res.json({
    id: req.user.uid,
    name: req.user.name,
    phone: req.user.phone,
    email: req.user.email,
    role: req.user.role,
    status: req.user.status,
    permissions,
    customRole: req.user.customRole || null,
  });
}));

// Get current user
router.get('/me', verifyToken, asyncHandler(async (req, res) => {
  const permissions = resolvePermissions(req.user);
  res.json({
    id: req.user.uid,
    name: req.user.name,
    phone: req.user.phone,
    email: req.user.email,
    role: req.user.role,
    permissions,
    customRole: req.user.customRole || null,
  });
}));

// ═══════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT ENDPOINTS (superadmin/admin required)
// ═══════════════════════════════════════════════════════════════════════════

// Get all users with pagination
router.get('/users', verifyToken, requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const snapshot = await db.collection('users')
    .orderBy('createdAt', 'desc')
    .get();

  const totalUsers = snapshot.size;
  const totalPages = Math.ceil(totalUsers / limit);
  const users = snapshot.docs
    .slice(offset, offset + limit)
    .map(doc => ({ id: doc.id, ...doc.data() }));

  console.log(JSON.stringify({
    level: 'info',
    operation: 'list_users',
    userId: req.user.uid,
    page,
    limit,
    total: totalUsers,
    timestamp: new Date().toISOString(),
  }));

  res.json({
    data: users,
    pagination: { page, limit, total: totalUsers, pages: totalPages },
  });
}));

// Create user
router.post('/users', verifyToken, requireRole('superadmin', 'admin'), validate('createUser'), asyncHandler(async (req, res) => {
  const { name, phone, email, role } = req.body;

  if (!phone && !email) {
    throw new ValidationError('Phone or email required');
  }

  // Role permission check
  if (['superadmin', 'admin', 'employee'].includes(role) && req.user.role !== 'superadmin') {
    throw new ForbiddenError('Only superadmin can create admin/employee accounts');
  }

  // Check duplicate phone
  if (phone) {
    const dup = await db.collection('users').where('phone', '==', phone).get();
    if (!dup.empty) {
      throw new ConflictError('Phone already registered');
    }
  }

  // Check duplicate email
  if (email) {
    const dup = await db.collection('users').where('email', '==', email).get();
    if (!dup.empty) {
      throw new ConflictError('Email already registered');
    }
  }

  const user = {
    name,
    phone: phone || '',
    email: email || '',
    role: role || 'client',
    status: 'active',
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  };

  const docRef = await db.collection('users').add(user);
  await logAuth('user_created', phone || email, { createdBy: req.user.uid, role: user.role });

  console.log(JSON.stringify({
    level: 'info',
    operation: 'user_created',
    userId: docRef.id,
    createdBy: req.user.uid,
    role: user.role,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, ...user });
}));

// Update user
router.put('/users/:id', verifyToken, requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const { name, phone, email, role, status } = req.body;
  const update = { updatedAt: new Date().toISOString() };

  if (name) update.name = name;
  if (phone) update.phone = phone;
  if (email) update.email = email;
  if (status) update.status = status;
  if (role && req.user.role === 'superadmin') update.role = role;

  // Verify user exists
  const userDoc = await db.collection('users').doc(req.params.id).get();
  if (!userDoc.exists) {
    throw new NotFoundError('User');
  }

  await db.collection('users').doc(req.params.id).update(update);
  await invalidateUserCache(req.params.id);

  console.log(JSON.stringify({
    level: 'info',
    operation: 'user_updated',
    userId: req.params.id,
    updatedBy: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, message: 'User updated successfully' });
}));

// Deactivate user
router.delete('/users/:id', verifyToken, requireRole('superadmin'), asyncHandler(async (req, res) => {
  // Verify user exists
  const userDoc = await db.collection('users').doc(req.params.id).get();
  if (!userDoc.exists) {
    throw new NotFoundError('User');
  }

  await db.collection('users').doc(req.params.id).update({
    status: 'inactive',
    updatedAt: new Date().toISOString(),
  });

  await invalidateUserCache(req.params.id);
  await logAuth('user_deactivated', req.params.id, { deactivatedBy: req.user.uid });

  console.log(JSON.stringify({
    level: 'info',
    operation: 'user_deactivated',
    userId: req.params.id,
    deactivatedBy: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, message: 'User deactivated' });
}));

// ═══════════════════════════════════════════════════════════════════════════
// PERMISSIONS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Get all available permissions (schema)
router.get('/permissions/schema', verifyToken, requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  res.json({
    modules: ALL_PERMISSIONS,
    allKeys: getAllPermissionKeys(),
    roleTemplates: ROLE_TEMPLATES,
  });
}));

// Get current user's resolved permissions
router.get('/permissions/me', verifyToken, asyncHandler(async (req, res) => {
  const permissions = resolvePermissions(req.user);
  res.json({ permissions, role: req.user.role });
}));

// Get permissions for a specific user
router.get('/permissions/:userId', verifyToken, requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const userDoc = await db.collection('users').doc(req.params.userId).get();
  if (!userDoc.exists) throw new NotFoundError('User');
  const userData = { uid: userDoc.id, ...userDoc.data() };
  const permissions = resolvePermissions(userData);
  res.json({
    userId: userDoc.id,
    role: userData.role,
    permissions,
    isCustom: Array.isArray(userData.permissions) && userData.permissions.length > 0,
  });
}));

// Update permissions for a specific user
router.put('/permissions/:userId', verifyToken, requireRole('superadmin'), asyncHandler(async (req, res) => {
  const { permissions } = req.body;
  if (!Array.isArray(permissions)) {
    throw new ValidationError('permissions must be an array');
  }

  // Validate all permission keys
  const validKeys = getAllPermissionKeys();
  const invalid = permissions.filter(p => !validKeys.includes(p));
  if (invalid.length > 0) {
    throw new ValidationError(`Invalid permissions: ${invalid.join(', ')}`);
  }

  const userDoc = await db.collection('users').doc(req.params.userId).get();
  if (!userDoc.exists) throw new NotFoundError('User');

  await db.collection('users').doc(req.params.userId).update({
    permissions,
    updatedAt: new Date().toISOString(),
  });

  await invalidateUserCache(req.params.userId);
  await logAuth('permissions_updated', req.params.userId, { updatedBy: req.user.uid, permissionCount: permissions.length });

  res.json({ success: true, message: 'Permissions updated', permissions });
}));

// Reset user permissions to role template defaults
router.delete('/permissions/:userId', verifyToken, requireRole('superadmin'), asyncHandler(async (req, res) => {
  const userDoc = await db.collection('users').doc(req.params.userId).get();
  if (!userDoc.exists) throw new NotFoundError('User');

  await db.collection('users').doc(req.params.userId).update({
    permissions: [],
    updatedAt: new Date().toISOString(),
  });

  await invalidateUserCache(req.params.userId);
  await logAuth('permissions_reset', req.params.userId, { resetBy: req.user.uid });

  const role = userDoc.data().role || 'client';
  res.json({ success: true, message: 'Permissions reset to role defaults', permissions: ROLE_TEMPLATES[role] || [] });
}));

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM ROLES ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Get all custom roles
router.get('/roles', verifyToken, requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const snapshot = await db.collection('custom_roles').orderBy('createdAt', 'desc').get();
  const roles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Include built-in roles
  const builtIn = Object.entries(ROLE_TEMPLATES).map(([name, permissions]) => ({
    id: `builtin_${name}`,
    name,
    permissions,
    builtIn: true,
    description: `Default ${name} role`,
  }));

  res.json({ builtIn, custom: roles });
}));

// Create custom role
router.post('/roles', verifyToken, requireRole('superadmin'), asyncHandler(async (req, res) => {
  const { name, description, permissions } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    throw new ValidationError('Role name must be at least 2 characters');
  }
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new ValidationError('permissions must be a non-empty array');
  }

  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, '_');

  // Prevent collision with built-in roles
  if (ROLE_TEMPLATES[normalizedName]) {
    throw new ConflictError(`Cannot overwrite built-in role "${normalizedName}"`);
  }

  // Check duplicate
  const existing = await db.collection('custom_roles').where('name', '==', normalizedName).get();
  if (!existing.empty) {
    throw new ConflictError(`Role "${normalizedName}" already exists`);
  }

  // Validate permissions
  const validKeys = getAllPermissionKeys();
  const invalid = permissions.filter(p => !validKeys.includes(p));
  if (invalid.length > 0) {
    throw new ValidationError(`Invalid permissions: ${invalid.join(', ')}`);
  }

  const role = {
    name: normalizedName,
    displayName: name.trim(),
    description: description || '',
    permissions,
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  };

  const docRef = await db.collection('custom_roles').add(role);
  await logAuth('role_created', normalizedName, { createdBy: req.user.uid });

  res.status(201).json({ id: docRef.id, ...role });
}));

// Update custom role
router.put('/roles/:id', verifyToken, requireRole('superadmin'), asyncHandler(async (req, res) => {
  const { name, description, permissions } = req.body;

  const roleDoc = await db.collection('custom_roles').doc(req.params.id).get();
  if (!roleDoc.exists) throw new NotFoundError('Custom role');

  const update = { updatedAt: new Date().toISOString() };

  if (name) {
    const normalizedName = name.trim().toLowerCase().replace(/\s+/g, '_');
    if (ROLE_TEMPLATES[normalizedName]) {
      throw new ConflictError(`Cannot use built-in role name "${normalizedName}"`);
    }
    update.name = normalizedName;
    update.displayName = name.trim();
  }
  if (description !== undefined) update.description = description;
  if (Array.isArray(permissions)) {
    const validKeys = getAllPermissionKeys();
    const invalid = permissions.filter(p => !validKeys.includes(p));
    if (invalid.length > 0) {
      throw new ValidationError(`Invalid permissions: ${invalid.join(', ')}`);
    }
    update.permissions = permissions;
  }

  await db.collection('custom_roles').doc(req.params.id).update(update);
  await logAuth('role_updated', req.params.id, { updatedBy: req.user.uid });

  res.json({ success: true, message: 'Role updated' });
}));

// Delete custom role
router.delete('/roles/:id', verifyToken, requireRole('superadmin'), asyncHandler(async (req, res) => {
  const roleDoc = await db.collection('custom_roles').doc(req.params.id).get();
  if (!roleDoc.exists) throw new NotFoundError('Custom role');

  await db.collection('custom_roles').doc(req.params.id).delete();
  await logAuth('role_deleted', req.params.id, { deletedBy: req.user.uid });

  res.json({ success: true, message: 'Role deleted' });
}));

// Apply a custom role's permissions to a user
router.post('/roles/:id/apply/:userId', verifyToken, requireRole('superadmin'), asyncHandler(async (req, res) => {
  const roleDoc = await db.collection('custom_roles').doc(req.params.id).get();
  if (!roleDoc.exists) throw new NotFoundError('Custom role');

  const userDoc = await db.collection('users').doc(req.params.userId).get();
  if (!userDoc.exists) throw new NotFoundError('User');

  const roleData = roleDoc.data();
  await db.collection('users').doc(req.params.userId).update({
    permissions: roleData.permissions,
    customRole: roleData.name,
    updatedAt: new Date().toISOString(),
  });

  await invalidateUserCache(req.params.userId);
  await logAuth('role_applied', req.params.userId, { role: roleData.name, appliedBy: req.user.uid });

  res.json({ success: true, message: `Role "${roleData.displayName}" applied`, permissions: roleData.permissions });
}));

// ═══════════════════════════════════════════════════════════════════════════
// AUTH LOGS ENDPOINTS (superadmin required)
// ═══════════════════════════════════════════════════════════════════════════

// Get auth logs with pagination
router.get('/logs', verifyToken, requireRole('superadmin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const snapshot = await db.collection('auth_logs')
    .orderBy('timestamp', 'desc')
    .get();

  const totalLogs = snapshot.size;
  const totalPages = Math.ceil(totalLogs / limit);
  const logs = snapshot.docs
    .slice(offset, offset + limit)
    .map(doc => ({ id: doc.id, ...doc.data() }));

  res.json({
    data: logs,
    pagination: { page, limit, total: totalLogs, pages: totalPages },
  });
}));

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT SHARES ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// Create client share
router.post('/client-shares', verifyToken, requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const { clientId, type, title, data } = req.body;

  if (!clientId || !type || !title) {
    throw new ValidationError('clientId, type, and title required');
  }

  // Verify client exists
  const clientDoc = await db.collection('users').doc(clientId).get();
  if (!clientDoc.exists) {
    throw new NotFoundError('Client');
  }

  const share = {
    clientId,
    type,
    title,
    data,
    sharedBy: req.user.uid,
    sharedAt: new Date().toISOString(),
  };

  const docRef = await db.collection('client_shares').add(share);

  console.log(JSON.stringify({
    level: 'info',
    operation: 'share_created',
    shareId: docRef.id,
    clientId,
    sharedBy: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, ...share });
}));

// Get client's shares with pagination
router.get('/my-shares', verifyToken, asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const snapshot = await db.collection('client_shares')
    .where('clientId', '==', req.user.uid)
    .orderBy('sharedAt', 'desc')
    .get();

  const totalShares = snapshot.size;
  const totalPages = Math.ceil(totalShares / limit);
  const shares = snapshot.docs
    .slice(offset, offset + limit)
    .map(doc => ({ id: doc.id, ...doc.data() }));

  res.json({
    data: shares,
    pagination: { page, limit, total: totalShares, pages: totalPages },
  });
}));

export default router;
