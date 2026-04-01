import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Environment Validation ───────────────────────────────────────────────────

const REQUIRED_ENV = ['GEMINI_API_KEY'];
const OPTIONAL_ENV = ['PORT', 'NODE_ENV', 'ZOHO_MAIL_USER', 'ZOHO_MAIL_PASS', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

for (const key of OPTIONAL_ENV) {
  if (!process.env[key]) {
    console.warn(`WARNING: Optional environment variable not set: ${key}`);
  }
}

// ─── App Setup ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Trust proxy for Cloud Run / load balancers
app.set('trust proxy', 1);

// ─── Global Middleware ────────────────────────────────────────────────────────

import { requestLogger, slowRequestDetector } from './middleware/requestLogger.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sanitize } from './middleware/validator.js';

// Request ID and structured logging (replaces morgan)
app.use(requestLogger());
app.use(slowRequestDetector(5000));

// Security headers
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdnjs.cloudflare.com', 'https://www.gstatic.com', 'https://apis.google.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://*.googleapis.com', 'https://*.firebaseio.com', 'wss://*.firebaseio.com', 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://generativelanguage.googleapis.com'],
      frameSrc: ["'self'", 'https://*.firebaseapp.com'],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['https://akshaykotish.com', 'https://www.akshaykotish.com', 'http://localhost:5173', 'http://localhost:8080'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || !isProduction) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-API-Key'],
  maxAge: 86400,
}));

// Compression
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Global sanitization
app.use(sanitize());

// Global rate limiting on API routes
app.use('/api', apiLimiter);

// ─── Ledger Setup ─────────────────────────────────────────────────────────────

import { ensureStandardAccounts } from './utils/ledger.js';

// ─── API Routes ───────────────────────────────────────────────────────────────

import authRoutes from './routes/auth.js';
import billingRoutes from './routes/billing.js';
import paymentRoutes from './routes/payments.js';
import employeeRoutes from './routes/employees.js';
import documentRoutes from './routes/documents.js';
import mailRoutes from './routes/mail.js';
import templateRoutes from './routes/templates.js';
import aiRoutes from './routes/ai.js';
import razorpayRoutes from './routes/razorpay.js';
import payoutRoutes from './routes/payouts.js';
import posteRoutes from './routes/poste.js';
import expenseRoutes from './routes/expenses.js';
import accountingRoutes from './routes/accounting.js';
import loanRoutes from './routes/loans.js';
import clientPortalRoutes from './routes/client-portal.js';
import headerFooterRoutes from './routes/header-footer.js';
import companyRoutes from './routes/companies.js';
import apiGatewayRoutes from './routes/api-gateway.js';
import docDrafterRoutes from './routes/doc-drafter.js';
import stampsSignaturesRoutes from './routes/stamps-signatures.js';

app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/razorpay', razorpayRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/poste', posteRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/client', clientPortalRoutes);
app.use('/api/header-footer', headerFooterRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/gateway', apiGatewayRoutes);
app.use('/api/doc-drafter', docDrafterRoutes);
app.use('/api/stamps-signatures', stampsSignaturesRoutes);

// Ensure standard chart of accounts exists on startup
ensureStandardAccounts().catch(err => {
  console.error(JSON.stringify({
    level: 'error',
    type: 'STARTUP_ERROR',
    message: 'Failed to ensure standard accounts',
    error: err.message,
    timestamp: new Date().toISOString(),
  }));
});

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: NODE_ENV,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
    },
  });
});

// ─── Dynamic Sitemap ──────────────────────────────────────────────────────────

