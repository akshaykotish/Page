/**
 * Production Error Handler Middleware
 * Centralized error handling with structured responses and logging.
 */

// ─── Custom Error Classes ─────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

// ─── Error Handler Middleware ─────────────────────────────────────────────────

export function errorHandler(err, req, res, _next) {
  const requestId = req.headers['x-request-id'] || req.id || '-';
  const isProduction = process.env.NODE_ENV === 'production';

  // Default error structure
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred';
  let details = err.details || undefined;

  // Firebase auth errors
  if (err.code?.startsWith('auth/')) {
    statusCode = 401;
    code = 'AUTH_ERROR';
    message = mapFirebaseAuthError(err.code);
  }

  // Firestore errors
  if (err.code === 'permission-denied' || err.code === 7) {
    statusCode = 403;
    code = 'FIRESTORE_PERMISSION_DENIED';
    message = 'Database permission denied';
  }

  if (err.code === 'not-found' || err.code === 5) {
    statusCode = 404;
    code = 'FIRESTORE_NOT_FOUND';
    message = 'Document not found';
  }

  // Razorpay errors
  if (err.error?.source === 'business' || err.statusCode === 400) {
    statusCode = err.statusCode || 400;
    code = 'PAYMENT_ERROR';
    message = err.error?.description || err.message;
  }

  // Log based on severity
  if (statusCode >= 500) {
    console.error(JSON.stringify({
      level: 'error',
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code,
      message: err.message,
      stack: err.stack,
      userId: req.user?.uid,
      timestamp: new Date().toISOString(),
    }));
  } else if (statusCode >= 400) {
    console.warn(JSON.stringify({
      level: 'warn',
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code,
      message,
      userId: req.user?.uid,
      timestamp: new Date().toISOString(),
    }));
  }

  const response = {
    error: message,
    code,
    ...(details ? { details } : {}),
    ...(isProduction ? {} : { stack: err.stack }),
    requestId,
  };

  res.status(statusCode).json(response);
}

// ─── 404 handler ──────────────────────────────────────────────────────────────

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND',
  });
}

// ─── Async route wrapper ──────────────────────────────────────────────────────

/**
 * Wraps async route handlers to catch thrown errors and pass to errorHandler.
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ─── Firebase auth error mapping ──────────────────────────────────────────────

function mapFirebaseAuthError(code) {
  const map = {
    'auth/id-token-expired': 'Session expired. Please login again.',
    'auth/id-token-revoked': 'Session revoked. Please login again.',
    'auth/invalid-id-token': 'Invalid session. Please login again.',
    'auth/user-disabled': 'Account has been disabled.',
    'auth/user-not-found': 'Account not found.',
    'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
    'auth/invalid-phone-number': 'Invalid phone number format.',
    'auth/invalid-email': 'Invalid email address.',
  };
  return map[code] || 'Authentication error. Please try again.';
}
