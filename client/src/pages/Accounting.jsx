import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  where,
  Timestamp
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, formatDate, toInputDate } from '../utils/formatters';
import { api } from '../utils/api';

// ──────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────

const TABS = [
  { key: 'coa', label: 'Chart of Accounts' },
  { key: 'journal', label: 'Journal Entries' },
  { key: 'ledger', label: 'Ledger' },
  { key: 'reports', label: 'Reports' }
];

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

const TYPE_COLORS = {
  asset: '#3b82f6',
  liability: '#ef4444',
  equity: '#8b5cf6',
  revenue: '#22c55e',
  expense: '#f59e0b'
};

const emptyAccount = () => ({
  code: '',
  name: '',
  type: 'asset',
  description: '',
  openingBalance: 0
});

const emptyJournalEntry = () => ({
  date: new Date().toISOString().split('T')[0],
  description: '',
  reference: '',
  lines: [
    { accountId: '', accountName: '', debit: 0, credit: 0 },
    { accountId: '', accountName: '', debit: 0, credit: 0 }
  ]
});

const AI_LEDGER_QUICK_PROMPTS = [
  'Record salary payment for March',
  'Create GST payable entry for ₹50,000',
  'Record TDS deduction on professional fees',
  'Explain the current trial balance',
  'Record office rent payment ₹25,000',
];

// ──────────────────────────────────────────────
//  Styles
// ──────────────────────────────────────────────

const s = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    background: '#f1f5f9',
    borderRadius: '8px',
    padding: '4px',
    width: 'fit-content'
  },
  tab: (active) => ({
    padding: '10px 20px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '14px',
    background: active ? '#fff' : 'transparent',
    color: active ? '#1e293b' : '#64748b',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
    transition: 'all 0.2s'
  }),
  card: {
    background: '#fff',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    overflow: 'hidden'
  },
  cardHeader: {
    padding: '20px 24px',
    borderBottom: '1px solid #f1f5f9',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px'
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#1e293b',
    margin: 0
  },
  btnPrimary: {
    padding: '10px 20px',
    background: '#1e293b',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  btnSecondary: {
    padding: '8px 16px',
    background: '#f1f5f9',
    color: '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    fontWeight: 500,
    fontSize: '13px',
    cursor: 'pointer'
  },
  btnDanger: {
    padding: '6px 12px',
    background: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontWeight: 500,
    fontSize: '12px',
    cursor: 'pointer'
  },
  btnSmall: {
    padding: '6px 12px',
    background: '#f8fafc',
    color: '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    fontWeight: 500,
    fontSize: '12px',
    cursor: 'pointer'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #f1f5f9',
    background: '#f8fafc'
  },
  thRight: {
    padding: '12px 16px',
    textAlign: 'right',
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #f1f5f9',
    background: '#f8fafc'
  },
  td: {
    padding: '14px 16px',
    fontSize: '14px',
    color: '#334155',
    borderBottom: '1px solid #f1f5f9'
  },
  tdRight: {
    padding: '14px 16px',
    fontSize: '14px',
    color: '#334155',
    borderBottom: '1px solid #f1f5f9',
    textAlign: 'right',
    fontFamily: "'JetBrains Mono', monospace"
  },
  tdMono: {
    padding: '14px 16px',
    fontSize: '13px',
    color: '#334155',
    borderBottom: '1px solid #f1f5f9',
    fontFamily: "'JetBrains Mono', monospace"
  },
  badge: (color) => ({
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 600,
    color: color,
    background: color + '18',
    textTransform: 'capitalize'
  }),
  formSection: {
    padding: '24px',
    background: '#fff',
    borderRadius: '12px',
    border: '1px solid #e2e8f0'
  },
  formTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#1e293b',
    margin: 0,
    marginBottom: '20px'
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '16px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#475569'
  },
  input: {
    padding: '10px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#1e293b',
    outline: 'none',
    fontFamily: 'inherit'
  },
  select: {
    padding: '10px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#1e293b',
    outline: 'none',
    background: '#fff',
    fontFamily: 'inherit'
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px solid #f1f5f9'
  },
  empty: {
    padding: '60px 20px',
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: '14px'
  },
  removeBtn: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    background: '#fef2f2',
    color: '#dc2626',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 700,
    lineHeight: 1
  },
  lineRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 120px 120px 40px',
    gap: '8px',
    alignItems: 'center',
    marginBottom: '8px'
  },
  lineHeader: {
    display: 'grid',
    gridTemplateColumns: '2fr 120px 120px 40px',
    gap: '8px',
    marginBottom: '8px'
  },
  lineLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase'
  },
  balanceBanner: (balanced) => ({
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    marginTop: '12px',
    textAlign: 'center',
    background: balanced ? '#ecfdf5' : '#fef2f2',
    color: balanced ? '#065f46' : '#991b1b',
    border: `1px solid ${balanced ? '#a7f3d0' : '#fecaca'}`
  }),
  errorMessage: {
    padding: '12px 16px', background: '#fef2f2', color: '#dc2626',
    border: '1px solid #fecaca', borderRadius: '8px', fontSize: '14px', marginBottom: '12px'
  },
  ledgerSelect: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '20px',
    flexWrap: 'wrap'
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '20px'
  },
  statCard: (color) => ({
    padding: '16px',
    background: '#fff',
    borderRadius: '10px',
    border: '1px solid #e2e8f0',
    borderLeft: `4px solid ${color}`
  }),
  statLabel: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 500,
    textTransform: 'capitalize'
  },
  statValue: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#1e293b',
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: '4px'
  }
};

// ──────────────────────────────────────────────
//  Main Component
// ──────────────────────────────────────────────

