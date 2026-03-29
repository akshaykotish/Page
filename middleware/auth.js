import { auth, db } from '../firebase-admin.js';

// ─── User Cache ───────────────────────────────────────────────────────────────
// In-memory cache to reduce Firestore reads on every request.
// TTL: 5 minutes. Invalidate on user update.

const userCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedUser(key) {
  const entry = userCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    userCache.delete(key);
    return null;
  }
  return entry.user;
}

function setCachedUser(key, user) {
  userCache.set(key, { user, timestamp: Date.now() });
}

export function invalidateUserCache(uid) {
  for (const [key, entry] of userCache) {
    if (entry.user?.uid === uid || entry.user?.firebaseUid === uid) {
      userCache.delete(key);
    }
  }
}

// Clean expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of userCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      userCache.delete(key);
    }
  }
}, 60_000);

// ─── Token Verification ──────────────────────────────────────────────────────

export async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — no token provided', code: 'NO_TOKEN' });
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    if (!token || token.length < 10) {
      return res.status(401).json({ error: 'Invalid token format', code: 'INVALID_TOKEN_FORMAT' });
    }

    const decoded = await auth.verifyIdToken(token);

    // Check cache first
    const cacheKey = `firebase:${decoded.uid}`;
    const cachedUser = getCachedUser(cacheKey);
    if (cachedUser) {
      if (cachedUser.status === 'inactive') {
        return res.status(403).json({ error: 'Account deactivated.', code: 'ACCOUNT_INACTIVE' });
      }
      req.user = cachedUser;
      return next();
    }

    // Query Firestore for user
    let user = null;

    // 1. By firebaseUid
    const userDoc = await db.collection('users').where('firebaseUid', '==', decoded.uid).limit(1).get();
    if (!userDoc.empty) {
      user = { uid: userDoc.docs[0].id, ...userDoc.docs[0].data() };
    }

    // 2. By phone
    if (!user && decoded.phone_number) {
      const phoneDoc = await db.collection('users').where('phone', '==', decoded.phone_number).limit(1).get();
      if (!phoneDoc.empty) {
        const userData = phoneDoc.docs[0].data();
        await phoneDoc.docs[0].ref.update({ firebaseUid: decoded.uid });
        user = { uid: phoneDoc.docs[0].id, ...userData, firebaseUid: decoded.uid };
      }
    }

    // 3. By email
    if (!user && decoded.email) {
      const emailDoc = await db.collection('users').where('email', '==', decoded.email).limit(1).get();
      if (!emailDoc.empty) {
        const userData = emailDoc.docs[0].data();
        await emailDoc.docs[0].ref.update({ firebaseUid: decoded.uid });
        user = { uid: emailDoc.docs[0].id, ...userData, firebaseUid: decoded.uid };
      }
    }

    // 4. Custom token: uid IS the Firestore doc ID
    if (!user) {
      const customTokenDoc = await db.collection('users').doc(decoded.uid).get();
      if (customTokenDoc.exists) {
        const userData = customTokenDoc.data();
        await customTokenDoc.ref.update({ firebaseUid: decoded.uid });
        user = { uid: customTokenDoc.id, ...userData, firebaseUid: decoded.uid };
      }
    }

    if (!user) {
      return res.status(403).json({ error: 'User not registered. Contact administrator.', code: 'USER_NOT_REGISTERED' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ error: 'Account deactivated.', code: 'ACCOUNT_INACTIVE' });
    }

    // Cache the user
    setCachedUser(cacheKey, user);
    req.user = user;
    next();
  } catch (error) {
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expired. Please login again.', code: 'TOKEN_EXPIRED' });
    }
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ error: 'Session revoked. Please login again.', code: 'TOKEN_REVOKED' });
    }
    if (error.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Malformed token.', code: 'MALFORMED_TOKEN' });
    }
    console.error(JSON.stringify({
      level: 'error',
      type: 'AUTH_ERROR',
      message: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    }));
    return res.status(401).json({ error: 'Authentication failed', code: 'AUTH_FAILED' });
  }
}

// ─── Role Authorization ──────────────────────────────────────────────────────

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
    }
    if (!roles.includes(req.user.role)) {
      console.warn(JSON.stringify({
        level: 'warn',
        type: 'ACCESS_DENIED',
        userId: req.user.uid,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
      }));
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}`,
        code: 'INSUFFICIENT_ROLE',
      });
    }
    next();
  };
}
