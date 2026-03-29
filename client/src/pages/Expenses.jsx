import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, where } from 'firebase/firestore';
import { formatCurrency, formatDate, getCurrentMonth, getStatusColor } from '../utils/formatters';
import { GST_RATES, calculateGST } from '../utils/gst';
import { api } from '../utils/api';

const CATEGORIES = [
  'Office', 'Travel', 'Utilities', 'Software', 'Marketing',
  'Salaries', 'Rent', 'Equipment', 'Other'
];

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'UPI', 'Credit Card', 'Other'];

const EMPTY_FORM = {
  date: new Date().toISOString().split('T')[0],
  category: 'Office',
  description: '',
  vendor: '',
  amount: '',
  gstRate: 18,
  paymentMethod: 'Bank Transfer'
};

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState(getCurrentMonth());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const abortControllerRef = useRef(null);

  // Fetch expenses
  useEffect(() => {
    fetchExpenses();
  }, [monthFilter]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function fetchExpenses() {
    setLoading(true);
    setError('');
    try {
      const [year, month] = monthFilter.split('-');
      const startDate = `${year}-${month}-01`;
      const endMonth = parseInt(month, 10);
      const endYear = parseInt(year, 10);
      const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
      const nextYear = endMonth === 12 ? endYear + 1 : endYear;
      const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

      const q = query(
        collection(db, 'expenses'),
        where('date', '>=', startDate),
        where('date', '<', endDate),
        orderBy('date', 'desc')
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setExpenses(data);
    } catch (err) {
      console.error('Error fetching expenses:', err);
      setError('Failed to load expenses. Please try again.');
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  }

  // Auto-calculate GST amount
  const gstAmount = useMemo(() => {
    const amt = parseFloat(form.amount) || 0;
    const rate = parseFloat(form.gstRate) || 0;
    return amt * (rate / 100);
  }, [form.amount, form.gstRate]);

  const totalWithGST = useMemo(() => {
    return (parseFloat(form.amount) || 0) + gstAmount;
  }, [form.amount, gstAmount]);

  // Summary calculations
  const summary = useMemo(() => {
    let totalAmount = 0;
    let totalGST = 0;
    let totalWithTax = 0;
    const byCategory = {};

    expenses.forEach(exp => {
      const amt = parseFloat(exp.amount) || 0;
      const gst = parseFloat(exp.gstAmount) || 0;
      totalAmount += amt;
      totalGST += gst;
      totalWithTax += amt + gst;

      if (!byCategory[exp.category]) {
        byCategory[exp.category] = { count: 0, amount: 0, gst: 0 };
      }
      byCategory[exp.category].count += 1;
      byCategory[exp.category].amount += amt;
      byCategory[exp.category].gst += gst;
    });

    return { totalAmount, totalGST, totalWithTax, byCategory };
  }, [expenses]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function openAddForm() {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setShowForm(true);
    setError('');
  }

  function openEditForm(expense) {
    setForm({
      date: expense.date || '',
      category: expense.category || 'Office',
      description: expense.description || '',
      vendor: expense.vendor || '',
      amount: expense.amount?.toString() || '',
      gstRate: expense.gstRate?.toString() || '18',
      paymentMethod: expense.paymentMethod || 'Bank Transfer'
    });
    setEditingId(expense.id);
    setShowForm(true);
    setError('');
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.date || !form.description || !form.amount) return;

    setSaving(true);
    setError('');
    try {
      const amount = parseFloat(form.amount) || 0;
      const gstRate = parseFloat(form.gstRate) || 0;
      const gstAmt = amount * (gstRate / 100);

      const expenseData = {
        date: form.date,
        category: form.category,
        description: form.description.trim(),
        vendor: form.vendor.trim(),
        amount,
        gstRate,
        gstAmount: gstAmt,
        totalAmount: amount + gstAmt,
        paymentMethod: form.paymentMethod,
        updatedAt: new Date().toISOString()
      };

      if (editingId) {
        await updateDoc(doc(db, 'expenses', editingId), expenseData);
        // Post updated expense to ledger
        try {
          await api.post('/expenses/post-to-ledger', {
            expenseId: editingId,
            amount: expenseData.totalAmount,
            gstAmount: expenseData.gstAmount,
            category: expenseData.category,
            description: expenseData.description,
            date: expenseData.date
          });
        } catch (ledgerErr) {
          console.warn('Expense saved but ledger posting failed:', ledgerErr);
        }
      } else {
        expenseData.createdAt = new Date().toISOString();
        const docRef = await addDoc(collection(db, 'expenses'), expenseData);
        // Post new expense to accounting ledger
        try {
          await api.post('/expenses/post-to-ledger', {
            expenseId: docRef.id,
            amount: expenseData.totalAmount,
            gstAmount: expenseData.gstAmount,
            category: expenseData.category,
            description: expenseData.description,
            date: expenseData.date
          });
        } catch (ledgerErr) {
          console.warn('Expense saved but ledger posting failed:', ledgerErr);
        }
      }

      cancelForm();
      await fetchExpenses();
    } catch (err) {
      console.error('Error saving expense:', err);
      setError('Failed to save expense. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteDoc(doc(db, 'expenses', id));
      setExpenses(prev => prev.filter(e => e.id !== id));
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Error deleting expense:', err);
      setError('Failed to delete expense. Please try again.');
    }
  }

  const categoryColors = {
    Office: '#3b82f6',
    Travel: '#f59e0b',
    Utilities: '#8b5cf6',
    Software: '#06b6d4',
    Marketing: '#ec4899',
    Salaries: '#22c55e',
    Rent: '#ef4444',
    Equipment: '#f97316',
    Other: '#6b7280'
  };

  return (
    <div className="page-expenses">
      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Total Expenses (Pre-Tax)
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1e293b' }}>
            {formatCurrency(summary.totalAmount)}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
            {expenses.length} expense{expenses.length !== 1 ? 's' : ''} this month
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            GST Paid (Input Tax Credit)
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f59e0b' }}>
            {formatCurrency(summary.totalGST)}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
            Claimable as ITC
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Total with GST
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ef4444' }}>
            {formatCurrency(summary.totalWithTax)}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
            Gross outflow
          </div>
        </div>
      </div>

      {/* Category Breakdown */}
      {Object.keys(summary.byCategory).length > 0 && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
            Breakdown by Category
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {Object.entries(summary.byCategory)
              .sort((a, b) => b[1].amount - a[1].amount)
              .map(([cat, data]) => (
                <div key={cat} style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  minWidth: '160px',
                  flex: '1 1 160px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: categoryColors[cat] || '#6b7280', display: 'inline-block'
                    }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#374151' }}>{cat}</span>
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af', marginLeft: 'auto' }}>
                      {data.count}
                    </span>
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
                    {formatCurrency(data.amount)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    GST: {formatCurrency(data.gst)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 500, color: '#374151' }}>Month:</label>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '0.85rem',
                background: '#fff',
                color: '#1e293b'
              }}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={openAddForm}
            disabled={saving}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            Add Expense
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', background: '#fee2e2', border: '1px solid #fca5a5' }}>
          <div style={{ color: '#991b1b', fontWeight: 500 }}>{error}</div>
        </div>
      )}

      {/* Add / Edit Form */}
      {showForm && (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: '2px solid #2563eb' }}>
          <h3 style={{ margin: '0 0 1.25rem 0', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
            {editingId ? 'Edit Expense' : 'Add New Expense'}
          </h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              {/* Date */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.35rem' }}>
                  Date *
                </label>
                <input
                  type="date"
                  name="date"
                  value={form.date}
                  onChange={handleChange}
                  required
                  disabled={saving}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.85rem', background: '#fff', color: '#1e293b',
                    boxSizing: 'border-box', opacity: saving ? 0.6 : 1
                  }}
                />
              </div>

              {/* Category */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.35rem' }}>
                  Category *
                </label>
                <select
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                  required
                  disabled={saving}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.85rem', background: '#fff', color: '#1e293b',
                    boxSizing: 'border-box', opacity: saving ? 0.6 : 1
                  }}
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 1' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.35rem' }}>
                  Description *
                </label>
                <input
                  type="text"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="e.g., Office supplies from Amazon"
                  required
                  disabled={saving}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.85rem', background: '#fff', color: '#1e293b',
                    boxSizing: 'border-box', opacity: saving ? 0.6 : 1
                  }}
                />
              </div>

              {/* Vendor */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.35rem' }}>
                  Vendor Name
                </label>
                <input
                  type="text"
                  name="vendor"
                  value={form.vendor}
                  onChange={handleChange}
                  placeholder="e.g., Amazon India"
                  disabled={saving}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.85rem', background: '#fff', color: '#1e293b',
                    boxSizing: 'border-box', opacity: saving ? 0.6 : 1
                  }}
                />
              </div>

              {/* Amount */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.35rem' }}>
                  Amount (Pre-Tax) *
                </label>
                <input
                  type="number"
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  required
                  disabled={saving}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.85rem', background: '#fff', color: '#1e293b',
                    boxSizing: 'border-box', opacity: saving ? 0.6 : 1
                  }}
                />
              </div>

              {/* GST Rate */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.35rem' }}>
                  GST Rate
                </label>
                <select
                  name="gstRate"
                  value={form.gstRate}
                  onChange={handleChange}
                  disabled={saving}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.85rem', background: '#fff', color: '#1e293b',
                    boxSizing: 'border-box', opacity: saving ? 0.6 : 1
                  }}
                >
                  {GST_RATES.map(rate => (
                    <option key={rate} value={rate}>{rate}%</option>
                  ))}
                </select>
              </div>

              {/* Payment Method */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.35rem' }}>
                  Payment Method
                </label>
                <select
                  name="paymentMethod"
                  value={form.paymentMethod}
                  onChange={handleChange}
                  disabled={saving}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.85rem', background: '#fff', color: '#1e293b',
                    boxSizing: 'border-box', opacity: saving ? 0.6 : 1
                  }}
                >
                  {PAYMENT_METHODS.map(method => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* GST Auto-Calculation Display */}
            {form.amount && (
              <div style={{
                margin: '1rem 0 0',
                padding: '0.75rem 1rem',
                background: '#eff6ff',
                borderRadius: '6px',
                border: '1px solid #bfdbfe',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1.5rem',
                fontSize: '0.85rem'
              }}>
                <div>
                  <span style={{ color: '#6b7280' }}>Base Amount: </span>
                  <strong style={{ color: '#1e293b' }}>{formatCurrency(parseFloat(form.amount) || 0)}</strong>
                </div>
                <div>
                  <span style={{ color: '#6b7280' }}>GST ({form.gstRate}%): </span>
                  <strong style={{ color: '#f59e0b' }}>{formatCurrency(gstAmount)}</strong>
                </div>
                <div>
                  <span style={{ color: '#6b7280' }}>Total: </span>
                  <strong style={{ color: '#2563eb' }}>{formatCurrency(totalWithGST)}</strong>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: '0.5rem 1.5rem',
                  borderRadius: '6px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1
                }}
              >
                {saving ? 'Saving...' : (editingId ? 'Update Expense' : 'Add Expense')}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                disabled={saving}
                style={{
                  padding: '0.5rem 1.5rem',
                  borderRadius: '6px',
                  background: '#f1f5f9',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Expenses Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Vendor</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>GST</th>
                <th style={thStyle}>Payment Method</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                    Loading expenses...
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                    No expenses found for this month. Click "Add Expense" to create one.
                  </td>
                </tr>
              ) : (
                expenses.map(exp => (
                  <tr key={exp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={tdStyle}>{formatDate(exp.date)}</td>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '12px',
                        background: `${categoryColors[exp.category] || '#6b7280'}15`,
                        color: categoryColors[exp.category] || '#6b7280',
                        fontSize: '0.8rem',
                        fontWeight: 500
                      }}>
                        <span style={{
                          width: '6px', height: '6px', borderRadius: '50%',
                          background: categoryColors[exp.category] || '#6b7280'
                        }} />
                        {exp.category}
                      </span>
                    </td>
                    <td style={tdStyle}>{exp.description}</td>
                    <td style={{ ...tdStyle, color: '#6b7280' }}>{exp.vendor || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500, fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatCurrency(exp.amount)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#f59e0b', fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatCurrency(exp.gstAmount)}
                      <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>@{exp.gstRate}%</div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        background: '#f1f5f9',
                        fontSize: '0.78rem',
                        color: '#475569'
                      }}>
                        {exp.paymentMethod}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                        <button
                          onClick={() => openEditForm(exp)}
                          disabled={saving}
                          title="Edit"
                          style={{
                            padding: '0.3rem 0.5rem',
                            borderRadius: '4px',
                            border: '1px solid #d1d5db',
                            background: '#fff',
                            cursor: saving ? 'not-allowed' : 'pointer',
                            color: '#2563eb',
                            display: 'flex',
                            alignItems: 'center',
                            opacity: saving ? 0.5 : 1
                          }}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14">
                            <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(exp.id)}
                          disabled={saving}
                          title="Delete"
                          style={{
                            padding: '0.3rem 0.5rem',
                            borderRadius: '4px',
                            border: '1px solid #fecaca',
                            background: '#fff',
                            cursor: saving ? 'not-allowed' : 'pointer',
                            color: '#ef4444',
                            display: 'flex',
                            alignItems: 'center',
                            opacity: saving ? 0.5 : 1
                          }}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14">
                            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {expenses.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                  <td colSpan={4} style={{ ...tdStyle, fontWeight: 600, color: '#1e293b' }}>
                    Total ({expenses.length} expense{expenses.length !== 1 ? 's' : ''})
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#1e293b' }}>
                    {formatCurrency(summary.totalAmount)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#f59e0b' }}>
                    {formatCurrency(summary.totalGST)}
                  </td>
                  <td colSpan={2} style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#2563eb' }}>
                    Gross: {formatCurrency(summary.totalWithTax)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '400px' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
              Delete Expense?
            </h3>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
              Are you sure you want to delete this expense? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  padding: '0.5rem 1.5rem',
                  borderRadius: '6px',
                  background: '#f1f5f9',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                style={{
                  padding: '0.5rem 1.5rem',
                  borderRadius: '6px',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Shared table styles
const thStyle = {
  padding: '0.75rem 1rem',
  textAlign: 'left',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap'
};

const tdStyle = {
  padding: '0.75rem 1rem',
  color: '#1e293b',
  whiteSpace: 'nowrap'
};
