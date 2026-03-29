/**
 * Production Rate Limiter Middleware
 * In-memory sliding window rate limiter with route-specific limits.
 * For multi-instance deployments, replace with Redis-backed limiter.
 */

const windowStore = new Map();

const CLEANUP_INTERVAL_MS = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entries] of windowStore) {
    const filtered = entries.filter(ts => now - ts < 60_000);
    if (filtered.length === 0) {
      windowStore.delete(key);
    } else {
      windowStore.set(key, filtered);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * @param {Object} opts
 * @param {number} opts.windowMs   – Sliding window in milliseconds (default 60000)
 * @param {number} opts.max        – Max requests per window (default 100)
 * @param {string} [opts.keyPrefix] – Prefix for grouping (e.g. 'auth', 'ai')
 * @param {string} [opts.message]  – Custom error message
 */
export function rateLimit({ windowMs = 60_000, max = 100, keyPrefix = 'global', message } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let entries = windowStore.get(key) || [];
    entries = entries.filter(ts => now - ts < windowMs);
    entries.push(now);
    windowStore.set(key, entries);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entries.length));
    res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

    if (entries.length > max) {
      return res.status(429).json({
        error: message || 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(windowMs / 1000),
      });
    }

    next();
  };
}

/** Preset limiters for common routes */
export const authLimiter = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'auth', message: 'Too many authentication attempts. Please wait 1 minute.' });
export const otpLimiter = rateLimit({ windowMs: 300_000, max: 5, keyPrefix: 'otp', message: 'Too many OTP requests. Please wait 5 minutes.' });
export const aiLimiter = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'ai', message: 'AI request limit reached. Please wait a moment.' });
export const apiLimiter = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'api' });
export const mailLimiter = rateLimit({ windowMs: 60_000, max: 15, keyPrefix: 'mail', message: 'Email sending limit reached. Please wait.' });
export const webhookLimiter = rateLimit({ windowMs: 60_000, max: 200, keyPrefix: 'webhook' });
