import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';
import { postJournalEntry, ensureStandardAccounts } from '../utils/ledger.js';

const router = Router();
router.use(verifyToken);

// ===== CATEGORY → ACCOUNT NAME MAPPING =====
const CATEGORY_ACCOUNT_MAP = {
  'Rent': 'Rent Expense',
  'Office': 'Office Expense',
  'Travel': 'Travel Expense',
  'Salary': 'Salary Expense',
  'Salaries': 'Salary Expense',
  'Utilities': 'Utility Expense',
  'Professional': 'Professional Fees',
};

function categoryToAccount(category) {
  return CATEGORY_ACCOUNT_MAP[category] || 'General Expense';
}

// ===== GET ALL EXPENSES WITH PAGINATION AND MONTHLY FILTERING =====
router.get('/', asyncHandler(async (req, res) => {
  const { month, page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let query = db.collection('expenses');

  if (month) {
    const [year, m] = month.split('-');
    if (!year || !m) {
      throw new ValidationError('Invalid month format', ['Use YYYY-MM format for month parameter']);
    }

    const startDate = `${year}-${m}-01`;
    const nextMonth = parseInt(m, 10) === 12 ? 1 : parseInt(m, 10) + 1;
    const nextYear = parseInt(m, 10) === 12 ? parseInt(year, 10) + 1 : parseInt(year, 10);
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    query = query
      .where('date', '>=', startDate)
      .where('date', '<', endDate);
  }

  try {
    const snapshot = await query.orderBy('date', 'desc').get();
    let expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const total = expenses.length;
    const paginatedExpenses = expenses.slice(offset, offset + limitNum);

    console.log(JSON.stringify({
      level: 'info',
      event: 'expenses_fetched',
      userId: req.user.uid,
      month: month || 'all',
      page: pageNum,
      limit: limitNum,
      total,
      returned: paginatedExpenses.length,
      timestamp: new Date().toISOString()
    }));

    res.json({
      expenses: paginatedExpenses,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'expenses_fetch_fallback',
      error: error.message,
      timestamp: new Date().toISOString()
    }));

    // Fallback without index
    const snapshot = await db.collection('expenses').get();
    let expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    expenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (month) {
      const [year, m] = month.split('-');
      const startDate = `${year}-${m}-01`;
      const nextMonth = parseInt(m, 10) === 12 ? 1 : parseInt(m, 10) + 1;
      const nextYear = parseInt(m, 10) === 12 ? parseInt(year, 10) + 1 : parseInt(year, 10);
      const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
      expenses = expenses.filter(e => e.date >= startDate && e.date < endDate);
    }

    const total = expenses.length;
    const paginatedExpenses = expenses.slice(offset, offset + limitNum);

    res.json({
      expenses: paginatedExpenses,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  }
}));

// ===== GET SINGLE EXPENSE =====
router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('expenses').doc(req.params.id).get();
  if (!doc.exists) {
    throw new NotFoundError('Expense');
  }
  res.json({ id: doc.id, ...doc.data() });
}));

// ===== CREATE EXPENSE =====
router.post('/', validate('createExpense'), asyncHandler(async (req, res) => {
  const { date, amount, category, description, gstAmount, reference } = req.body;

  if (!date || !amount || !category) {
    throw new ValidationError('Expense validation failed', ['date, amount, and category are required']);
  }

  if (amount <= 0) {
    throw new ValidationError('Expense validation failed', ['amount must be greater than 0']);
  }

  const expense = {
    date,
    amount: parseFloat(amount),
    category: String(category).trim(),
    description: description || '',
    gstAmount: gstAmount ? parseFloat(gstAmount) : 0,
    reference: reference || '',
    postedToLedger: false,
    createdBy: req.user.uid,
    createdAt: new Date().toISOString()
  };

  const docRef = await db.collection('expenses').add(expense);

  console.log(JSON.stringify({
    level: 'info',
    event: 'expense_created',
    expenseId: docRef.id,
    userId: req.user.uid,
    amount: expense.amount,
    category: expense.category,
    timestamp: new Date().toISOString()
  }));

  res.status(201).json({ id: docRef.id, ...expense });
}));