export default function Accounting() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('coa');

  // ── Chart of Accounts State ──
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccount());
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountFormError, setAccountFormError] = useState(null);

  // ── Journal Entries State ──
  const [journalEntries, setJournalEntries] = useState([]);
  const [loadingJournals, setLoadingJournals] = useState(true);
  const [journalsError, setJournalsError] = useState(null);
  const [showJournalForm, setShowJournalForm] = useState(false);
  const [journalForm, setJournalForm] = useState(emptyJournalEntry());
  const [savingJournal, setSavingJournal] = useState(false);
  const [journalFormError, setJournalFormError] = useState(null);

  // ── Ledger State ──
  const [selectedAccountId, setSelectedAccountId] = useState('');

  // ── AI Ledger Assistant State ──
  const [showAILedger, setShowAILedger] = useState(false);
  const [aiLedgerPrompt, setAiLedgerPrompt] = useState('');
  const [aiLedgerLoading, setAiLedgerLoading] = useState(false);
  const [aiLedgerResult, setAiLedgerResult] = useState(null);
  const [aiLedgerHistory, setAiLedgerHistory] = useState([]);

  // ── Reports State ──
  const [trialBalance, setTrialBalance] = useState(null);
  const [loadingTrialBalance, setLoadingTrialBalance] = useState(false);
  const [trialBalanceError, setTrialBalanceError] = useState(null);
  const [recalculating, setRecalculating] = useState(false);
  const [recalculateError, setRecalculateError] = useState(null);
  const [reportsSubTab, setReportsSubTab] = useState('trial-balance');

  // ── Load Data ──
  useEffect(() => {
    const abortController = new AbortController();
    loadAccounts();
    loadJournalEntries();
    return () => abortController.abort();
  }, []);

  async function loadAccounts() {
    setLoadingAccounts(true);
    setAccountsError(null);
    try {
      const q = query(collection(db, 'accounts'), orderBy('code', 'asc'));
      const snap = await getDocs(q);
      setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading accounts:', err);
      setAccountsError('Failed to load accounts. Please try again.');
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function loadJournalEntries() {
    setLoadingJournals(true);
    setJournalsError(null);
    try {
      const q = query(collection(db, 'journal_entries'), orderBy('date', 'desc'));
      const snap = await getDocs(q);
      setJournalEntries(snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          date: data.date?.toDate?.() || new Date(data.date),
          createdAt: data.createdAt?.toDate?.() || new Date()
        };
      }));
    } catch (err) {
      console.error('Error loading journal entries:', err);
      setJournalsError('Failed to load journal entries. Please try again.');
    } finally {
      setLoadingJournals(false);
    }
  }

  // ── Account type totals ──
  const accountTypeTotals = useMemo(() => {
    const totals = {};
    ACCOUNT_TYPES.forEach(type => { totals[type] = 0; });
    accounts.forEach(acc => {
      if (totals[acc.type] !== undefined) {
        totals[acc.type] += Number(acc.balance || acc.openingBalance || 0);
      }
    });
    return totals;
  }, [accounts]);

  // ══════════════════════════════════════════════
  //  Reports
  // ══════════════════════════════════════════════

  async function loadTrialBalance() {
    setLoadingTrialBalance(true);
    setTrialBalanceError(null);
    try {
      const data = await api.get('/accounting/trial-balance');
      setTrialBalance(data);
    } catch (err) {
      console.error('Error loading trial balance:', err);
      try {
        // Fallback: compute from local accounts data
        const tb = { accounts: [], grouped: {}, totalDebit: 0, totalCredit: 0, balanced: true };
        let totalDebit = 0;
        let totalCredit = 0;
        const sorted = [...accounts].sort((a, b) => (a.code || '').localeCompare(b.code || ''));
        for (const acc of sorted) {
          const balance = Number(acc.balance) || 0;
          const type = (acc.type || '').toLowerCase();
          let debit = 0;
          let credit = 0;
          if (type === 'asset' || type === 'expense') {
            if (balance >= 0) debit = balance; else credit = Math.abs(balance);
          } else {
            if (balance >= 0) credit = balance; else debit = Math.abs(balance);
          }
          debit = Math.round(debit * 100) / 100;
          credit = Math.round(credit * 100) / 100;
          totalDebit += debit;
          totalCredit += credit;
          const entry = { id: acc.id, code: acc.code, name: acc.name, type: acc.type, balance, debit, credit };
          tb.accounts.push(entry);
          if (!tb.grouped[acc.type]) tb.grouped[acc.type] = [];
          tb.grouped[acc.type].push(entry);
        }
        tb.totalDebit = Math.round(totalDebit * 100) / 100;
        tb.totalCredit = Math.round(totalCredit * 100) / 100;
        tb.balanced = Math.abs(tb.totalDebit - tb.totalCredit) < 0.01;
        setTrialBalance(tb);
      } catch (fallbackErr) {
        console.error('Error computing fallback trial balance:', fallbackErr);
        setTrialBalanceError('Failed to load trial balance. Please try again.');
      }
    } finally {
      setLoadingTrialBalance(false);
    }
  }

  async function handleRecalculate() {
    if (!window.confirm('Recalculate all account balances from journal entries? This may take a moment.')) return;
    setRecalculating(true);
    setRecalculateError(null);
    try {
      const result = await api.post('/accounting/recalculate', {});
      alert(`Recalculation complete: ${result.accountsUpdated} accounts updated from ${result.entriesProcessed} entries.`);
      await loadAccounts();
      await loadTrialBalance();
    } catch (err) {
      console.error('Error recalculating:', err);
      setRecalculateError('Failed to recalculate balances. ' + (err.message || 'Please check console for details.'));
    } finally {
      setRecalculating(false);
    }
  }

  // Profit & Loss computed from accounts
  const profitAndLoss = useMemo(() => {
    const revenue = accounts.filter(a => (a.type || '').toLowerCase() === 'revenue');
    const expense = accounts.filter(a => (a.type || '').toLowerCase() === 'expense');
    const totalRevenue = revenue.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
    const totalExpense = expense.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
    const netIncome = totalRevenue - totalExpense;
    return { revenue, expense, totalRevenue, totalExpense, netIncome };
  }, [accounts]);

  // Balance Sheet computed from accounts
  const balanceSheet = useMemo(() => {
    const assets = accounts.filter(a => (a.type || '').toLowerCase() === 'asset');
    const liabilities = accounts.filter(a => (a.type || '').toLowerCase() === 'liability');
    const equity = accounts.filter(a => (a.type || '').toLowerCase() === 'equity');
    const totalAssets = assets.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
    const totalLiabilities = liabilities.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
    const totalEquity = equity.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
    const liabPlusEquity = totalLiabilities + totalEquity;
    return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, liabPlusEquity };
  }, [accounts]);

  // ══════════════════════════════════════════════
  //  Chart of Accounts
  // ══════════════════════════════════════════════

  function updateAccountForm(field, value) {
    setAccountForm(prev => ({ ...prev, [field]: value }));
    setAccountFormError(null);
  }

  async function handleSaveAccount(e) {
    e.preventDefault();
    if (!accountForm.code.trim()) {
      setAccountFormError('Account code is required.');
      return;
    }
    if (!accountForm.name.trim()) {
      setAccountFormError('Account name is required.');
      return;
    }

    // Check for duplicate code
    if (accounts.some(a => a.code === accountForm.code.trim())) {
      setAccountFormError('An account with this code already exists.');
      return;
    }

    setSavingAccount(true);
    setAccountFormError(null);
    try {
      await addDoc(collection(db, 'accounts'), {
        code: accountForm.code.trim(),
        name: accountForm.name.trim(),
        type: accountForm.type,
        description: accountForm.description.trim(),
        openingBalance: Number(accountForm.openingBalance) || 0,
        balance: Number(accountForm.openingBalance) || 0,
        createdAt: Timestamp.now(),
        createdBy: user?.email || 'unknown'
      });
      setAccountForm(emptyAccount());
      setShowAccountForm(false);
      setAccountFormError(null);
      await loadAccounts();
    } catch (err) {
      console.error('Error saving account:', err);
      setAccountFormError('Failed to save account. Please try again.');
    } finally {
      setSavingAccount(false);
    }
  }

  async function deleteAccount(id) {
    if (!window.confirm('Delete this account? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'accounts', id));
      await loadAccounts();
    } catch (err) {
      console.error('Error deleting account:', err);
      alert('Failed to delete account. Please try again.');
    }
  }

  // ══════════════════════════════════════════════
  //  Journal Entries
  // ══════════════════════════════════════════════

  function updateJournalForm(field, value) {
    setJournalForm(prev => ({ ...prev, [field]: value }));
    setJournalFormError(null);
  }

  function updateJournalLine(index, field, value) {
    setJournalForm(prev => {
      const lines = [...prev.lines];
      if (field === 'accountId') {
        const acc = accounts.find(a => a.id === value);
        lines[index] = { ...lines[index], accountId: value, accountName: acc?.name || '' };
      } else {
        lines[index] = { ...lines[index], [field]: Number(value) || 0 };
        // Enforce debit/credit exclusivity
        if (field === 'debit' && Number(value) > 0) {
          lines[index].credit = 0;
        }
        if (field === 'credit' && Number(value) > 0) {
          lines[index].debit = 0;
        }
      }
      return { ...prev, lines };
    });
  }

  function addJournalLine() {
    setJournalForm(prev => ({
      ...prev,
      lines: [...prev.lines, { accountId: '', accountName: '', debit: 0, credit: 0 }]
    }));
  }

  function removeJournalLine(index) {
    if (journalForm.lines.length <= 2) return;
    setJournalForm(prev => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== index)
    }));
  }

  const journalTotalDebit = journalForm.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const journalTotalCredit = journalForm.lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const journalBalanced = journalTotalDebit > 0 && Math.abs(journalTotalDebit - journalTotalCredit) < 0.01;

  async function handleSaveJournal(e) {
    e.preventDefault();
    if (!journalForm.description.trim()) {
      setJournalFormError('Description is required.');
      return;
    }
    if (!journalForm.date) {
      setJournalFormError('Date is required.');
      return;
    }
    if (journalForm.lines.some(l => !l.accountId)) {
      setJournalFormError('All lines must have an account selected.');
      return;
    }
    if (!journalBalanced) {
      setJournalFormError('Total debits must equal total credits.');
      return;
    }

    setSavingJournal(true);
    setJournalFormError(null);
    try {
      const entryNumber = `JE-${String(journalEntries.length + 1).padStart(5, '0')}`;

      await addDoc(collection(db, 'journal_entries'), {
        entryNumber,
        date: Timestamp.fromDate(new Date(journalForm.date)),
        description: journalForm.description.trim(),
        reference: journalForm.reference.trim(),
        lines: journalForm.lines.map(l => ({
          accountId: l.accountId,
          accountName: l.accountName,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0
        })),
        totalDebit: journalTotalDebit,
        totalCredit: journalTotalCredit,
        createdAt: Timestamp.now(),
        createdBy: user?.email || 'unknown'
      });

      // Update account balances
      for (const line of journalForm.lines) {
        const acc = accounts.find(a => a.id === line.accountId);
        if (acc) {
          let newBalance = Number(acc.balance || acc.openingBalance || 0);
          // Assets & Expenses increase with debit, decrease with credit
          // Liabilities, Equity & Revenue increase with credit, decrease with debit
          if (['asset', 'expense'].includes(acc.type)) {
            newBalance += (Number(line.debit) || 0) - (Number(line.credit) || 0);
          } else {
            newBalance += (Number(line.credit) || 0) - (Number(line.debit) || 0);
          }
          await updateDoc(doc(db, 'accounts', acc.id), { balance: newBalance });
        }
      }

      setJournalForm(emptyJournalEntry());
      setShowJournalForm(false);
      setJournalFormError(null);
      await loadJournalEntries();
      await loadAccounts();
    } catch (err) {
      console.error('Error saving journal entry:', err);
      setJournalFormError('Failed to save journal entry. Please try again.');
    } finally {
      setSavingJournal(false);
    }
  }

  async function deleteJournalEntry(entry) {
    if (!window.confirm('Delete this journal entry? Account balances will be reversed.')) return;
    try {
      // Reverse balance changes
      for (const line of (entry.lines || [])) {
        const acc = accounts.find(a => a.id === line.accountId);
        if (acc) {
          let newBalance = Number(acc.balance || 0);
          if (['asset', 'expense'].includes(acc.type)) {
            newBalance -= (Number(line.debit) || 0) - (Number(line.credit) || 0);
          } else {
            newBalance -= (Number(line.credit) || 0) - (Number(line.debit) || 0);
          }
          await updateDoc(doc(db, 'accounts', acc.id), { balance: newBalance });
        }
      }

      await deleteDoc(doc(db, 'journal_entries', entry.id));
      await loadJournalEntries();
      await loadAccounts();
    } catch (err) {
      console.error('Error deleting journal entry:', err);
      alert('Failed to delete journal entry. Please try again.');
    }
  }

  // ══════════════════════════════════════════════
  //  AI Ledger Assistant
  // ══════════════════════════════════════════════

  async function handleAILedger() {
    if (!aiLedgerPrompt.trim()) return;
    const prompt = aiLedgerPrompt.trim();
    setAiLedgerLoading(true);

    // Add user message to history
    setAiLedgerHistory(prev => [...prev, { role: 'user', text: prompt }]);
    setAiLedgerPrompt('');

    try {
      const data = await api.post('/ai/ledger-assistant', {
        prompt,
        action: 'auto',
      });

      const resultEntry = {
        role: 'assistant',
        message: data.message || 'Done.',
        action: data.action || null,
        entry: data.entry || null,
        analysis: data.analysis || null,
        suggestions: data.suggestions || null,
        executed: data.executed || false,
      };

      setAiLedgerResult(resultEntry);
      setAiLedgerHistory(prev => [...prev, resultEntry]);

      // If the AI auto-executed an entry, refresh data
      if (data.executed === true) {
        await loadJournalEntries();
        await loadAccounts();
      }
    } catch (err) {
      const errorEntry = {
        role: 'assistant',
        message: err.message || 'AI request failed. Please try again.',
        action: 'ERROR',
        entry: null,
        analysis: null,
        suggestions: null,
        executed: false,
      };
      setAiLedgerHistory(prev => [...prev, errorEntry]);
    } finally {
      setAiLedgerLoading(false);
    }
  }

  function applyAIEntry(result) {
    if (!result || !result.entry) return;
    const entry = result.entry;

    const newForm = {
      date: entry.date || new Date().toISOString().split('T')[0],
      description: entry.description || '',
      reference: entry.reference || '',
      lines: (entry.lines || []).map(line => {
        // Try to match account by name or code
        let matchedAccount = null;
        if (line.accountId) {
          matchedAccount = accounts.find(a => a.id === line.accountId);
        }
        if (!matchedAccount && line.accountName) {
          matchedAccount = accounts.find(a =>
            a.name.toLowerCase() === line.accountName.toLowerCase() ||
            a.code === line.accountCode
          );
        }
        return {
          accountId: matchedAccount?.id || line.accountId || '',
          accountName: matchedAccount?.name || line.accountName || '',
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
        };
      }),
    };

    // Ensure at least 2 lines
    while (newForm.lines.length < 2) {
      newForm.lines.push({ accountId: '', accountName: '', debit: 0, credit: 0 });
    }

    setJournalForm(newForm);
    setShowJournalForm(true);
    setActiveTab('journal');
  }

  // ══════════════════════════════════════════════
  //  Ledger
  // ══════════════════════════════════════════════

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  const ledgerEntries = useMemo(() => {
    if (!selectedAccountId) return [];

    const entries = [];
    const sorted = [...journalEntries].sort((a, b) => new Date(a.date) - new Date(b.date));

    const acc = accounts.find(a => a.id === selectedAccountId);
    let runningBalance = Number(acc?.openingBalance || 0);

    for (const je of sorted) {
      for (const line of (je.lines || [])) {
        if (line.accountId === selectedAccountId) {
          if (['asset', 'expense'].includes(acc?.type)) {
            runningBalance += (Number(line.debit) || 0) - (Number(line.credit) || 0);
          } else {
            runningBalance += (Number(line.credit) || 0) - (Number(line.debit) || 0);
          }

          entries.push({
            date: je.date,
            entryNumber: je.entryNumber,
            description: je.description,
            reference: je.reference,
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
            balance: runningBalance
          });
        }
      }
    }

    return entries;
  }, [selectedAccountId, journalEntries, accounts]);

  // ──────────────────────────────────────────────
  //  Render
  // ──────────────────────────────────────────────

  return (
    <div style={{ ...s.page, position: 'relative' }}>
      {/* Header with Tabs + AI Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={s.tabs}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              style={s.tab(activeTab === tab.key)}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* AI Assistant Toggle Button */}
        <button
          onClick={() => setShowAILedger(!showAILedger)}
          style={{
            padding: '10px 20px',
            background: showAILedger
              ? 'linear-gradient(135deg, #7c3aed, #3b82f6)'
              : '#f5f3ff',
            color: showAILedger ? '#fff' : '#7c3aed',
            border: showAILedger ? 'none' : '2px solid #c4b5fd',
            borderRadius: '10px',
            fontWeight: 700,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
            boxShadow: showAILedger ? '0 4px 14px rgba(124,58,237,0.3)' : 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93L12 22"/>
            <path d="M8 6a4 4 0 0 1 8 0"/>
            <path d="M17 12.5c1.77.54 3 2.18 3 4.1 0 2.38-1.94 4.4-4.5 4.4h-7C5.94 21 4 18.98 4 16.6c0-1.92 1.23-3.56 3-4.1"/>
          </svg>
          AI Assistant
        </button>
      </div>

      {/* Main content wrapper with optional sidebar */}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        {/* Main content area */}
        <div style={{ flex: 1, minWidth: 0 }}>

      {/* ════════════════════════════════════════ */}
      {/*  Chart of Accounts                      */}
      {/* ════════════════════════════════════════ */}
      {activeTab === 'coa' && (
        <>
          {accountsError && <div style={s.errorMessage}>{accountsError}</div>}
          {/* Summary Cards */}
          <div style={s.statsRow}>
            {ACCOUNT_TYPES.map(type => (
              <div key={type} style={s.statCard(TYPE_COLORS[type])}>
                <div style={s.statLabel}>{type}</div>
                <div style={s.statValue}>{formatCurrency(accountTypeTotals[type])}</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {accounts.filter(a => a.type === type).length} accounts
                </div>
              </div>
            ))}
          </div>

          {/* Add Account Form */}
          {showAccountForm && (
            <div style={s.formSection}>
              <h3 style={s.formTitle}>Add New Account</h3>
              {accountFormError && <div style={s.errorMessage}>{accountFormError}</div>}
              <form onSubmit={handleSaveAccount}>
                <div style={s.formGrid}>
                  <div style={s.formGroup}>
                    <label style={s.label}>Account Code *</label>
                    <input
                      style={s.input}
                      value={accountForm.code}
                      onChange={e => updateAccountForm('code', e.target.value)}
                      placeholder="e.g. 1001"
                      required
                    />
                  </div>
                  <div style={s.formGroup}>
                    <label style={s.label}>Account Name *</label>
                    <input
                      style={s.input}
                      value={accountForm.name}
                      onChange={e => updateAccountForm('name', e.target.value)}
                      placeholder="e.g. Cash in Hand"
                      required
                    />
                  </div>
                  <div style={s.formGroup}>
                    <label style={s.label}>Type *</label>
                    <select
                      style={s.select}
                      value={accountForm.type}
                      onChange={e => updateAccountForm('type', e.target.value)}
                    >
                      {ACCOUNT_TYPES.map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div style={s.formGroup}>
                    <label style={s.label}>Opening Balance</label>
                    <input
                      style={s.input}
                      type="number"
                      step="0.01"
                      value={accountForm.openingBalance}
                      onChange={e => updateAccountForm('openingBalance', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div style={{ ...s.formGroup, gridColumn: 'span 2' }}>
                    <label style={s.label}>Description</label>
                    <input
                      style={s.input}
                      value={accountForm.description}
                      onChange={e => updateAccountForm('description', e.target.value)}
                      placeholder="Optional description"
                    />
                  </div>
                </div>
                <div style={s.formActions}>
                  <button
                    type="button"
                    style={s.btnSecondary}
                    onClick={() => { setShowAccountForm(false); setAccountForm(emptyAccount()); }}
                    disabled={savingAccount}
                  >
                    Cancel
                  </button>
                  <button type="submit" style={s.btnPrimary} disabled={savingAccount}>
                    {savingAccount ? 'Saving...' : 'Save Account'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Accounts Table */}
          <div style={s.card}>
            <div style={s.cardHeader}>
              <h3 style={s.cardTitle}>
                Chart of Accounts
                <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: '8px' }}>
                  ({accounts.length})
                </span>
              </h3>
              <button
                style={s.btnPrimary}
                onClick={() => setShowAccountForm(!showAccountForm)}
              >
                {showAccountForm ? 'Cancel' : '+ Add Account'}
              </button>
            </div>
            {loadingAccounts ? (
              <div style={s.empty}>Loading accounts...</div>
            ) : accounts.length === 0 ? (
              <div style={s.empty}>No accounts found. Add your first account above.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Code</th>
                      <th style={s.th}>Account Name</th>
                      <th style={s.th}>Type</th>
                      <th style={s.th}>Description</th>
                      <th style={s.thRight}>Balance</th>
                      <th style={s.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(acc => (
                      <tr key={acc.id}>
                        <td style={s.tdMono}>{acc.code}</td>
                        <td style={{ ...s.td, fontWeight: 600 }}>{acc.name}</td>
                        <td style={s.td}>
                          <span style={s.badge(TYPE_COLORS[acc.type] || '#6b7280')}>
                            {acc.type}
                          </span>
                        </td>
                        <td style={{ ...s.td, color: '#94a3b8', fontSize: '13px' }}>
                          {acc.description || '---'}
                        </td>
                        <td style={{
                          ...s.tdRight,
                          fontWeight: 600,
                          color: (acc.balance || 0) < 0 ? '#ef4444' : '#1e293b'
                        }}>
                          {formatCurrency(acc.balance || acc.openingBalance || 0)}
                        </td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              style={s.btnSmall}
                              onClick={() => { setSelectedAccountId(acc.id); setActiveTab('ledger'); }}
                            >
                              Ledger
                            </button>
                            <button
                              style={s.btnDanger}
                              onClick={() => deleteAccount(acc.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════ */}
      {/*  Journal Entries                         */}
      {/* ════════════════════════════════════════ */}
      {activeTab === 'journal' && (
        <>
          {journalsError && <div style={s.errorMessage}>{journalsError}</div>}
          {/* Journal Entry Form */}
          {showJournalForm && (
            <div style={s.formSection}>
              <h3 style={s.formTitle}>Create Journal Entry</h3>
              {journalFormError && <div style={s.errorMessage}>{journalFormError}</div>}
              <form onSubmit={handleSaveJournal}>
                <div style={{ ...s.formGrid, gridTemplateColumns: '1fr 2fr 1fr' }}>
                  <div style={s.formGroup}>
                    <label style={s.label}>Date *</label>
                    <input
                      style={s.input}
                      type="date"
                      value={journalForm.date}
                      onChange={e => updateJournalForm('date', e.target.value)}
                      required
                    />
                  </div>
                  <div style={s.formGroup}>
                    <label style={s.label}>Description *</label>
                    <input
                      style={s.input}
                      value={journalForm.description}
                      onChange={e => updateJournalForm('description', e.target.value)}
                      placeholder="Journal entry description"
                      required
                    />
                  </div>
                  <div style={s.formGroup}>
                    <label style={s.label}>Reference</label>
                    <input
                      style={s.input}
                      value={journalForm.reference}
                      onChange={e => updateJournalForm('reference', e.target.value)}
                      placeholder="e.g. INV-001"
                    />
                  </div>
                </div>

                {/* Debit / Credit Lines */}
                <div style={{ marginTop: '16px', marginBottom: '8px' }}>
                  <span style={{ ...s.label, fontSize: '14px', color: '#1e293b' }}>Debit / Credit Lines</span>
                </div>
                <div style={s.lineHeader}>
                  <span style={s.lineLabel}>Account</span>
                  <span style={s.lineLabel}>Debit</span>
                  <span style={s.lineLabel}>Credit</span>
                  <span></span>
                </div>
                {journalForm.lines.map((line, idx) => (
                  <div key={idx} style={s.lineRow}>
                    <select
                      style={s.select}
                      value={line.accountId}
                      onChange={e => updateJournalLine(idx, 'accountId', e.target.value)}
                      required
                    >
                      <option value="">Select Account</option>
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.code} - {acc.name}
                        </option>
                      ))}
                    </select>
                    <input
                      style={{ ...s.input, textAlign: 'right' }}
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.debit || ''}
                      onChange={e => updateJournalLine(idx, 'debit', e.target.value)}
                      placeholder="0.00"
                    />
                    <input
                      style={{ ...s.input, textAlign: 'right' }}
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.credit || ''}
                      onChange={e => updateJournalLine(idx, 'credit', e.target.value)}
                      placeholder="0.00"
                    />
                    <button
                      type="button"
                      style={s.removeBtn}
                      onClick={() => removeJournalLine(idx)}
                      title="Remove line"
                    >
                      &times;
                    </button>
                  </div>
                ))}

                <button type="button" style={{ ...s.btnSecondary, marginTop: '8px' }} onClick={addJournalLine}>
                  + Add Line
                </button>

                {/* Totals */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 120px 120px 40px', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '2px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b', textAlign: 'right', paddingRight: '8px' }}>
                    Totals
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatCurrency(journalTotalDebit)}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatCurrency(journalTotalCredit)}
                  </div>
                  <div></div>
                </div>

                <div style={s.balanceBanner(journalBalanced)}>
                  {journalBalanced
                    ? 'Debits and credits are balanced.'
                    : `Difference: ${formatCurrency(Math.abs(journalTotalDebit - journalTotalCredit))} -- Debits must equal credits.`
                  }
                </div>

                <div style={s.formActions}>
                  <button
                    type="button"
                    style={s.btnSecondary}
                    onClick={() => { setShowJournalForm(false); setJournalForm(emptyJournalEntry()); }}
                    disabled={savingJournal}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{ ...s.btnPrimary, opacity: journalBalanced ? 1 : 0.5 }}
                    disabled={savingJournal || !journalBalanced}
                  >
                    {savingJournal ? 'Saving...' : 'Post Journal Entry'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Journal Entries Table */}
          <div style={s.card}>
            <div style={s.cardHeader}>
              <h3 style={s.cardTitle}>
                Journal Entries
                <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: '8px' }}>
                  ({journalEntries.length})
                </span>
              </h3>
              <button
                style={s.btnPrimary}
                onClick={() => setShowJournalForm(!showJournalForm)}
              >
                {showJournalForm ? 'Cancel' : '+ New Journal Entry'}
              </button>
            </div>
            {loadingJournals ? (
              <div style={s.empty}>Loading journal entries...</div>
            ) : journalEntries.length === 0 ? (
              <div style={s.empty}>No journal entries found. Create your first entry above.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Entry #</th>
                      <th style={s.th}>Date</th>
                      <th style={s.th}>Description</th>
                      <th style={s.th}>Accounts</th>
                      <th style={s.thRight}>Debit</th>
                      <th style={s.thRight}>Credit</th>
                      <th style={s.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalEntries.map(je => (
                      <tr key={je.id}>
                        <td style={s.tdMono}>{je.entryNumber}</td>
                        <td style={s.td}>{formatDate(je.date)}</td>
                        <td style={s.td}>
                          <div style={{ fontWeight: 500 }}>{je.description}</div>
                          {je.reference && (
                            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Ref: {je.reference}</div>
                          )}
                        </td>
                        <td style={s.td}>
                          <div style={{ fontSize: '12px', lineHeight: 1.8 }}>
                            {(je.lines || []).map((line, i) => (
                              <div key={i} style={{
                                color: line.debit > 0 ? '#1e293b' : '#64748b',
                                paddingLeft: line.credit > 0 ? '16px' : '0',
                                fontWeight: line.debit > 0 ? 500 : 400
                              }}>
                                {line.credit > 0 && <span style={{ color: '#94a3b8' }}>To </span>}
                                {line.accountName || 'Unknown'}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td style={s.tdRight}>{formatCurrency(je.totalDebit)}</td>
                        <td style={s.tdRight}>{formatCurrency(je.totalCredit)}</td>
                        <td style={s.td}>
                          <button
                            style={s.btnDanger}
                            onClick={() => deleteJournalEntry(je)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════ */}
      {/*  Ledger                                  */}
      {/* ════════════════════════════════════════ */}
      {activeTab === 'ledger' && (
        <>
          <div style={s.card}>
            <div style={{ padding: '24px' }}>
              <div style={s.ledgerSelect}>
                <label style={{ ...s.label, marginBottom: 0 }}>Select Account:</label>
                <select
                  style={{ ...s.select, minWidth: '300px' }}
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                >
                  <option value="">-- Choose an account --</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name} ({acc.type})
                    </option>
                  ))}
                </select>
                {selectedAccount && (
                  <span style={s.badge(TYPE_COLORS[selectedAccount.type] || '#6b7280')}>
                    {selectedAccount.type}
                  </span>
                )}
              </div>

              {selectedAccount && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '16px',
                  marginBottom: '20px'
                }}>
                  <div style={s.statCard(TYPE_COLORS[selectedAccount.type] || '#6b7280')}>
                    <div style={s.statLabel}>Opening Balance</div>
                    <div style={s.statValue}>{formatCurrency(selectedAccount.openingBalance || 0)}</div>
                  </div>
                  <div style={s.statCard('#3b82f6')}>
                    <div style={s.statLabel}>Current Balance</div>
                    <div style={s.statValue}>{formatCurrency(selectedAccount.balance || 0)}</div>
                  </div>
                  <div style={s.statCard('#8b5cf6')}>
                    <div style={s.statLabel}>Transactions</div>
                    <div style={s.statValue}>{ledgerEntries.length}</div>
                  </div>
                </div>
              )}
            </div>

            {!selectedAccountId ? (
              <div style={s.empty}>Select an account to view its ledger.</div>
            ) : ledgerEntries.length === 0 ? (
              <div style={s.empty}>No transactions found for this account.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Date</th>
                      <th style={s.th}>Entry #</th>
                      <th style={s.th}>Description</th>
                      <th style={s.th}>Reference</th>
                      <th style={s.thRight}>Debit</th>
                      <th style={s.thRight}>Credit</th>
                      <th style={s.thRight}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Opening balance row */}
                    <tr style={{ background: '#f8fafc' }}>
                      <td style={{ ...s.td, fontWeight: 600 }} colSpan={4}>Opening Balance</td>
                      <td style={s.tdRight}>---</td>
                      <td style={s.tdRight}>---</td>
                      <td style={{ ...s.tdRight, fontWeight: 700 }}>
                        {formatCurrency(selectedAccount?.openingBalance || 0)}
                      </td>
                    </tr>
                    {ledgerEntries.map((entry, idx) => (
                      <tr key={idx}>
                        <td style={s.td}>{formatDate(entry.date)}</td>
                        <td style={s.tdMono}>{entry.entryNumber}</td>
                        <td style={s.td}>{entry.description}</td>
                        <td style={{ ...s.td, color: '#94a3b8', fontSize: '13px' }}>{entry.reference || '---'}</td>
                        <td style={{ ...s.tdRight, color: entry.debit > 0 ? '#1e293b' : '#cbd5e1' }}>
                          {entry.debit > 0 ? formatCurrency(entry.debit) : '---'}
                        </td>
                        <td style={{ ...s.tdRight, color: entry.credit > 0 ? '#1e293b' : '#cbd5e1' }}>
                          {entry.credit > 0 ? formatCurrency(entry.credit) : '---'}
                        </td>
                        <td style={{
                          ...s.tdRight,
                          fontWeight: 700,
                          color: entry.balance < 0 ? '#ef4444' : '#1e293b'
                        }}>
                          {formatCurrency(entry.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════ */}
      {/*  Reports                                  */}
      {/* ════════════════════════════════════════ */}
      {activeTab === 'reports' && (
        <>
          {trialBalanceError && <div style={s.errorMessage}>{trialBalanceError}</div>}
          {recalculateError && <div style={s.errorMessage}>{recalculateError}</div>}
          {/* Reports Sub-tabs + Recalculate Button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', borderRadius: '8px', padding: '4px' }}>
              {[
                { key: 'trial-balance', label: 'Trial Balance' },
                { key: 'profit-loss', label: 'Profit & Loss' },
                { key: 'balance-sheet', label: 'Balance Sheet' }
              ].map(sub => (
                <button
                  key={sub.key}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '13px',
                    background: reportsSubTab === sub.key ? '#fff' : 'transparent',
                    color: reportsSubTab === sub.key ? '#1e293b' : '#64748b',
                    boxShadow: reportsSubTab === sub.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.2s'
                  }}
                  onClick={() => {
                    setReportsSubTab(sub.key);
                    if (sub.key === 'trial-balance' && !trialBalance) loadTrialBalance();
                  }}
                >
                  {sub.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                style={{
                  ...s.btnSecondary,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onClick={() => loadTrialBalance()}
                disabled={loadingTrialBalance}
              >
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
                {loadingTrialBalance ? 'Loading...' : 'Refresh Data'}
              </button>
              <button
                style={{
                  padding: '8px 16px',
                  background: '#f59e0b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: recalculating ? 'not-allowed' : 'pointer',
                  opacity: recalculating ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onClick={handleRecalculate}
                disabled={recalculating}
              >
                {recalculating ? 'Recalculating...' : 'Recalculate Balances'}
              </button>
            </div>
          </div>

          {/* ──── Trial Balance ──── */}
          {reportsSubTab === 'trial-balance' && (
            <div style={s.card}>
              <div style={s.cardHeader}>
                <h3 style={s.cardTitle}>Trial Balance</h3>
                {trialBalance && (
                  <span style={{
                    padding: '6px 14px',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: 700,
                    background: trialBalance.balanced ? '#ecfdf5' : '#fef2f2',
                    color: trialBalance.balanced ? '#065f46' : '#991b1b',
                    border: `1px solid ${trialBalance.balanced ? '#a7f3d0' : '#fecaca'}`
                  }}>
                    {trialBalance.balanced ? 'Balanced' : 'Imbalanced'}
                  </span>
                )}
              </div>
              {loadingTrialBalance ? (
                <div style={s.empty}>Loading trial balance...</div>
              ) : !trialBalance ? (
                <div style={s.empty}>
                  <button style={s.btnPrimary} onClick={loadTrialBalance}>Load Trial Balance</button>
                </div>
              ) : trialBalance.accounts.length === 0 ? (
                <div style={s.empty}>No accounts found.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Code</th>
                        <th style={s.th}>Account Name</th>
                        <th style={s.th}>Type</th>
                        <th style={s.thRight}>Debit</th>
                        <th style={s.thRight}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ACCOUNT_TYPES.map(type => {
                        const typeAccounts = (trialBalance.grouped[type] || []);
                        if (typeAccounts.length === 0) return null;
                        return (
                          <React.Fragment key={type}>
                            <tr style={{ background: '#f8fafc' }}>
                              <td colSpan={5} style={{
                                ...s.td,
                                fontWeight: 700,
                                color: TYPE_COLORS[type] || '#1e293b',
                                textTransform: 'uppercase',
                                fontSize: '12px',
                                letterSpacing: '0.05em'
                              }}>
                                {type}
                              </td>
                            </tr>
                            {typeAccounts.map(acc => (
                              <tr key={acc.id}>
                                <td style={s.tdMono}>{acc.code}</td>
                                <td style={{ ...s.td, fontWeight: 500 }}>{acc.name}</td>
                                <td style={s.td}>
                                  <span style={s.badge(TYPE_COLORS[acc.type] || '#6b7280')}>{acc.type}</span>
                                </td>
                                <td style={{
                                  ...s.tdRight,
                                  color: acc.debit > 0 ? '#1e293b' : '#cbd5e1'
                                }}>
                                  {acc.debit > 0 ? formatCurrency(acc.debit) : '---'}
                                </td>
                                <td style={{
                                  ...s.tdRight,
                                  color: acc.credit > 0 ? '#1e293b' : '#cbd5e1'
                                }}>
                                  {acc.credit > 0 ? formatCurrency(acc.credit) : '---'}
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f1f5f9', borderTop: '2px solid #e2e8f0' }}>
                        <td colSpan={3} style={{ ...s.td, fontWeight: 700, color: '#1e293b', fontSize: '14px' }}>
                          Total
                        </td>
                        <td style={{ ...s.tdRight, fontWeight: 700, color: '#1e293b', fontSize: '14px' }}>
                          {formatCurrency(trialBalance.totalDebit)}
                        </td>
                        <td style={{ ...s.tdRight, fontWeight: 700, color: '#1e293b', fontSize: '14px' }}>
                          {formatCurrency(trialBalance.totalCredit)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  <div style={s.balanceBanner(trialBalance.balanced)}>
                    {trialBalance.balanced
                      ? 'Trial Balance is balanced. Total Debits = Total Credits.'
                      : `Trial Balance is IMBALANCED. Difference: ${formatCurrency(Math.abs(trialBalance.totalDebit - trialBalance.totalCredit))}`
                    }
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ──── Profit & Loss Statement ──── */}
          {reportsSubTab === 'profit-loss' && (
            <div style={s.card}>
              <div style={s.cardHeader}>
                <h3 style={s.cardTitle}>Profit & Loss Statement</h3>
                <span style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  fontSize: '13px',
                  fontWeight: 700,
                  background: profitAndLoss.netIncome >= 0 ? '#ecfdf5' : '#fef2f2',
                  color: profitAndLoss.netIncome >= 0 ? '#065f46' : '#991b1b',
                  border: `1px solid ${profitAndLoss.netIncome >= 0 ? '#a7f3d0' : '#fecaca'}`
                }}>
                  {profitAndLoss.netIncome >= 0 ? 'Net Profit' : 'Net Loss'}: {formatCurrency(Math.abs(profitAndLoss.netIncome))}
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Code</th>
                      <th style={s.th}>Account Name</th>
                      <th style={s.thRight}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Revenue Section */}
                    <tr style={{ background: '#f0fdf4' }}>
                      <td colSpan={3} style={{
                        ...s.td,
                        fontWeight: 700,
                        color: '#22c55e',
                        textTransform: 'uppercase',
                        fontSize: '12px',
                        letterSpacing: '0.05em'
                      }}>
                        Revenue
                      </td>
                    </tr>
                    {profitAndLoss.revenue.length === 0 ? (
                      <tr><td colSpan={3} style={{ ...s.td, color: '#94a3b8', textAlign: 'center' }}>No revenue accounts</td></tr>
                    ) : (
                      profitAndLoss.revenue.map(acc => (
                        <tr key={acc.id}>
                          <td style={s.tdMono}>{acc.code}</td>
                          <td style={{ ...s.td, fontWeight: 500 }}>{acc.name}</td>
                          <td style={{ ...s.tdRight, color: '#22c55e', fontWeight: 600 }}>
                            {formatCurrency(Number(acc.balance) || 0)}
                          </td>
                        </tr>
                      ))
                    )}
                    <tr style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                      <td colSpan={2} style={{ ...s.td, fontWeight: 700, color: '#22c55e' }}>Total Revenue</td>
                      <td style={{ ...s.tdRight, fontWeight: 700, color: '#22c55e' }}>
                        {formatCurrency(profitAndLoss.totalRevenue)}
                      </td>
                    </tr>

                    {/* Expense Section */}
                    <tr style={{ background: '#fffbeb' }}>
                      <td colSpan={3} style={{
                        ...s.td,
                        fontWeight: 700,
                        color: '#f59e0b',
                        textTransform: 'uppercase',
                        fontSize: '12px',
                        letterSpacing: '0.05em'
                      }}>
                        Expenses
                      </td>
                    </tr>
                    {profitAndLoss.expense.length === 0 ? (
                      <tr><td colSpan={3} style={{ ...s.td, color: '#94a3b8', textAlign: 'center' }}>No expense accounts</td></tr>
                    ) : (
                      profitAndLoss.expense.map(acc => (
                        <tr key={acc.id}>
                          <td style={s.tdMono}>{acc.code}</td>
                          <td style={{ ...s.td, fontWeight: 500 }}>{acc.name}</td>
                          <td style={{ ...s.tdRight, color: '#f59e0b', fontWeight: 600 }}>
                            {formatCurrency(Number(acc.balance) || 0)}
                          </td>
                        </tr>
                      ))
                    )}
                    <tr style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                      <td colSpan={2} style={{ ...s.td, fontWeight: 700, color: '#f59e0b' }}>Total Expenses</td>
                      <td style={{ ...s.tdRight, fontWeight: 700, color: '#f59e0b' }}>
                        {formatCurrency(profitAndLoss.totalExpense)}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr style={{ background: profitAndLoss.netIncome >= 0 ? '#ecfdf5' : '#fef2f2', borderTop: '2px solid #e2e8f0' }}>
                      <td colSpan={2} style={{
                        ...s.td,
                        fontWeight: 700,
                        fontSize: '15px',
                        color: profitAndLoss.netIncome >= 0 ? '#065f46' : '#991b1b'
                      }}>
                        {profitAndLoss.netIncome >= 0 ? 'Net Profit' : 'Net Loss'}
                      </td>
                      <td style={{
                        ...s.tdRight,
                        fontWeight: 700,
                        fontSize: '15px',
                        color: profitAndLoss.netIncome >= 0 ? '#065f46' : '#991b1b'
                      }}>
                        {formatCurrency(Math.abs(profitAndLoss.netIncome))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ──── Balance Sheet ──── */}
          {reportsSubTab === 'balance-sheet' && (
            <div style={s.card}>
              <div style={s.cardHeader}>
                <h3 style={s.cardTitle}>Balance Sheet</h3>
                <span style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  fontSize: '13px',
                  fontWeight: 700,
                  background: Math.abs(balanceSheet.totalAssets - balanceSheet.liabPlusEquity) < 0.01 ? '#ecfdf5' : '#fef2f2',
                  color: Math.abs(balanceSheet.totalAssets - balanceSheet.liabPlusEquity) < 0.01 ? '#065f46' : '#991b1b',
                  border: `1px solid ${Math.abs(balanceSheet.totalAssets - balanceSheet.liabPlusEquity) < 0.01 ? '#a7f3d0' : '#fecaca'}`
                }}>
                  {Math.abs(balanceSheet.totalAssets - balanceSheet.liabPlusEquity) < 0.01 ? 'Balanced' : 'Imbalanced'}
                </span>
              </div>

              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', padding: '20px 24px' }}>
                <div style={s.statCard('#3b82f6')}>
                  <div style={s.statLabel}>Total Assets</div>
                  <div style={s.statValue}>{formatCurrency(balanceSheet.totalAssets)}</div>
                </div>
                <div style={s.statCard('#ef4444')}>
                  <div style={s.statLabel}>Total Liabilities</div>
                  <div style={s.statValue}>{formatCurrency(balanceSheet.totalLiabilities)}</div>
                </div>
                <div style={s.statCard('#8b5cf6')}>
                  <div style={s.statLabel}>Total Equity</div>
                  <div style={s.statValue}>{formatCurrency(balanceSheet.totalEquity)}</div>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Code</th>
                      <th style={s.th}>Account Name</th>
                      <th style={s.thRight}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Assets */}
                    <tr style={{ background: '#eff6ff' }}>
                      <td colSpan={3} style={{
                        ...s.td, fontWeight: 700, color: '#3b82f6',
                        textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.05em'
                      }}>
                        Assets
                      </td>
                    </tr>
                    {balanceSheet.assets.length === 0 ? (
                      <tr><td colSpan={3} style={{ ...s.td, color: '#94a3b8', textAlign: 'center' }}>No asset accounts</td></tr>
                    ) : (
                      balanceSheet.assets.map(acc => (
                        <tr key={acc.id}>
                          <td style={s.tdMono}>{acc.code}</td>
                          <td style={{ ...s.td, fontWeight: 500 }}>{acc.name}</td>
                          <td style={{ ...s.tdRight, fontWeight: 600, color: (Number(acc.balance) || 0) < 0 ? '#ef4444' : '#1e293b' }}>
                            {formatCurrency(Number(acc.balance) || 0)}
                          </td>
                        </tr>
                      ))
                    )}
                    <tr style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                      <td colSpan={2} style={{ ...s.td, fontWeight: 700, color: '#3b82f6' }}>Total Assets</td>
                      <td style={{ ...s.tdRight, fontWeight: 700, color: '#3b82f6' }}>
                        {formatCurrency(balanceSheet.totalAssets)}
                      </td>
                    </tr>

                    {/* Liabilities */}
                    <tr style={{ background: '#fef2f2' }}>
                      <td colSpan={3} style={{
                        ...s.td, fontWeight: 700, color: '#ef4444',
                        textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.05em'
                      }}>
                        Liabilities
                      </td>
                    </tr>
                    {balanceSheet.liabilities.length === 0 ? (
                      <tr><td colSpan={3} style={{ ...s.td, color: '#94a3b8', textAlign: 'center' }}>No liability accounts</td></tr>
                    ) : (
                      balanceSheet.liabilities.map(acc => (
                        <tr key={acc.id}>
                          <td style={s.tdMono}>{acc.code}</td>
                          <td style={{ ...s.td, fontWeight: 500 }}>{acc.name}</td>
                          <td style={{ ...s.tdRight, fontWeight: 600, color: (Number(acc.balance) || 0) < 0 ? '#ef4444' : '#1e293b' }}>
                            {formatCurrency(Number(acc.balance) || 0)}
                          </td>
                        </tr>
                      ))
                    )}
                    <tr style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                      <td colSpan={2} style={{ ...s.td, fontWeight: 700, color: '#ef4444' }}>Total Liabilities</td>
                      <td style={{ ...s.tdRight, fontWeight: 700, color: '#ef4444' }}>
                        {formatCurrency(balanceSheet.totalLiabilities)}
                      </td>
                    </tr>

                    {/* Equity */}
                    <tr style={{ background: '#faf5ff' }}>
                      <td colSpan={3} style={{
                        ...s.td, fontWeight: 700, color: '#8b5cf6',
                        textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.05em'
                      }}>
                        Equity
                      </td>
                    </tr>
                    {balanceSheet.equity.length === 0 ? (
                      <tr><td colSpan={3} style={{ ...s.td, color: '#94a3b8', textAlign: 'center' }}>No equity accounts</td></tr>
                    ) : (
                      balanceSheet.equity.map(acc => (
                        <tr key={acc.id}>
                          <td style={s.tdMono}>{acc.code}</td>
                          <td style={{ ...s.td, fontWeight: 500 }}>{acc.name}</td>
                          <td style={{ ...s.tdRight, fontWeight: 600, color: (Number(acc.balance) || 0) < 0 ? '#ef4444' : '#1e293b' }}>
                            {formatCurrency(Number(acc.balance) || 0)}
                          </td>
                        </tr>
                      ))
                    )}
                    <tr style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                      <td colSpan={2} style={{ ...s.td, fontWeight: 700, color: '#8b5cf6' }}>Total Equity</td>
                      <td style={{ ...s.tdRight, fontWeight: 700, color: '#8b5cf6' }}>
                        {formatCurrency(balanceSheet.totalEquity)}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f1f5f9', borderTop: '2px solid #e2e8f0' }}>
                      <td colSpan={2} style={{ ...s.td, fontWeight: 700, color: '#ef4444', fontSize: '14px' }}>
                        Total Liabilities + Equity
                      </td>
                      <td style={{ ...s.tdRight, fontWeight: 700, color: '#ef4444', fontSize: '14px' }}>
                        {formatCurrency(balanceSheet.liabPlusEquity)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <div style={s.balanceBanner(Math.abs(balanceSheet.totalAssets - balanceSheet.liabPlusEquity) < 0.01)}>
                  {Math.abs(balanceSheet.totalAssets - balanceSheet.liabPlusEquity) < 0.01
                    ? 'Balance Sheet is balanced. Assets = Liabilities + Equity.'
                    : `Balance Sheet is IMBALANCED. Assets (${formatCurrency(balanceSheet.totalAssets)}) != Liabilities + Equity (${formatCurrency(balanceSheet.liabPlusEquity)}). Difference: ${formatCurrency(Math.abs(balanceSheet.totalAssets - balanceSheet.liabPlusEquity))}`
                  }
                </div>
              </div>
            </div>
          )}
        </>
      )}

        </div>
        {/* End main content area */}

        {/* ════════════════════════════════════════ */}
        {/*  AI Ledger Assistant Floating Panel      */}
        {/* ════════════════════════════════════════ */}
        {showAILedger && (
          <div style={{
            width: '350px',
            flexShrink: 0,
            background: '#fff',
            borderRadius: '14px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 8px 30px rgba(124,58,237,0.12)',
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 140px)',
            position: 'sticky',
            top: '20px',
            overflow: 'hidden',
          }}>
            {/* Panel Header */}
            <div style={{
              padding: '16px 20px',
              background: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93L12 22"/>
                  <path d="M8 6a4 4 0 0 1 8 0"/>
                  <path d="M17 12.5c1.77.54 3 2.18 3 4.1 0 2.38-1.94 4.4-4.5 4.4h-7C5.94 21 4 18.98 4 16.6c0-1.92 1.23-3.56 3-4.1"/>
                </svg>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>AI Ledger Assistant</span>
              </div>
              <button
                onClick={() => setShowAILedger(false)}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  color: '#fff',
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>

            {/* Chat History */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}>
              {aiLedgerHistory.length === 0 && (
                <div style={{
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: '13px',
                  padding: '30px 10px',
                  lineHeight: 1.6,
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.5 }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93L12 22"/>
                      <path d="M8 6a4 4 0 0 1 8 0"/>
                      <path d="M17 12.5c1.77.54 3 2.18 3 4.1 0 2.38-1.94 4.4-4.5 4.4h-7C5.94 21 4 18.98 4 16.6c0-1.92 1.23-3.56 3-4.1"/>
                    </svg>
                  </div>
                  Ask me to create journal entries, analyze your books, or explain accounting concepts.
                </div>
              )}

              {aiLedgerHistory.map((item, idx) => (
                <div key={idx}>
                  {item.role === 'user' ? (
                    // User message bubble
                    <div style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                    }}>
                      <div style={{
                        background: '#f1f5f9',
                        color: '#1e293b',
                        padding: '10px 14px',
                        borderRadius: '12px 12px 2px 12px',
                        fontSize: '13px',
                        fontWeight: 500,
                        maxWidth: '85%',
                        lineHeight: 1.5,
                        wordBreak: 'break-word',
                      }}>
                        {item.text}
                      </div>
                    </div>
                  ) : (
                    // Assistant message bubble
                    <div style={{
                      display: 'flex',
                      justifyContent: 'flex-start',
                    }}>
                      <div style={{
                        background: '#faf5ff',
                        border: '1px solid #e9d5ff',
                        color: '#1e293b',
                        padding: '12px 14px',
                        borderRadius: '12px 12px 12px 2px',
                        fontSize: '13px',
                        maxWidth: '95%',
                        lineHeight: 1.6,
                        wordBreak: 'break-word',
                      }}>
                        {/* Action badge */}
                        {item.action && (
                          <div style={{ marginBottom: '8px' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '3px 10px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              background: item.action === 'CREATE_JOURNAL_ENTRY' ? '#dbeafe' :
                                         item.action === 'ANALYZE' ? '#ecfdf5' :
                                         item.action === 'ERROR' ? '#fef2f2' :
                                         '#f1f5f9',
                              color: item.action === 'CREATE_JOURNAL_ENTRY' ? '#1d4ed8' :
                                     item.action === 'ANALYZE' ? '#065f46' :
                                     item.action === 'ERROR' ? '#dc2626' :
                                     '#475569',
                              border: `1px solid ${
                                item.action === 'CREATE_JOURNAL_ENTRY' ? '#93c5fd' :
                                item.action === 'ANALYZE' ? '#a7f3d0' :
                                item.action === 'ERROR' ? '#fecaca' :
                                '#e2e8f0'
                              }`,
                            }}>
                              {item.action.replace(/_/g, ' ')}
                            </span>
                            {item.executed && (
                              <span style={{
                                display: 'inline-block',
                                marginLeft: '6px',
                                padding: '3px 8px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: '#ecfdf5',
                                color: '#065f46',
                                border: '1px solid #a7f3d0',
                              }}>
                                Auto-executed
                              </span>
                            )}
                          </div>
                        )}

                        {/* Message text */}
                        <div style={{ fontWeight: 500 }}>{item.message}</div>

                        {/* Analysis text */}
                        {item.action === 'ANALYZE' && item.analysis && (
                          <div style={{
                            marginTop: '10px',
                            padding: '10px 12px',
                            background: '#fff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            fontSize: '12px',
                            lineHeight: 1.7,
                            color: '#334155',
                            whiteSpace: 'pre-wrap',
                          }}>
                            {item.analysis}
                          </div>
                        )}

                        {/* Suggestions */}
                        {item.suggestions && item.suggestions.length > 0 && (
                          <div style={{ marginTop: '8px' }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: '#7c3aed', marginBottom: '4px' }}>
                              Suggestions:
                            </div>
                            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#475569', lineHeight: 1.6 }}>
                              {item.suggestions.map((sug, si) => (
                                <li key={si}>{sug}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Journal entry preview with Apply button */}
                        {item.action === 'CREATE_JOURNAL_ENTRY' && item.entry && !item.executed && (
                          <div style={{
                            marginTop: '10px',
                            padding: '10px 12px',
                            background: '#fff',
                            border: '1px solid #dbeafe',
                            borderRadius: '8px',
                          }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#1d4ed8', marginBottom: '6px' }}>
                              Suggested Entry
                            </div>
                            {item.entry.description && (
                              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                                {item.entry.description}
                              </div>
                            )}
                            {item.entry.lines && (
                              <div style={{ fontSize: '11px', lineHeight: 1.8, marginBottom: '8px' }}>
                                {item.entry.lines.map((line, li) => (
                                  <div key={li} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    color: line.debit > 0 ? '#1e293b' : '#64748b',
                                    paddingLeft: line.credit > 0 ? '12px' : '0',
                                  }}>
                                    <span style={{ fontWeight: line.debit > 0 ? 600 : 400 }}>
                                      {line.credit > 0 && 'To '}
                                      {line.accountName || 'Account'}
                                    </span>
                                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                                      {line.debit > 0 ? `Dr ${formatCurrency(line.debit)}` : `Cr ${formatCurrency(line.credit)}`}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <button
                              onClick={() => applyAIEntry(item)}
                              style={{
                                width: '100%',
                                padding: '7px 14px',
                                background: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '6px',
                                fontWeight: 600,
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Apply to Journal Form
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Loading indicator */}
              {aiLedgerLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    background: '#faf5ff',
                    border: '1px solid #e9d5ff',
                    padding: '12px 18px',
                    borderRadius: '12px 12px 12px 2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: '#7c3aed',
                    fontSize: '13px',
                    fontWeight: 500,
                  }}>
                    <span style={{
                      display: 'inline-block',
                      width: 14,
                      height: 14,
                      border: '2px solid #e9d5ff',
                      borderTopColor: '#7c3aed',
                      borderRadius: '50%',
                      animation: 'aispin 0.8s linear infinite',
                    }} />
                    Thinking...
                  </div>
                </div>
              )}
            </div>

            {/* Quick Prompts */}
            {aiLedgerHistory.length === 0 && (
              <div style={{
                padding: '0 16px 10px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                flexShrink: 0,
              }}>
                {AI_LEDGER_QUICK_PROMPTS.map(qp => (
                  <button
                    key={qp}
                    type="button"
                    onClick={() => setAiLedgerPrompt(qp)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '14px',
                      border: '1px solid #e9d5ff',
                      background: '#fff',
                      color: '#7c3aed',
                      fontSize: '11px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      lineHeight: 1.3,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#f5f3ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                  >
                    {qp}
                  </button>
                ))}
              </div>
            )}

            {/* Input Area */}
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              gap: '8px',
              flexShrink: 0,
              background: '#fafafa',
            }}>
              <input
                type="text"
                value={aiLedgerPrompt}
                onChange={e => setAiLedgerPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAILedger();
                  }
                }}
                placeholder="Ask anything..."
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  border: '2px solid #e2e8f0',
                  borderRadius: '10px',
                  fontSize: '13px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  color: '#1e293b',
                  background: '#fff',
                }}
              />
              <button
                onClick={handleAILedger}
                disabled={aiLedgerLoading || !aiLedgerPrompt.trim()}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  border: 'none',
                  background: aiLedgerLoading || !aiLedgerPrompt.trim()
                    ? '#e2e8f0'
                    : 'linear-gradient(135deg, #7c3aed, #3b82f6)',
                  color: '#fff',
                  cursor: aiLedgerLoading || !aiLedgerPrompt.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.15s',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
      {/* End main content wrapper */}

      {/* AI spinner keyframes */}
      <style>{`
        @keyframes aispin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
