import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Professional Fees', 'Office Supplies', 'Travel', 'Marketing', 'Software', 'Insurance', 'Other'];
const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card'];

const fmt = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [month, setMonth] = useState(getCurrentMonth());
  const [categoryFilter, setCategoryFilter] = useState('');

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', category: 'Other', description: '', vendor: '', paymentMethod: 'Bank Transfer', gstAmount: '' });
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(null);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (month) params.set('month', month);
      const data = await api.get(`/expenses?${params}`);
      setExpenses(data.expenses || []);
      setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
    } catch (err) {
      setError(err.message || 'Failed to load expenses');
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); } }, [success]);

  function resetForm() {
    setForm({ date: new Date().toISOString().slice(0, 10), amount: '', category: 'Other', description: '', vendor: '', paymentMethod: 'Bank Transfer', gstAmount: '' });
    setEditId(null);
    setShowForm(false);
  }

  function startEdit(exp) {
    setForm({
      date: exp.date || '',
      amount: String(exp.amount || ''),
      category: exp.category || 'Other',
      description: exp.description || '',
      vendor: exp.vendor || '',
      paymentMethod: exp.paymentMethod || 'Bank Transfer',
      gstAmount: String(exp.gstAmount || ''),
    });
    setEditId(exp.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.date || !form.amount || !form.category) return setError('Date, amount, and category are required');
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) return setError('Amount must be greater than 0');

    setSaving(true);
    setError('');
    const body = {
      date: form.date,
      amount: amt,
      category: form.category,
      description: form.description,
      vendor: form.vendor,
      paymentMethod: form.paymentMethod,
      gstAmount: form.gstAmount ? parseFloat(form.gstAmount) : 0,
    };

    try {
      if (editId) {
        await api.put(`/expenses/${editId}`, body);
        setSuccess('Expense updated');
      } else {
        await api.post('/expenses', body);
        setSuccess('Expense created');
      }
      resetForm();
      load(pagination.page);
    } catch (err) {
      setError(err.message || 'Failed to save expense');
    }
    setSaving(false);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this expense? This cannot be undone.')) return;
    try {
      await api.delete(`/expenses/${id}`);
      setSuccess('Expense deleted');
      load(pagination.page);
    } catch (err) {
      setError(err.message || 'Failed to delete');
    }
  }

  async function handlePostToLedger(exp) {
    if (exp.postedToLedger) return;
    setPosting(exp.id);
    try {
      await api.post(`/expenses/${exp.id}/post-to-ledger`, {
        amount: exp.amount,
        category: exp.category,
        date: exp.date,
        gstAmount: exp.gstAmount || 0,
        description: exp.description,
      });
      setSuccess('Expense posted to ledger');
      load(pagination.page);
    } catch (err) {
      setError(err.message || 'Failed to post to ledger');
    }
    setPosting(null);
  }

  // Filtered expenses (client-side category filter on top of server-side month filter)
  const filtered = categoryFilter ? expenses.filter(e => e.category === categoryFilter) : expenses;

  // Summary cards
  const totalExpenses = filtered.reduce((s, e) => s + (e.amount || 0), 0);
  const postedTotal = filtered.filter(e => e.postedToLedger).reduce((s, e) => s + (e.amount || 0), 0);
  const unpostedTotal = filtered.filter(e => !e.postedToLedger).reduce((s, e) => s + (e.amount || 0), 0);
  const gstCredit = filtered.reduce((s, e) => s + (e.gstAmount || 0), 0);

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 24, color: '#1a1a1a', margin: 0 }}>Expenses</h2>
        <button onClick={() => { if (showForm) resetForm(); else setShowForm(true); }} style={{ padding: '8px 20px', background: showForm ? '#64748b' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {showForm ? 'Cancel' : '+ New Expense'}
        </button>
      </div>

      {/* Messages */}
      {error && <div style={{ padding: '8px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {success && <div style={{ padding: '8px 16px', background: '#f0fdf4', color: '#16a34a', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{success}</div>}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        <SummaryCard label="Total Expenses" value={`₹${fmt(totalExpenses)}`} color="#1e40af" />
        <SummaryCard label="Posted to Ledger" value={`₹${fmt(postedTotal)}`} color="#2e7d32" />
        <SummaryCard label="Unposted" value={`₹${fmt(unpostedTotal)}`} color="#b45309" />
        <SummaryCard label="GST Input Credit" value={`₹${fmt(gstCredit)}`} color="#7c3aed" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginRight: 6 }}>Month:</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginRight: 6 }}>Category:</label>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}>
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>{editId ? 'Edit Expense' : 'Add New Expense'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Date *" type="date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
            <Field label="Amount *" type="number" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} placeholder="0.00" step="0.01" />
            <div style={{ marginBottom: 4 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Category *</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <Field label="Vendor" value={form.vendor} onChange={v => setForm(f => ({ ...f, vendor: v }))} placeholder="Vendor name" />
            <div style={{ marginBottom: 4 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Payment Method</label>
              <select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <Field label="GST Amount" type="number" value={form.gstAmount} onChange={v => setForm(f => ({ ...f, gstAmount: v }))} placeholder="0.00" step="0.01" />
          </div>
          <Field label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Brief description" full />
          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <button type="submit" disabled={saving} style={{ padding: '10px 28px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving...' : editId ? 'Update Expense' : 'Add Expense'}
            </button>
            {editId && <button type="button" onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel Edit</button>}
          </div>
        </form>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading expenses...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          No expenses found{month ? ` for ${month}` : ''}{categoryFilter ? ` in ${categoryFilter}` : ''}. Click "+ New Expense" to add one.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: "'Poppins',sans-serif" }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={th}>Date</th>
                  <th style={th}>Category</th>
                  <th style={th}>Description</th>
                  <th style={th}>Vendor</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={{ ...th, textAlign: 'right' }}>GST</th>
                  <th style={th}>Method</th>
                  <th style={{ ...th, textAlign: 'center' }}>Status</th>
                  <th style={{ ...th, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(exp => (
                  <tr key={exp.id} style={{ borderBottom: '1px solid #e5e7eb' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={td}>{exp.date}</td>
                    <td style={td}><span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#475569' }}>{exp.category}</span></td>
                    <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exp.description || '-'}</td>
                    <td style={td}>{exp.vendor || '-'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>₹{fmt(exp.amount)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#7c3aed' }}>{exp.gstAmount ? `₹${fmt(exp.gstAmount)}` : '-'}</td>
                    <td style={td}>{exp.paymentMethod || '-'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {exp.postedToLedger
                        ? <span style={{ background: '#dcfce7', color: '#16a34a', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>Posted</span>
                        : <span style={{ background: '#f1f5f9', color: '#94a3b8', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>Unposted</span>
                      }
                    </td>
                    <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {!exp.postedToLedger && (
                        <button onClick={() => handlePostToLedger(exp)} disabled={posting === exp.id} style={{ padding: '3px 8px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', marginRight: 4, opacity: posting === exp.id ? 0.6 : 1 }}>
                          {posting === exp.id ? '...' : 'Post'}
                        </button>
                      )}
                      <button onClick={() => startEdit(exp)} style={{ padding: '3px 8px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', marginRight: 4 }}>Edit</button>
                      <button onClick={() => handleDelete(exp.id)} style={{ padding: '3px 8px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <button disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)} style={pgBtn}>Prev</button>
              <span style={{ fontSize: 12, color: '#475569' }}>Page {pagination.page} of {pagination.pages} ({pagination.total} total)</span>
              <button disabled={pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)} style={pgBtn}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px 20px', borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "'Poppins',sans-serif" }}>{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, full, type = 'text', step }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined, marginBottom: 4 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} step={step} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
    </div>
  );
}

const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#475569', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' };
const td = { padding: '10px 12px', color: '#1a1a1a' };
const pgBtn = { padding: '6px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' };