// ===== UPDATE EXPENSE =====
router.put('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('expenses').doc(req.params.id).get();
  if (!doc.exists) {
    throw new NotFoundError('Expense');
  }

  const updates = {};
  if (req.body.date !== undefined) updates.date = String(req.body.date);
  if (req.body.amount !== undefined) {
    const amt = parseFloat(req.body.amount);
    if (amt <= 0) {
      throw new ValidationError('Expense validation failed', ['amount must be greater than 0']);
    }
    updates.amount = amt;
  }
  if (req.body.category !== undefined) updates.category = String(req.body.category).trim();
  if (req.body.description !== undefined) updates.description = String(req.body.description);
  if (req.body.gstAmount !== undefined) updates.gstAmount = parseFloat(req.body.gstAmount) || 0;
  if (req.body.reference !== undefined) updates.reference = String(req.body.reference);

  updates.updatedAt = new Date().toISOString();

  await db.collection('expenses').doc(req.params.id).update(updates);

  console.log(JSON.stringify({
    level: 'info',
    event: 'expense_updated',
    expenseId: req.params.id,
    userId: req.user.uid,
    updates: Object.keys(updates),
    timestamp: new Date().toISOString()
  }));

  res.json({ success: true });
}));

// ===== DELETE EXPENSE =====
router.delete('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('expenses').doc(req.params.id).get();
  if (!doc.exists) {
    throw new NotFoundError('Expense');
  }

  await db.collection('expenses').doc(req.params.id).delete();

  console.log(JSON.stringify({
    level: 'info',
    event: 'expense_deleted',
    expenseId: req.params.id,
    userId: req.user.uid,
    timestamp: new Date().toISOString()
  }));

  res.json({ success: true });
}));

// ===== POST EXPENSE TO LEDGER =====
router.post('/:id/post-to-ledger', asyncHandler(async (req, res) => {
  const { gstAmount, category, date } = req.body;

  const expenseDoc = await db.collection('expenses').doc(req.params.id).get();
  if (!expenseDoc.exists) {
    throw new NotFoundError('Expense');
  }

  const expenseData = expenseDoc.data();
  const amount = expenseData.amount || req.body.amount;
  const expCategory = category || expenseData.category;
  const expDate = date || expenseData.date;
  const description = expenseData.description || req.body.description || expCategory;

  if (!amount || !expCategory || !expDate) {
    throw new ValidationError('Ledger posting failed', ['amount, category, and date are required']);
  }

  // Check if already posted
  if (expenseData.postedToLedger) {
    throw new ValidationError('Expense already posted to ledger', []);
  }

  // Ensure standard accounts exist
  await ensureStandardAccounts();

  const baseAmount = Number(amount) - Number(gstAmount || 0);
  const gst = Number(gstAmount || expenseData.gstAmount || 0);
  const expenseAccount = categoryToAccount(expCategory);

  // Build journal entry lines
  const lines = [
    { account: expenseAccount, debit: baseAmount, credit: 0 },
  ];

  if (gst > 0) {
    lines.push(
      { account: 'CGST Input Credit', debit: gst / 2, credit: 0 },
      { account: 'SGST Input Credit', debit: gst / 2, credit: 0 }
    );
  }

  lines.push(
    { account: 'Bank Account', debit: 0, credit: Number(amount) }
  );

  const entry = await postJournalEntry({
    date: expDate,
    description: `Expense: ${description}`,
    reference: req.params.id,
    source: 'expense',
    sourceId: req.params.id,
    lines,
    createdBy: req.user.uid
  });

  // Mark the expense as posted in Firestore
  await db.collection('expenses').doc(req.params.id).update({
    journalEntryId: entry.id,
    journalEntryNumber: entry.entryNumber,
    postedToLedger: true,
    postedAt: new Date().toISOString()
  });

  console.log(JSON.stringify({
    level: 'info',
    event: 'expense_posted_to_ledger',
    expenseId: req.params.id,
    userId: req.user.uid,
    journalEntryId: entry.id,
    journalEntryNumber: entry.entryNumber,
    amount,
    category: expCategory,
    timestamp: new Date().toISOString()
  }));

  res.json({
    success: true,
    journalEntryId: entry.id,
    entryNumber: entry.entryNumber
  });
}));

export default router;
