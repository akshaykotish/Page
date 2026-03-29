import { Router } from 'express';
import admin from '../firebase-admin.js';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';
import { postJournalEntry, reverseJournalEntry } from '../utils/ledger.js';

const FieldValue = admin.firestore.FieldValue;
const router = Router();
router.use(verifyToken);

// ===== HELPER: CALCULATE EMI USING STANDARD FORMULA =====
// EMI = P * r * (1+r)^n / ((1+r)^n - 1)
function calculateEMI(principal, annualRate, tenureMonths) {
  if (annualRate === 0) return principal / tenureMonths;
  const r = annualRate / 12 / 100;
  const n = tenureMonths;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

// ===== HELPER: GENERATE AMORTIZATION SCHEDULE =====
function generateSchedule(principal, annualRate, tenureMonths, startDate) {
  const emi = calculateEMI(principal, annualRate, tenureMonths);
  const r = annualRate / 12 / 100;
  let balance = principal;
  const schedule = [];

  for (let i = 1; i <= tenureMonths; i++) {
    const interest = annualRate === 0 ? 0 : balance * r;
    const principalPart = emi - interest;
    balance = Math.max(0, balance - principalPart);

    // Calculate due date
    const due = new Date(startDate);
    due.setMonth(due.getMonth() + i);
    const dueDate = due.toISOString().slice(0, 10);

    schedule.push({
      emiNumber: i,
      dueDate,
      emiAmount: Math.round(emi * 100) / 100,
      principalComponent: Math.round(principalPart * 100) / 100,
      interestComponent: Math.round(interest * 100) / 100,
      remainingBalance: Math.round(balance * 100) / 100,
      status: 'pending',
    });
  }
  return schedule;
}

// ===== GET ALL LOANS WITH PAGINATION =====
router.get('/', asyncHandler(async (req, res) => {
  const { page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const snap = await db.collection('loans').orderBy('createdAt', 'desc').get();
  const loans = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const total = loans.length;
  const paginatedLoans = loans.slice(offset, offset + limitNum);

  console.log(JSON.stringify({
    level: 'info',
    event: 'loans_fetched',
    userId: req.user.uid,
    page: pageNum,
    limit: limitNum,
    total,
    returned: paginatedLoans.length,
    timestamp: new Date().toISOString()
  }));

  res.json({
    loans: paginatedLoans,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum)
    }
  });
}));

// ===== GET SINGLE LOAN WITH PAYMENT HISTORY =====
router.get('/:id', asyncHandler(async (req, res) => {
  const loanDoc = await db.collection('loans').doc(req.params.id).get();
  if (!loanDoc.exists) {
    throw new NotFoundError('Loan');
  }

  const paySnap = await db.collection('loan_payments')
    .where('loanId', '==', req.params.id)
    .orderBy('emiNumber', 'asc')
    .get();
  const payments = paySnap.docs.map(d => ({ id: d.id, ...d.data() }));

  res.json({ id: loanDoc.id, ...loanDoc.data(), payments });
}));

