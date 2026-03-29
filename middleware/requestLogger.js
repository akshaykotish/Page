/**
 * Production Request Logger Middleware
 * Structured JSON logging with request IDs and timing.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Attach a unique request ID and log request lifecycle.
 */
export function requestLogger() {
  return (req, res, next) => {
    const requestId = req.headers['x-request-id'] || uuidv4();
    const startTime = Date.now();

    req.id = requestId;
    res.setHeader('X-Request-Id', requestId);

    // Log on response finish
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      // Skip health check noise
      if (req.originalUrl === '/api/health') return;

      const logData = {
        level: logLevel,
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.substring(0, 100),
        userId: req.user?.uid || null,
        contentLength: res.getHeader('content-length') || 0,
        timestamp: new Date().toISOString(),
      };

      if (logLevel === 'error') {
        console.error(JSON.stringify(logData));
      } else if (logLevel === 'warn') {
        console.warn(JSON.stringify(logData));
      } else {
        console.log(JSON.stringify(logData));
      }
    });

    next();
  };
}

/**
 * Log slow requests (> threshold ms).
 */
export function slowRequestDetector(thresholdMs = 5000) {
  return (req, res, next) => {
    const startTime = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      if (duration > thresholdMs) {
        console.warn(JSON.stringify({
          level: 'warn',
          type: 'SLOW_REQUEST',
          requestId: req.id,
          method: req.method,
          path: req.originalUrl,
          duration: `${duration}ms`,
          threshold: `${thresholdMs}ms`,
          userId: req.user?.uid,
          timestamp: new Date().toISOString(),
        }));
      }
    });
    next();
  };
}
