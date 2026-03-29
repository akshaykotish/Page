import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';
import { validateQuery } from '../middleware/validator.js';
import { getTrialBalance, recalculateBalances } from '../utils/ledger.js';
import { db } from '../firebase-admin.js';

const router = Router();
router.use(verifyToken);

// ─── Helper: Pagination defaults ──────────────────────────────────────────────

function getPaginationParams(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ─── Validate date format helper ──────────────────────────────────────────────

function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

// ─── Get trial balance with date range filters ───────────────────────────────

router.get('/trial-balance', validateQuery({ startDate: 'optionalString', endDate: 'optionalString' }), asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  // Validate date range if provided
  if (startDate && !isValidDate(startDate)) {
    throw new ValidationError('Invalid startDate format. Use YYYY-MM-DD');
  }
  if (endDate && !isValidDate(endDate)) {
    throw new ValidationError('Invalid endDate format. Use YYYY-MM-DD');
  }

  if (startDate && endDate && startDate > endDate) {
    throw new ValidationError('startDate must be before or equal to endDate');
  }

  const tb = await getTrialBalance();

  // Filter trial balance by date range if provided
  let filtered = tb;
  if (startDate || endDate) {
    filtered = {
      ...tb,
      accounts: (tb.accounts || []).filter(acc => {
        const accDate = acc.date || acc.lastUpdate;
        if (!accDate) return true;
        if (startDate && accDate < startDate) return false;
        if (endDate && accDate > endDate) return false;
        return true;
      })
    };
  }

  console.info(JSON.stringify({
    level: 'info',
    action: 'get_trial_balance',
    userId: req.user.uid,
    filters: { startDate: !!startDate, endDate: !!endDate },
    accountCount: filtered.accounts?.length || 0,
    timestamp: new Date().toISOString(),
  }));

  res.json(filtered);
}));

// ─── Recalculate balances ────────────────────────────────────────────────────

router.post('/recalculate', asyncHandler(async (req, res) => {
  try {
    const result = await recalculateBalances();

    console.info(JSON.stringify({
      level: 'info',
      action: 'recalculate_balances',
      result: result?.status || 'completed',
      accountsUpdated: result?.accountsUpdated || 0,
      userId: req.user.uid,
      timestamp: new Date().toISOString(),
    }));

    res.json({
      success: true,
      message: 'Balances recalculated successfully',
      result
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      action: 'recalculate_balances',
      error: error.message,
      userId: req.user.uid,
      timestamp: new Date().toISOString(),
    }));

    throw new Error(`Failed to recalculate balances: ${error.message}`);
  }
}));

// ─── Get journal entries with pagination ──────────────────────────────────────

router.get('/journal-entries', validateQuery({ page: 'optionalString', limit: 'optionalString', startDate: 'optionalString', endDate: 'optionalString', account: 'optionalString' }), asyncHandler(async (req, res) => {
  const { skip, limit, page } = getPaginationParams(req);
  const { startDate, endDate, account } = req.query;

  // Validate date range if provided
  if (startDate && !isValidDate(startDate)) {
    throw new ValidationError('Invalid startDate format. Use YYYY-MM-DD');
  }
  if (endDate && !isValidDate(endDate)) {
    throw new ValidationError('Invalid endDate format. Use YYYY-MM-DD');
  }

  if (startDate && endDate && startDate > endDate) {
    throw new ValidationError('startDate must be before or equal to endDate');
  }

  let query = db.collection('journal_entries');

  // Apply date range filters if provided
  if (startDate) {
    query = query.where('date', '>=', startDate);
  }
  if (endDate) {
    query = query.where('date', '<=', endDate);
  }

  const snapshot = await query.orderBy('date', 'desc').get();
  let docs = snapshot.docs;

  // Filter by account if provided
  if (account) {
    const accountLower = account.toLowerCase();
    docs = docs.filter(doc => {
      const data = doc.data();
      return (data.lines || []).some(line =>
        (line.account || '').toLowerCase().includes(accountLower)
      );
    });
  }

  const total = docs.length;
  const paginated = docs.slice(skip, skip + limit);

  console.info(JSON.stringify({
    level: 'info',
    action: 'list_journal_entries',
    userId: req.user.uid,
    filters: { startDate: !!startDate, endDate: !!endDate, account: !!account },
    pagination: { page, limit, total },
    timestamp: new Date().toISOString(),
  }));

  res.json({
    data: paginated.map(doc => ({ id: doc.id, ...doc.data() })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
}));

export default router;