// ===== CREATE NEW LOAN =====
router.post('/', validate('createLoan'), asyncHandler(async (req, res) => {
  const { lenderName, loanType, principalAmount, interestRate, tenure, startDate, description, reference } = req.body;

  if (!lenderName || !principalAmount || !tenure || !startDate) {
    throw new ValidationError('Loan validation failed', ['lenderName, principalAmount, tenure, and startDate are required']);
  }

  const principal = parseFloat(principalAmount);
  const rate = parseFloat(interestRate) || 0;
  const months = parseInt(tenure);

  if (principal <= 0) {
    throw new ValidationError('Loan validation failed', ['principalAmount must be greater than 0']);
  }

  if (months <= 0) {
    throw new ValidationError('Loan validation failed', ['tenure must be greater than 0']);
  }

  if (rate < 0) {
    throw new ValidationError('Loan validation failed', ['interestRate cannot be negative']);
  }

  const emi = calculateEMI(principal, rate, months);
  const totalInterest = (emi * months) - principal;

  // End date calculation
  const end = new Date(startDate);
  end.setMonth(end.getMonth() + months);

  const loanData = {
    lenderName: lenderName.trim(),
    loanType: loanType || 'Other',
    principalAmount: principal,
    interestRate: rate,
    tenure: months,
    emiAmount: Math.round(emi * 100) / 100,
    startDate,
    endDate: end.toISOString().slice(0, 10),
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalPayable: Math.round((principal + totalInterest) * 100) / 100,
    remainingPrincipal: principal,
    paidEMIs: 0,
    status: 'active',
    description: (description || '').trim(),
    reference: (reference || '').trim(),
    postedToLedger: false,
    createdBy: req.user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('loans').add(loanData);

  // Generate EMI schedule entries
  const schedule = generateSchedule(principal, rate, months, startDate);
  const batch = db.batch();
  for (const emiData of schedule) {
    const ref = db.collection('loan_payments').doc();
    batch.set(ref, {
      loanId: docRef.id,
      ...emiData,
      paymentMethod: '',
      paymentReference: '',
      paidDate: null,
      postedToLedger: false,
      journalEntryId: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  console.log(JSON.stringify({
    level: 'info',
    event: 'loan_created',
    loanId: docRef.id,
    userId: req.user.uid,
    lenderName,
    principalAmount: principal,
    tenure: months,
    emiAmount: loanData.emiAmount,
    timestamp: new Date().toISOString()
  }));

  res.status(201).json({ id: docRef.id, ...loanData, emiAmount: loanData.emiAmount });
}));

// ===== RECORD LOAN DISBURSEMENT =====
// Debit: Bank Account, Credit: Loan Payable
router.post('/:id/disburse', asyncHandler(async (req, res) => {
  const loanDoc = await db.collection('loans').doc(req.params.id).get();
  if (!loanDoc.exists) {
    throw new NotFoundError('Loan');
  }

  const loan = loanDoc.data();
  if (loan.postedToLedger) {
    throw new ValidationError('Loan already posted', ['This loan has already been posted to the ledger']);
  }

  const je = await postJournalEntry({
    date: loan.startDate,
    description: `Loan received from ${loan.lenderName} — ${loan.reference || loan.loanType}`,
    reference: `LOAN-${req.params.id.substring(0, 8).toUpperCase()}`,
    source: 'loan',
    sourceId: req.params.id,
    lines: [
      { account: 'Bank Account', debit: loan.principalAmount, credit: 0 },
      { account: 'Loan Payable', debit: 0, credit: loan.principalAmount },
    ],
    createdBy: req.user.uid,
  });

  await db.collection('loans').doc(req.params.id).update({
    postedToLedger: true,
    journalEntryId: je.id,
    journalEntryNumber: je.entryNumber,
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log(JSON.stringify({
    level: 'info',
    event: 'loan_disbursed',
    loanId: req.params.id,
    userId: req.user.uid,
    journalEntryId: je.id,
    amount: loan.principalAmount,
    timestamp: new Date().toISOString()
  }));

  res.json({ success: true, journalEntry: je });
}));

// ===== RECORD EMI PAYMENT =====
// Debit: Loan Payable (principal), Debit: Interest Expense, Credit: Bank Account
router.post('/:id/pay-emi', asyncHandler(async (req, res) => {
  const { paymentId, paymentMethod, paymentReference } = req.body;

  if (!paymentId) {
    throw new ValidationError('EMI payment validation failed', ['paymentId (loan_payments doc ID) is required']);
  }

  const loanDoc = await db.collection('loans').doc(req.params.id).get();
  if (!loanDoc.exists) {
    throw new NotFoundError('Loan');
  }
  const loan = loanDoc.data();

  const payDoc = await db.collection('loan_payments').doc(paymentId).get();
  if (!payDoc.exists) {
    throw new NotFoundError('EMI payment record');
  }

  const emiData = payDoc.data();
  if (emiData.status === 'paid') {
    throw new ValidationError('EMI already paid', ['This EMI installment has already been paid']);
  }

  const today = new Date().toISOString().slice(0, 10);

  // Post journal entry
  const lines = [];
  if (emiData.principalComponent > 0) {
    lines.push({ account: 'Loan Payable', debit: emiData.principalComponent, credit: 0 });
  }
  if (emiData.interestComponent > 0) {
    lines.push({ account: 'Interest Expense', debit: emiData.interestComponent, credit: 0 });
  }
  lines.push({ account: 'Bank Account', debit: 0, credit: emiData.emiAmount });

  const je = await postJournalEntry({
    date: today,
    description: `EMI #${emiData.emiNumber} for loan from ${loan.lenderName}`,
    reference: `LOAN-${req.params.id.substring(0, 8).toUpperCase()}-EMI${emiData.emiNumber}`,
    source: 'loan_emi',
    sourceId: paymentId,
    lines,
    createdBy: req.user.uid,
  });

  // Update EMI payment record
  await db.collection('loan_payments').doc(paymentId).update({
    status: 'paid',
    paidDate: today,
    paymentMethod: paymentMethod || '',
    paymentReference: paymentReference || '',
    postedToLedger: true,
    journalEntryId: je.id,
    journalEntryNumber: je.entryNumber,
  });

  // Update loan remaining principal & paid count
  const newRemaining = Math.max(0, (loan.remainingPrincipal || loan.principalAmount) - emiData.principalComponent);
  const newPaidEMIs = (loan.paidEMIs || 0) + 1;
  const updates = {
    remainingPrincipal: Math.round(newRemaining * 100) / 100,
    paidEMIs: newPaidEMIs,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (newPaidEMIs >= loan.tenure) {
    updates.status = 'closed';
  }
  await db.collection('loans').doc(req.params.id).update(updates);

  console.log(JSON.stringify({
    level: 'info',
    event: 'emi_paid',
    loanId: req.params.id,
    userId: req.user.uid,
    emiNumber: emiData.emiNumber,
    emiAmount: emiData.emiAmount,
    journalEntryId: je.id,
    timestamp: new Date().toISOString()
  }));

  res.json({ success: true, journalEntry: je });
}));

// ===== DELETE LOAN AND ITS SCHEDULE =====
router.delete('/:id', asyncHandler(async (req, res) => {
  const loanDoc = await db.collection('loans').doc(req.params.id).get();
  if (!loanDoc.exists) {
    throw new NotFoundError('Loan');
  }

  const loan = loanDoc.data();

  // Reverse disbursement journal entry if it was posted
  if (loan.postedToLedger && loan.journalEntryId) {
    try {
      await reverseJournalEntry(loan.journalEntryId, 'Loan deleted', req.user.uid);
    } catch (revErr) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'loan_reversal_failed',
        loanId: req.params.id,
        journalEntryId: loan.journalEntryId,
        error: revErr.message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  // Delete all EMI payment records
  const paySnap = await db.collection('loan_payments').where('loanId', '==', req.params.id).get();
  const batch = db.batch();
  paySnap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(db.collection('loans').doc(req.params.id));
  await batch.commit();

  console.log(JSON.stringify({
    level: 'info',
    event: 'loan_deleted',
    loanId: req.params.id,
    userId: req.user.uid,
    lenderName: loan.lenderName,
    principalAmount: loan.principalAmount,
    timestamp: new Date().toISOString()
  }));

  res.json({ success: true });
}));

export default router;
