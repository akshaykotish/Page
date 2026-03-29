import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, getDocs, query, orderBy, where, limit } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, formatDate, getStatusColor } from '../utils/formatters';
import { useNavigate } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function Overview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const abortControllerRef = useRef(null);

  const [stats, setStats] = useState({
    totalRevenue: 0,
    pendingInvoices: 0,
    totalEmployees: 0,
    monthlyExpenses: 0
  });
  const [recentInvoices, setRecentInvoices] = useState([]);
  const [revenueData, setRevenueData] = useState({ labels: [], datasets: [] });
  const [financialSummary, setFinancialSummary] = useState({
    totalRevenue: 0,
    totalExpenses: 0,
    netProfit: 0,
    cashPosition: 0
  });
  const [invoiceStatusCounts, setInvoiceStatusCounts] = useState({
    draft: 0, sent: 0, paid: 0, overdue: 0, pending: 0
  });
  const [employeeBreakdown, setEmployeeBreakdown] = useState({ active: 0, inactive: 0, total: 0 });
  const [cashFlow, setCashFlow] = useState({ moneyIn: 0, moneyOut: 0 });
  const [recentJournalEntries, setRecentJournalEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    fetchDashboardData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function fetchDashboardData() {
    setLoading(true);
    setError('');
    try {
      await Promise.all([
        fetchStats(),
        fetchRecentInvoices(),
        fetchRevenueChart(),
        fetchFinancialSummary(),
        fetchInvoiceStatusDistribution(),
        fetchEmployeeBreakdown(),
        fetchCashFlow(),
        fetchRecentJournalEntries()
      ]);
    } catch (err) {
      if (err?.name === 'AbortError') {
        console.log('Dashboard data fetch aborted');
      } else {
        console.error('Error fetching dashboard data:', err);
        setError('Failed to load dashboard data. Please refresh the page.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchStats() {
    try {
      const paidQuery = query(
        collection(db, 'invoices'),
        where('status', '==', 'paid')
      );
      const paidSnap = await getDocs(paidQuery);
      let totalRevenue = 0;
      paidSnap.forEach(doc => {
        const data = doc.data();
        totalRevenue += data.total || data.grandTotal || data.amount || 0;
      });

      const pendingQuery = query(
        collection(db, 'invoices'),
        where('status', '==', 'pending')
      );
      const pendingSnap = await getDocs(pendingQuery);
      const pendingInvoices = pendingSnap.size;

      const employeesSnap = await getDocs(collection(db, 'employees'));
      const totalEmployees = employeesSnap.size;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
      const expensesQuery = query(
        collection(db, 'expenses'),
        where('date', '>=', monthStart),
        where('date', '<=', monthEnd)
      );
      let monthlyExpenses = 0;
      try {
        const expensesSnap = await getDocs(expensesQuery);
        expensesSnap.forEach(doc => {
          const data = doc.data();
          monthlyExpenses += data.amount || 0;
        });
      } catch {
        const allExpensesSnap = await getDocs(collection(db, 'expenses'));
        allExpensesSnap.forEach(doc => {
          const data = doc.data();
          const expDate = data.date ? new Date(data.date) : null;
          if (expDate && expDate.getMonth() === now.getMonth() && expDate.getFullYear() === now.getFullYear()) {
            monthlyExpenses += data.amount || 0;
          }
        });
      }

      setStats({ totalRevenue, pendingInvoices, totalEmployees, monthlyExpenses });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Error fetching stats:', err);
      }
    }
  }

  async function fetchRecentInvoices() {
    try {
      const q = query(
        collection(db, 'invoices'),
        orderBy('createdAt', 'desc'),
        limit(5)
      );
      const snap = await getDocs(q);
      const invoices = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRecentInvoices(invoices);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Error fetching recent invoices:', err);
      try {
        const fallbackSnap = await getDocs(collection(db, 'invoices'));
        const all = fallbackSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        all.sort((a, b) => {
          const da = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
          const db2 = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
          return db2 - da;
        });
        setRecentInvoices(all.slice(0, 5));
      } catch (fallbackErr) {
        if (fallbackErr?.name !== 'AbortError') {
          console.error('Fallback fetch also failed:', fallbackErr);
        }
      }
    }
  }

  async function fetchRevenueChart() {
    try {
      const paidQuery = query(
        collection(db, 'invoices'),
        where('status', '==', 'paid')
      );
      const snap = await getDocs(paidQuery);

      const now = new Date();
      const months = [];
      const monthTotals = {};

      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        months.push({ key, label });
        monthTotals[key] = 0;
      }

      snap.forEach(doc => {
        const data = doc.data();
        const dateVal = data.paidDate || data.date || data.createdAt;
        let d;
        if (dateVal?.toDate) {
          d = dateVal.toDate();
        } else if (dateVal) {
          d = new Date(dateVal);
        } else {
          return;
        }
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthTotals[key] !== undefined) {
          monthTotals[key] += data.total || data.grandTotal || data.amount || 0;
        }
      });

      setRevenueData({
        labels: months.map(m => m.label),
        datasets: [
          {
            label: 'Revenue',
            data: months.map(m => monthTotals[m.key]),
            backgroundColor: 'rgba(196, 164, 105, 0.7)',
            borderColor: 'rgba(196, 164, 105, 1)',
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Error fetching revenue chart data:', err);
      }
    }
  }

  async function fetchFinancialSummary() {
    try {
      const accountsSnap = await getDocs(collection(db, 'accounts'));
      let totalRevenue = 0;
      let totalExpenses = 0;
      let cashPosition = 0;

      accountsSnap.forEach(doc => {
        const data = doc.data();
        const balance = Number(data.balance) || 0;
        const type = (data.type || '').toLowerCase();
        const name = (data.name || '').toLowerCase();

        if (type === 'revenue') {
          totalRevenue += balance;
        } else if (type === 'expense') {
          totalExpenses += balance;
        }

        if (name.includes('cash') || name.includes('bank account') || name.includes('razorpay')) {
          cashPosition += balance;
        }
      });

      const netProfit = totalRevenue - totalExpenses;
      setFinancialSummary({ totalRevenue, totalExpenses, netProfit, cashPosition });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Error fetching financial summary:', err);
      }
    }
  }

  async function fetchRecentJournalEntries() {
    try {
      const q = query(
        collection(db, 'journal_entries'),
        orderBy('createdAt', 'desc'),
        limit(5)
      );
      const snap = await getDocs(q);
      setRecentJournalEntries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Error fetching recent journal entries:', err);
      try {
        const fallbackSnap = await getDocs(collection(db, 'journal_entries'));
        const all = fallbackSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        all.sort((a, b) => {
          const da = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
          const db2 = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
          return db2 - da;
        });
        setRecentJournalEntries(all.slice(0, 5));
      } catch (fallbackErr) {
        if (fallbackErr?.name !== 'AbortError') {
          console.error('Fallback journal entries fetch failed:', fallbackErr);
        }
      }
    }
  }

  async function fetchInvoiceStatusDistribution() {
    try {
      const snap = await getDocs(collection(db, 'invoices'));
      const counts = { draft: 0, sent: 0, paid: 0, overdue: 0, pending: 0 };
      const now = new Date();
      snap.forEach(doc => {
        const data = doc.data();
        let status = (data.status || 'draft').toLowerCase();
        if (status !== 'paid' && data.dueDate) {
          const due = data.dueDate?.toDate ? data.dueDate.toDate() : new Date(data.dueDate);
          if (due < now) {
            status = 'overdue';
          }
        }
        if (counts[status] !== undefined) {
          counts[status] += 1;
        } else {
          counts.draft += 1;
        }
      });
      setInvoiceStatusCounts(counts);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Error fetching invoice status distribution:', err);
      }
    }
  }

  async function fetchEmployeeBreakdown() {
    try {
      const snap = await getDocs(collection(db, 'employees'));
      let active = 0;
      let inactive = 0;
      snap.forEach(doc => {
        const data = doc.data();
        const status = (data.status || 'active').toLowerCase();
        if (status === 'inactive' || status === 'terminated' || status === 'resigned') {
          inactive += 1;
        } else {
          active += 1;
        }
      });
      setEmployeeBreakdown({ active, inactive, total: active + inactive });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Error fetching employee breakdown:', err);
      }
    }
  }

  async function fetchCashFlow() {
    try {
      const accountsSnap = await getDocs(collection(db, 'accounts'));
      let moneyIn = 0;
      let moneyOut = 0;

      accountsSnap.forEach(doc => {
        const data = doc.data();
        const balance = Number(data.balance) || 0;
        const type = (data.type || '').toLowerCase();

        if (type === 'revenue') {
          moneyIn += balance;
        } else if (type === 'expense') {
          moneyOut += balance;
        }
      });

      setCashFlow({ moneyIn, moneyOut });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Error fetching cash flow:', err);
      }
    }
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      title: {
        display: false
      },
      tooltip: {
        backgroundColor: '#1a1a1a',
        titleColor: '#c4a469',
        bodyColor: '#e0e0e0',
        borderColor: '#333',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: function (context) {
            return formatCurrency(context.parsed.y);
          }
        }
      }
    },
    scales: {
      x: {
        ticks: { color: '#999' },
        grid: { color: 'rgba(255,255,255,0.05)' }
      },
      y: {
        ticks: {
          color: '#999',
          callback: function (value) {
            if (value >= 100000) return `${(value / 100000).toFixed(1)}L`;
            if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
            return value;
          }
        },
        grid: { color: 'rgba(255,255,255,0.05)' }
      }
    }
  };

  function getInvoiceDate(invoice) {
    const raw = invoice.createdAt || invoice.date;
    if (!raw) return null;
    if (raw.toDate) return raw.toDate().toISOString();
    return raw;
  }

  const STAT_CARDS = [
    {
      title: 'Total Revenue',
      value: formatCurrency(stats.totalRevenue),
      icon: (
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>
        </svg>
      ),
      color: '#22c55e'
    },
    {
      title: 'Pending Invoices',
      value: stats.pendingInvoices,
      icon: (
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v7h7v9H6z"/>
        </svg>
      ),
      color: '#f59e0b'
    },
    {
      title: 'Total Employees',
      value: stats.totalEmployees,
      icon: (
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
      ),
      color: '#3b82f6'
    },
    {
      title: 'Expenses This Month',
      value: formatCurrency(stats.monthlyExpenses),
      icon: (
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
        </svg>
      ),
      color: '#ef4444'
    }
  ];

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loader"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="overview-page">
      {error && (
        <div style={{ padding: '12px 16px', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '8px', marginBottom: '20px', color: '#991b1b', fontSize: '14px', fontWeight: '500' }}>
          {error}
        </div>
      )}

      {/* Welcome Section */}
      <div className="overview-welcome">
        <h3>Welcome back, {user?.displayName || 'User'}</h3>
        <p>Here is what is happening with your business today.</p>
      </div>

      {/* Quick Action Buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <button
          onClick={() => navigate('/billing')}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: '8px',
            background: '#2563eb', color: '#fff', border: 'none',
            fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v7h7v9H6z"/></svg>
          New Invoice
        </button>
        <button
          onClick={() => navigate('/payments')}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: '8px',
            background: '#16a34a', color: '#fff', border: 'none',
            fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
          Record Payment
        </button>
        <button
          onClick={() => navigate('/expenses')}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: '8px',
            background: '#ea580c', color: '#fff', border: 'none',
            fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
          Add Expense
        </button>
        <button
          onClick={() => navigate('/payroll')}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: '8px',
            background: '#7c3aed', color: '#fff', border: 'none',
            fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
          Run Payroll
        </button>
      </div>

      {/* Stat Cards */}
      <div className="stats-grid">
        {STAT_CARDS.map((card) => (
          <div className="stat-card" key={card.title}>
            <div className="stat-icon" style={{ color: card.color }}>
              {card.icon}
            </div>
            <div className="stat-info">
              <span className="stat-label">{card.title}</span>
              <span className="stat-value">{card.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Financial Summary Cards */}
      <div style={{ marginTop: '8px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
          Financial Overview (from Accounts)
        </h3>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon" style={{ color: '#22c55e' }}>
              <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M5 12l5 5L20 7"/></svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Total Revenue</span>
              <span className="stat-value">{formatCurrency(financialSummary.totalRevenue)}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ color: '#ef4444' }}>
              <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M7 11v2h10v-2H7zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Total Expenses</span>
              <span className="stat-value">{formatCurrency(financialSummary.totalExpenses)}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ color: financialSummary.netProfit >= 0 ? '#22c55e' : '#ef4444' }}>
              <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Net Profit</span>
              <span className="stat-value" style={{ color: financialSummary.netProfit >= 0 ? '#22c55e' : '#ef4444' }}>
                {formatCurrency(financialSummary.netProfit)}
              </span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ color: '#3b82f6' }}>
              <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
            </div>
            <div className="stat-info">
              <span className="stat-label">Cash Position</span>
              <span className="stat-value">{formatCurrency(financialSummary.cashPosition)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice Status Distribution + Cash Flow + Employee Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginTop: '8px' }}>
        {/* Invoice Status Distribution */}
        <div className="card" style={{ padding: '20px' }}>
          <div className="card-header" style={{ marginBottom: '16px' }}>
            <h3>Invoice Status</h3>
            <span className="card-subtitle">Distribution by status</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { label: 'Draft', count: invoiceStatusCounts.draft, color: '#64748b', bg: '#f1f5f9' },
              { label: 'Sent', count: invoiceStatusCounts.sent, color: '#2563eb', bg: '#dbeafe' },
              { label: 'Pending', count: invoiceStatusCounts.pending, color: '#ca8a04', bg: '#fef9c3' },
              { label: 'Paid', count: invoiceStatusCounts.paid, color: '#16a34a', bg: '#dcfce7' },
              { label: 'Overdue', count: invoiceStatusCounts.overdue, color: '#dc2626', bg: '#fecaca' },
            ].map(item => {
              const total = invoiceStatusCounts.draft + invoiceStatusCounts.sent + invoiceStatusCounts.paid + invoiceStatusCounts.overdue + invoiceStatusCounts.pending;
              const pct = total > 0 ? ((item.count / total) * 100) : 0;
              return (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ width: '60px', fontSize: '0.8rem', fontWeight: 600, color: item.color }}>{item.label}</span>
                  <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: '4px', background: item.color, transition: 'width 0.4s' }} />
                  </div>
                  <span style={{ width: '30px', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', textAlign: 'right' }}>{item.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cash Flow Indicator */}
        <div className="card" style={{ padding: '20px' }}>
          <div className="card-header" style={{ marginBottom: '16px' }}>
            <h3>Cash Flow</h3>
            <span className="card-subtitle">Money in vs money out</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderRadius: '8px', background: 'rgba(34,197,94,0.08)' }}>
              <div>
                <div style={{ fontSize: '0.78rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>Money In</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#22c55e' }}>
                  {formatCurrency(cashFlow.moneyIn)}
                </div>
              </div>
              <svg viewBox="0 0 24 24" width="28" height="28" style={{ color: '#22c55e' }}><path fill="currentColor" d="M7 14l5-5 5 5z"/></svg>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)' }}>
              <div>
                <div style={{ fontSize: '0.78rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>Money Out</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#ef4444' }}>
                  {formatCurrency(cashFlow.moneyOut)}
                </div>
              </div>
              <svg viewBox="0 0 24 24" width="28" height="28" style={{ color: '#ef4444' }}><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderRadius: '8px', borderTop: '2px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontWeight: 700, color: '#e2e8f0' }}>Net Flow</span>
              <span style={{
                fontWeight: 700, fontSize: '1.1rem',
                fontFamily: "'JetBrains Mono', monospace",
                color: (cashFlow.moneyIn - cashFlow.moneyOut) >= 0 ? '#22c55e' : '#ef4444'
              }}>
                {formatCurrency(cashFlow.moneyIn - cashFlow.moneyOut)}
              </span>
            </div>
          </div>
        </div>

        {/* Employee Breakdown */}
        <div className="card" style={{ padding: '20px' }}>
          <div className="card-header" style={{ marginBottom: '16px' }}>
            <h3>Team</h3>
            <span className="card-subtitle">Employee breakdown</span>
          </div>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>
              {employeeBreakdown.total}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>Total Employees</div>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{
              flex: 1, padding: '14px', borderRadius: '8px',
              background: 'rgba(34,197,94,0.08)', textAlign: 'center'
            }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#22c55e' }}>{employeeBreakdown.active}</div>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>Active</div>
            </div>
            <div style={{
              flex: 1, padding: '14px', borderRadius: '8px',
              background: 'rgba(239,68,68,0.08)', textAlign: 'center'
            }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ef4444' }}>{employeeBreakdown.inactive}</div>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>Inactive</div>
            </div>
          </div>
        </div>
      </div>

      {/* P&L Summary + Recent Journal Entries */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px', marginTop: '8px' }}>
        {/* Mini P&L */}
        <div className="card" style={{ padding: '20px' }}>
          <div className="card-header" style={{ marginBottom: '16px' }}>
            <h3>Profit & Loss Summary</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: '#94a3b8' }}>Revenue</span>
              <span style={{ color: '#22c55e', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(financialSummary.totalRevenue)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: '#94a3b8' }}>Less: Expenses</span>
              <span style={{ color: '#ef4444', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>({formatCurrency(financialSummary.totalExpenses)})</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '2px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontWeight: 700, color: '#e2e8f0' }}>Net Profit / (Loss)</span>
              <span style={{
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                color: financialSummary.netProfit >= 0 ? '#22c55e' : '#ef4444'
              }}>
                {formatCurrency(financialSummary.netProfit)}
              </span>
            </div>
            {financialSummary.totalRevenue > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Profit Margin</span>
                <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontFamily: "'JetBrains Mono', monospace" }}>
                  {((financialSummary.netProfit / financialSummary.totalRevenue) * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Recent Journal Entries */}
        <div className="card" style={{ padding: '20px' }}>
          <div className="card-header" style={{ marginBottom: '16px' }}>
            <h3>Recent Journal Entries</h3>
            <span className="card-subtitle">Last 5 entries</span>
          </div>
          {recentJournalEntries.length === 0 ? (
            <div className="empty-state">
              <p>No journal entries yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recentJournalEntries.map(entry => {
                const entryDate = entry.createdAt?.toDate
                  ? entry.createdAt.toDate().toISOString()
                  : entry.createdAt || entry.date;
                return (
                  <div key={entry.id} style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#c4a469' }}>
                        {entry.entryNumber || `#${entry.id.slice(0, 6)}`}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {formatDate(entryDate)}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '4px' }}>
                      {entry.description || '—'}
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem' }}>
                      <span style={{ color: '#22c55e', fontFamily: "'JetBrains Mono', monospace" }}>
                        Dr {formatCurrency(entry.totalDebit || 0)}
                      </span>
                      <span style={{ color: '#ef4444', fontFamily: "'JetBrains Mono', monospace" }}>
                        Cr {formatCurrency(entry.totalCredit || 0)}
                      </span>
                      {entry.source && (
                        <span style={{
                          marginLeft: 'auto',
                          padding: '1px 8px',
                          borderRadius: '4px',
                          background: 'rgba(196,164,105,0.15)',
                          color: '#c4a469',
                          fontSize: '0.7rem',
                          textTransform: 'uppercase'
                        }}>
                          {entry.source}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="overview-grid">
        {/* Revenue Chart */}
        <div className="card chart-card">
          <div className="card-header">
            <h3>Revenue Overview</h3>
            <span className="card-subtitle">Last 6 months</span>
          </div>
          <div className="chart-container" style={{ height: '300px', padding: '16px' }}>
            {revenueData.labels.length > 0 ? (
              <Bar data={revenueData} options={chartOptions} />
            ) : (
              <div className="chart-empty">
                <p>No revenue data available yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Invoices */}
        <div className="card recent-activity-card">
          <div className="card-header">
            <h3>Recent Invoices</h3>
            <span className="card-subtitle">Latest activity</span>
          </div>
          <div className="card-body">
            {recentInvoices.length === 0 ? (
              <div className="empty-state">
                <p>No invoices found.</p>
              </div>
            ) : (
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Client</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="invoice-number">
                          {inv.invoiceNumber || inv.number || `#${inv.id.slice(0, 6)}`}
                        </td>
                        <td>{inv.clientName || inv.client || '—'}</td>
                        <td className="amount">
                          {formatCurrency(inv.total || inv.grandTotal || inv.amount || 0)}
                        </td>
                        <td>
                          <span
                            className="status-badge"
                            style={{ backgroundColor: getStatusColor(inv.status) }}
                          >
                            {inv.status || 'draft'}
                          </span>
                        </td>
                        <td>{formatDate(getInvoiceDate(inv))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
