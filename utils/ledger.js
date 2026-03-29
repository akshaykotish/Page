import admin from '../firebase-admin.js';
import { db } from '../firebase-admin.js';

const FieldValue = admin.firestore.FieldValue;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(str) {
  return (str || '').trim().toLowerCase();
}

/**
 * Determine the sign multiplier for an account type.
 * Asset & expense: debit-normal  (debit +, credit -)
 * Liability, equity & revenue: credit-normal (credit +, debit -)
 */
function signMultiplier(accountType) {
  const type = normalize(accountType);
  if (type === 'asset' || type === 'expense') return 1;
  return -1;
}

// ─── Audit Logger ─────────────────────────────────────────────────────────────

function logLedgerEvent(event, data) {
  console.log(JSON.stringify({
    level: 'info',
    type: 'LEDGER',
    event,
    ...data,
    timestamp: new Date().toISOString(),
  }));
}

function logLedgerError(event, error, data = {}) {
  console.error(JSON.stringify({
    level: 'error',
    type: 'LEDGER',
    event,
    error: error.message,
    ...data,
    timestamp: new Date().toISOString(),
  }));
}

// ─── postJournalEntry ─────────────────────────────────────────────────────────

/**
 * Post a journal entry and update account balances atomically.
 *
 * @param {Object}  params
 * @param {string}  params.date        – YYYY-MM-DD
 * @param {string}  params.description – Entry description
 * @param {string}  params.reference   – Reference document (invoice number, payment ID, etc.)
 * @param {string}  params.source      – Source module: 'invoice','payment','expense','payroll','manual','razorpay'
 * @param {string}  params.sourceId    – ID of the source document
 * @param {Array}   params.lines       – Array of { account, debit, credit }
 * @param {string}  params.createdBy   – User ID
 * @returns {Promise<{id: string, entryNumber: string}>}
 */
