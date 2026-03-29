/**
 * Production Input Validation Middleware
 * Centralized request validation with schema definitions.
 */

// ─── Sanitization helpers ─────────────────────────────────────────────────────

function sanitizeString(val) {
  if (typeof val !== 'string') return val;
  return val.trim().replace(/[<>]/g, '');
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      clean[key] = sanitizeString(val);
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = sanitizeObject(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

// ─── Validation rules ─────────────────────────────────────────────────────────

const RULES = {
  email: (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  phone: (v) => typeof v === 'string' && /^\+?\d{10,15}$/.test(v.replace(/[\s-]/g, '')),
  otp: (v) => typeof v === 'string' && /^\d{6}$/.test(v.trim()),
  string: (v) => typeof v === 'string' && v.trim().length > 0,
  optionalString: (v) => v === undefined || v === null || v === '' || typeof v === 'string',
  number: (v) => typeof v === 'number' && !isNaN(v) && isFinite(v),
  positiveNumber: (v) => typeof v === 'number' && v > 0 && isFinite(v),
  nonNegativeNumber: (v) => typeof v === 'number' && v >= 0 && isFinite(v),
  date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)),
  array: (v) => Array.isArray(v) && v.length > 0,
  optionalArray: (v) => v === undefined || v === null || Array.isArray(v),
  boolean: (v) => typeof v === 'boolean',
  role: (v) => ['superadmin', 'admin', 'employee', 'client'].includes(v),
  status: (v) => ['active', 'inactive'].includes(v),
  invoiceStatus: (v) => ['draft', 'sent', 'paid', 'overdue', 'cancelled'].includes(v),
  paymentType: (v) => ['incoming', 'outgoing'].includes(v),
  paymentMethod: (v) => ['bank', 'cash', 'upi', 'cheque', 'razorpay', 'other'].includes(v),
  docType: (v) => ['letter', 'invoice', 'notice', 'agreement', 'general'].includes(v),
  templateType: (v) => ['letterhead', 'bill_header'].includes(v),
  gstin: (v) => typeof v === 'string' && /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d{1}[A-Z]{1}\d{1}$/.test(v.trim().toUpperCase()),
  pan: (v) => typeof v === 'string' && /^[A-Z]{5}\d{4}[A-Z]{1}$/.test(v.trim().toUpperCase()),
  ifsc: (v) => typeof v === 'string' && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.trim().toUpperCase()),
  uuid: (v) => typeof v === 'string' && v.trim().length >= 10,
  mongoId: (v) => typeof v === 'string' && v.trim().length >= 10,
};

// ─── Validation schemas ──────────────────────────────────────────────────────

export const schemas = {
  // Auth
  emailOtp: { email: 'email' },
  verifyOtp: { email: 'email', otp: 'otp' },
  createUser: { name: 'string', role: 'role' },
  updateUser: { name: 'optionalString' },

  // Billing — only validate required fields; items are validated in route
  createInvoice: {
    'customer.name': 'string',
  },
  sendInvoiceEmail: { to: 'email' },

  // Employees
  createEmployee: { name: 'string' },
  markAttendance: { employeeId: 'string', date: 'date', status: 'string' },
  createPayroll: { employeeId: 'string', month: 'string' },

  // Documents
  createDocument: { title: 'string', type: 'docType' },
  sendDocumentEmail: { to: 'email', subject: 'string' },

  // Mail
  sendMail: { to: 'email', subject: 'string' },

  // Templates
  createTemplate: { name: 'string', type: 'templateType' },

  // AI — frontend sends { prompt, conversationHistory }
  aiCommand: { prompt: 'string' },

  // Payments
  createPayment: { amount: 'positiveNumber', type: 'paymentType' },

  // Expenses
  createExpense: { date: 'date', amount: 'positiveNumber', category: 'string' },

  // Loans
  createLoan: { principalAmount: 'positiveNumber', interestRate: 'nonNegativeNumber', tenure: 'positiveNumber' },
};

// ─── Validation middleware factory ────────────────────────────────────────────

/**
 * Validate request body against a named schema or an inline rules object.
 * @param {string|Object} schemaNameOrRules
 */
export function validate(schemaNameOrRules) {
  const rules = typeof schemaNameOrRules === 'string'
    ? schemas[schemaNameOrRules]
    : schemaNameOrRules;

  if (!rules) {
    console.warn(`Validator: unknown schema "${schemaNameOrRules}"`);
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    // Sanitize body
    req.body = sanitizeObject(req.body);

    const errors = [];

    for (const [fieldPath, ruleName] of Object.entries(rules)) {
      const rule = typeof ruleName === 'function' ? ruleName : RULES[ruleName];
      if (!rule) {
        errors.push(`Unknown validation rule: ${ruleName}`);
        continue;
      }

      // Support dot-notation for nested fields
      const value = fieldPath.split('.').reduce((obj, key) => obj?.[key], req.body);

      // Skip optional fields that are absent
      if ((ruleName === 'optionalString' || ruleName === 'optionalArray') && (value === undefined || value === null)) {
        continue;
      }

      if (!rule(value)) {
        errors.push(`Invalid or missing field: ${fieldPath}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    next();
  };
}

/**
 * Validate query parameters.
 */
export function validateQuery(rules) {
  return (req, res, next) => {
    const errors = [];
    for (const [param, ruleName] of Object.entries(rules)) {
      const value = req.query[param];
      if (value === undefined) continue; // query params are optional by default
      const rule = RULES[ruleName];
      if (rule && !rule(value)) {
        errors.push(`Invalid query parameter: ${param}`);
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Invalid query parameters', details: errors });
    }
    next();
  };
}

/**
 * Sanitize middleware — strips HTML from all string fields.
 */
export function sanitize() {
  return (req, res, next) => {
    if (req.body) req.body = sanitizeObject(req.body);
    next();
  };
}

export { RULES };