app.get('/sitemap.xml', (req, res) => {
  const host = req.headers.host?.includes('akshaykotish.com')
    ? 'https://akshaykotish.com'
    : `https://${req.headers.host}`;
  const today = new Date().toISOString().split('T')[0];

  const pages = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/#about', priority: '0.8', changefreq: 'monthly' },
    { loc: '/#products', priority: '0.9', changefreq: 'weekly' },
    { loc: '/#services', priority: '0.8', changefreq: 'monthly' },
    { loc: '/#innovation', priority: '0.7', changefreq: 'monthly' },
    { loc: '/#achievements', priority: '0.7', changefreq: 'monthly' },
    { loc: '/#contact', priority: '0.8', changefreq: 'monthly' },
    { loc: '/dashboard/', priority: '0.5', changefreq: 'daily' },
    { loc: '/support', priority: '0.6', changefreq: 'monthly' },
    { loc: '/privacy', priority: '0.4', changefreq: 'yearly' },
    { loc: '/terms', priority: '0.4', changefreq: 'yearly' },
    { loc: '/deletion', priority: '0.3', changefreq: 'yearly' },
    { loc: '/api-docs', priority: '0.6', changefreq: 'monthly' },
  ];

  const products = [
    { url: 'https://lawms.in', name: 'LawMS' },
    { url: 'https://petscare.club', name: 'PetsCare' },
    { url: 'https://zetsgeo.com', name: 'ZetsGeo' },
    { url: 'https://blog.akshaykotish.com', name: 'Blog' },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.map(p => `  <url>
    <loc>${host}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
${products.map(p => `  <url>
    <loc>${p.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n')}
</urlset>`;

  res.set('Content-Type', 'application/xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(xml);
});

// ─── Robots.txt ───────────────────────────────────────────────────────────────

app.get('/robots.txt', (req, res) => {
  const host = req.headers.host?.includes('akshaykotish.com')
    ? 'https://akshaykotish.com'
    : `https://${req.headers.host}`;
  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(`User-agent: *
Allow: /
Disallow: /dashboard/
Disallow: /api/

Sitemap: ${host}/sitemap.xml
`);
});

// ─── Static Pages ─────────────────────────────────────────────────────────────

app.get('/api-docs', (req, res) => res.sendFile(path.join(__dirname, 'public/api-docs.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'public/support.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public/privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public/terms.html')));
app.get('/deletion', (req, res) => res.sendFile(path.join(__dirname, 'public/deletion.html')));

// ─── Static Assets ────────────────────────────────────────────────────────────

const staticOptions = {
  maxAge: isProduction ? '7d' : 0,
  etag: true,
  lastModified: true,
};

app.use('/images', express.static(path.join(__dirname, 'images'), staticOptions));
app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/dashboard', express.static(path.join(__dirname, 'client/dist'), {
  ...staticOptions,
  index: 'index.html',
}));

// SPA fallback for React Router
app.get('/dashboard/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

// Root fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ─── API 404 Handler ──────────────────────────────────────────────────────────

app.all('/api/*', notFoundHandler);

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Server Startup ───────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(JSON.stringify({
    level: 'info',
    type: 'SERVER_START',
    message: `Akshay Kotish & Co. ERP running on port ${PORT}`,
    environment: NODE_ENV,
    pid: process.pid,
    node: process.version,
    timestamp: new Date().toISOString(),
  }));
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 15_000;

function gracefulShutdown(signal) {
  console.log(JSON.stringify({
    level: 'info',
    type: 'SHUTDOWN',
    message: `Received ${signal}. Starting graceful shutdown...`,
    timestamp: new Date().toISOString(),
  }));

  server.close(() => {
    console.log(JSON.stringify({
      level: 'info',
      type: 'SHUTDOWN_COMPLETE',
      message: 'All connections closed. Process exiting.',
      timestamp: new Date().toISOString(),
    }));
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    console.error(JSON.stringify({
      level: 'error',
      type: 'SHUTDOWN_FORCED',
      message: `Forced shutdown after ${SHUTDOWN_TIMEOUT_MS}ms timeout`,
      timestamp: new Date().toISOString(),
    }));
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Unhandled Errors ─────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason, promise) => {
  console.error(JSON.stringify({
    level: 'error',
    type: 'UNHANDLED_REJECTION',
    message: reason?.message || String(reason),
    stack: reason?.stack,
    timestamp: new Date().toISOString(),
  }));
});

process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({
    level: 'fatal',
    type: 'UNCAUGHT_EXCEPTION',
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  }));
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

export default app;