export async function postJournalEntry({ date, description, reference, source, sourceId, lines, createdBy }) {
  // ── Validate inputs ────────────────────────────────────────────────────────
  if (!date || !description || !source || !Array.isArray(lines) || lines.length === 0) {
    throw new Error('postJournalEntry: date, description, source, and at least one line are required.');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('postJournalEntry: date must be in YYYY-MM-DD format.');
  }

  if (lines.length > 50) {
    throw new Error('postJournalEntry: maximum 50 lines per journal entry.');
  }

  const totalDebit  = lines.reduce((sum, l) => sum + (Number(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `postJournalEntry: debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)}).`
    );
  }

  if (totalDebit <= 0) {
    throw new Error('postJournalEntry: entry total must be greater than zero.');
  }

  // ── Resolve accounts ───────────────────────────────────────────────────────
  const resolvedLines = [];
  for (const line of lines) {
    if (!line.account) throw new Error('postJournalEntry: every line must have an account name or code.');

    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;

    if (debit < 0 || credit < 0) {
      throw new Error(`postJournalEntry: negative amounts not allowed for account "${line.account}".`);
    }

    if (debit === 0 && credit === 0) {
      throw new Error(`postJournalEntry: line for account "${line.account}" has zero debit and credit.`);
    }

    const acct = await findAccount(line.account);
    if (!acct) {
      throw new Error(`postJournalEntry: account "${line.account}" not found. Run ensureStandardAccounts() first or create it manually.`);
    }

    resolvedLines.push({
      accountId:   acct.id,
      accountCode: acct.code,
      accountName: acct.name,
      accountType: acct.type,
      debit,
      credit,
    });
  }

  // ── Atomic transaction ─────────────────────────────────────────────────────
  const counterRef = db.collection('counters').doc('journal_entries');
  const result = await db.runTransaction(async (txn) => {
    const counterSnap = await txn.get(counterRef);
    let nextNum = 1;
    if (counterSnap.exists) {
      nextNum = (counterSnap.data().current || 0) + 1;
    }
    const entryNumber = `JE-${String(nextNum).padStart(4, '0')}`;

    const entryRef = db.collection('journal_entries').doc();
    const entryData = {
      entryNumber,
      date,
      description,
      reference: reference || '',
      source,
      sourceId: sourceId || '',
      lines: resolvedLines,
      totalDebit:  Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      reversed: false,
      createdBy: createdBy || '',
      createdAt: FieldValue.serverTimestamp(),
    };
    txn.set(entryRef, entryData);

    txn.set(counterRef, { current: nextNum }, { merge: true });

    for (const line of resolvedLines) {
      const acctRef = db.collection('accounts').doc(line.accountId);
      const delta = (line.debit - line.credit) * signMultiplier(line.accountType);
      txn.update(acctRef, { balance: FieldValue.increment(delta) });
    }

    return { id: entryRef.id, entryNumber };
  });

  logLedgerEvent('JOURNAL_POSTED', {
    entryNumber: result.entryNumber,
    entryId: result.id,
    source,
    sourceId,
    reference,
    totalDebit: Math.round(totalDebit * 100) / 100,
    linesCount: resolvedLines.length,
    createdBy,
  });

  return result;
}

// ─── reverseJournalEntry ──────────────────────────────────────────────────────

/**
 * Reverse a journal entry (e.g., when deleting an invoice).
 */
export async function reverseJournalEntry(entryId, reason, createdBy) {
  if (!entryId) throw new Error('reverseJournalEntry: entryId is required.');

  const origRef  = db.collection('journal_entries').doc(entryId);
  const origSnap = await origRef.get();

  if (!origSnap.exists) {
    throw new Error(`reverseJournalEntry: journal entry "${entryId}" not found.`);
  }

  const orig = origSnap.data();

  if (orig.reversed) {
    throw new Error(`reverseJournalEntry: entry "${entryId}" (${orig.entryNumber}) is already reversed.`);
  }

  const reversedLines = (orig.lines || []).map((l) => ({
    ...l,
    debit:  l.credit,
    credit: l.debit,
  }));

  const counterRef = db.collection('counters').doc('journal_entries');

  const result = await db.runTransaction(async (txn) => {
    const counterSnap = await txn.get(counterRef);
    let nextNum = 1;
    if (counterSnap.exists) {
      nextNum = (counterSnap.data().current || 0) + 1;
    }
    const entryNumber = `JE-${String(nextNum).padStart(4, '0')}`;

    const revRef = db.collection('journal_entries').doc();
    txn.set(revRef, {
      entryNumber,
      date: new Date().toISOString().slice(0, 10),
      description: `Reversal of ${orig.entryNumber}: ${reason || ''}`.trim(),
      reference: orig.reference || '',
      source: orig.source,
      sourceId: orig.sourceId || '',
      lines: reversedLines,
      totalDebit:  orig.totalCredit,
      totalCredit: orig.totalDebit,
      reversed: false,
      reversalOf: entryId,
      createdBy: createdBy || '',
      createdAt: FieldValue.serverTimestamp(),
    });

    txn.update(origRef, { reversed: true, reversedBy: revRef.id });
    txn.set(counterRef, { current: nextNum }, { merge: true });

    for (const line of reversedLines) {
      const acctRef = db.collection('accounts').doc(line.accountId);
      const delta = (line.debit - line.credit) * signMultiplier(line.accountType);
      txn.update(acctRef, { balance: FieldValue.increment(delta) });
    }

    return { id: revRef.id, entryNumber };
  });

  logLedgerEvent('JOURNAL_REVERSED', {
    originalEntryId: entryId,
    originalEntryNumber: orig.entryNumber,
    reversalEntryId: result.id,
    reversalEntryNumber: result.entryNumber,
    reason,
    createdBy,
  });

  return result;
}

// ─── ensureStandardAccounts ───────────────────────────────────────────────────

export async function ensureStandardAccounts() {
  const standardAccounts = [
    { code: '1001', name: 'Cash',                     type: 'asset' },
    { code: '1002', name: 'Bank Account',              type: 'asset' },
    { code: '1003', name: 'Razorpay Account',          type: 'asset' },
    { code: '1100', name: 'Accounts Receivable',       type: 'asset' },
    { code: '2001', name: 'Accounts Payable',          type: 'liability' },
    { code: '2100', name: 'CGST Payable',              type: 'liability' },
    { code: '2101', name: 'SGST Payable',              type: 'liability' },
    { code: '2102', name: 'IGST Payable',              type: 'liability' },
    { code: '2103', name: 'CGST Input Credit',         type: 'asset' },
    { code: '2104', name: 'SGST Input Credit',         type: 'asset' },
    { code: '2105', name: 'IGST Input Credit',         type: 'asset' },
    { code: '2200', name: 'Salary Payable',            type: 'liability' },
    { code: '2201', name: 'PF Payable',                type: 'liability' },
    { code: '2202', name: 'Professional Tax Payable',  type: 'liability' },
    { code: '2300', name: 'TDS Payable',               type: 'liability' },
    { code: '2400', name: 'Loan Payable',              type: 'liability' },
    { code: '3001', name: 'Owners Equity',             type: 'equity' },
    { code: '3002', name: 'Retained Earnings',         type: 'equity' },
    { code: '4001', name: 'Sales Revenue',             type: 'revenue' },
    { code: '4002', name: 'Service Revenue',           type: 'revenue' },
    { code: '4003', name: 'Other Income',              type: 'revenue' },
    { code: '5001', name: 'Salary Expense',            type: 'expense' },
    { code: '5002', name: 'Rent Expense',              type: 'expense' },
    { code: '5003', name: 'Office Expense',            type: 'expense' },
    { code: '5004', name: 'Travel Expense',            type: 'expense' },
    { code: '5005', name: 'Utility Expense',           type: 'expense' },
    { code: '5006', name: 'Professional Fees',         type: 'expense' },
    { code: '5007', name: 'Interest Expense',          type: 'expense' },
    { code: '5099', name: 'General Expense',           type: 'expense' },
  ];

  const created  = [];
  const existing = [];

  for (const acct of standardAccounts) {
    const snap = await db.collection('accounts')
      .where('code', '==', acct.code)
      .limit(1)
      .get();

    if (!snap.empty) {
      existing.push(acct.code);
      continue;
    }

    await db.collection('accounts').add({
      code:           acct.code,
      name:           acct.name,
      type:           acct.type,
      balance:        0,
      openingBalance: 0,
      createdAt:      FieldValue.serverTimestamp(),
    });
    created.push(acct.code);
  }

  if (created.length > 0) {
    logLedgerEvent('ACCOUNTS_CREATED', { count: created.length, codes: created });
  }
  if (existing.length > 0) {
    logLedgerEvent('ACCOUNTS_VERIFIED', { count: existing.length });
  }

  return { created, existing };
}

// ─── findAccount ──────────────────────────────────────────────────────────────

// Account cache to avoid repeated full-collection scans
let _accountCache = null;
let _accountCacheTimestamp = 0;
const ACCOUNT_CACHE_TTL_MS = 5 * 60 * 1000;

async function getAllAccounts() {
  const now = Date.now();
  if (_accountCache && now - _accountCacheTimestamp < ACCOUNT_CACHE_TTL_MS) {
    return _accountCache;
  }
  const snap = await db.collection('accounts').get();
  _accountCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  _accountCacheTimestamp = now;
  return _accountCache;
}

export function invalidateAccountCache() {
  _accountCache = null;
  _accountCacheTimestamp = 0;
}

/**
 * Find an account by name or code.
 *
 * Search order:
 *  1. Exact code match
 *  2. Exact name match (case-insensitive)
 *  3. Fuzzy name match (contains, case-insensitive)
 */
export async function findAccount(nameOrCode) {
  if (!nameOrCode) {
    console.warn('findAccount: called with empty nameOrCode.');
    return null;
  }

  const input = normalize(nameOrCode);
  const allAccounts = await getAllAccounts();

  // 1. Exact code match
  const byCode = allAccounts.find((a) => a.code === nameOrCode.trim());
  if (byCode) return byCode;

  // 2. Exact name match (case-insensitive)
  const exactName = allAccounts.find((a) => normalize(a.name) === input);
  if (exactName) return exactName;

  // 3. Fuzzy match: name contains the input
  const fuzzy = allAccounts.find((a) => normalize(a.name).includes(input));
  if (fuzzy) return fuzzy;

  // 4. Fuzzy match: input contains the account name
  const reverseFuzzy = allAccounts.find((a) => input.includes(normalize(a.name)));
  if (reverseFuzzy) return reverseFuzzy;

  console.warn(`findAccount: no account found for "${nameOrCode}".`);
  return null;
}

// ─── recalculateBalances ──────────────────────────────────────────────────────

export async function recalculateBalances() {
  const accountsSnap = await db.collection('accounts').get();
  const balances = {};

  accountsSnap.forEach((doc) => {
    const data = doc.data();
    balances[doc.id] = {
      balance: Number(data.openingBalance) || 0,
      type:    data.type,
    };
  });

  const entriesSnap = await db.collection('journal_entries')
    .where('reversed', '==', false)
    .orderBy('date', 'asc')
    .get();

  let entriesProcessed = 0;

  entriesSnap.forEach((doc) => {
    const entry = doc.data();
    for (const line of (entry.lines || [])) {
      const acctId = line.accountId;
      if (!balances[acctId]) {
        console.warn(`recalculateBalances: account ${acctId} (${line.accountName}) in entry ${entry.entryNumber} not found. Skipping.`);
        continue;
      }
      const delta = (Number(line.debit) || 0) - (Number(line.credit) || 0);
      balances[acctId].balance += delta * signMultiplier(balances[acctId].type);
    }
    entriesProcessed++;
  });

  const accountIds = Object.keys(balances);
  let accountsUpdated = 0;

  for (let i = 0; i < accountIds.length; i += 500) {
    const batch = db.batch();
    const chunk = accountIds.slice(i, i + 500);
    for (const id of chunk) {
      batch.update(db.collection('accounts').doc(id), {
        balance: Math.round(balances[id].balance * 100) / 100,
      });
      accountsUpdated++;
    }
    await batch.commit();
  }

  // Invalidate account cache after recalculation
  invalidateAccountCache();

  logLedgerEvent('BALANCES_RECALCULATED', { accountsUpdated, entriesProcessed });
  return { accountsUpdated, entriesProcessed };
}

// ─── getTrialBalance ──────────────────────────────────────────────────────────

export async function getTrialBalance() {
  const snap = await db.collection('accounts').orderBy('code', 'asc').get();

  const accounts   = [];
  let totalDebit   = 0;
  let totalCredit  = 0;

  snap.forEach((doc) => {
    const data    = doc.data();
    const balance = Number(data.balance) || 0;
    const type    = normalize(data.type);
    let debit     = 0;
    let credit    = 0;

    if (type === 'asset' || type === 'expense') {
      if (balance >= 0) { debit = balance; } else { credit = Math.abs(balance); }
    } else {
      if (balance >= 0) { credit = balance; } else { debit = Math.abs(balance); }
    }

    accounts.push({
      id:   doc.id,
      code: data.code,
      name: data.name,
      type: data.type,
      balance,
      debit:  Math.round(debit  * 100) / 100,
      credit: Math.round(credit * 100) / 100,
    });

    totalDebit  += debit;
    totalCredit += credit;
  });

  totalDebit  = Math.round(totalDebit  * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;

  const grouped = {};
  for (const acct of accounts) {
    const t = acct.type || 'unknown';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(acct);
  }

  return {
    accounts,
    grouped,
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
}
