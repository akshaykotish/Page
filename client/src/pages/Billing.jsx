import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir',
  'Ladakh','Lakshadweep','Puducherry',
];

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'paid', label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLORS = {
  draft: { bg: '#f1f5f9', color: '#64748b', border: '#cbd5e1' },
  sent: { bg: '#eff6ff', color: '#2563eb', border: '#93c5fd' },
  paid: { bg: '#f0fdf4', color: '#16a34a', border: '#86efac' },
  overdue: { bg: '#fef2f2', color: '#dc2626', border: '#fca5a5' },
  cancelled: { bg: '#f9fafb', color: '#6b7280', border: '#d1d5db' },
};

const EMPTY_ITEM = { description: '', hsn: '', qty: 1, rate: 0, gstRate: 18 };

const fmtCurrency = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v || 0);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = {
  page: { padding: '0 24px 40px', maxWidth: 1100, margin: '0 auto' },
  heading: { fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 24, color: '#1a1a1a', margin: 0 },
  subheading: { fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 18, color: '#1a1a1a', margin: 0 },
  btnPrimary: { padding: '8px 20px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '8px 20px', background: '#64748b', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnDanger: { padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 },
  btnSmall: { padding: '5px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600, background: '#fff', color: '#374151' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20 },
  error: { padding: '8px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 12, fontSize: 13 },
  success: { padding: '8px 16px', background: '#f0fdf4', color: '#16a34a', borderRadius: 6, marginBottom: 12, fontSize: 13 },
  empty: { padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' },
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 },
  input: { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  select: { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff' },
  th: { padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb', background: '#f8fafc', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' },
  td: { padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontSize: 13, color: '#1a1a1a', verticalAlign: 'middle' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 10, width: '100%', maxWidth: 860, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
};

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Billing() {
  // List state
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Summary state
  const [summary, setSummary] = useState({ total: 0, paid: 0, pending: 0, overdue: 0, revenue: 0, paidAmount: 0, pendingAmount: 0, overdueAmount: 0 });

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);

  // Action loading
  const [actionLoading, setActionLoading] = useState({});

  // ─── Load Invoices ──────────────────────────────────────────────────────

  const loadInvoices = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('customer', search);
      const res = await api.get(`/billing/invoices?${params}`);
      setInvoices(res.data || []);
      setPagination(res.pagination || { page: 1, pages: 1, total: 0 });
    } catch (err) {
      setError(err.message || 'Failed to load invoices');
    }
    setLoading(false);
  }, [statusFilter, search]);

  const loadSummary = useCallback(async () => {
    try {
      // Load all invoices without pagination to compute summary
      const all = await api.get('/billing/invoices?limit=100');
      const data = all.data || [];
      const totals = { total: data.length, paid: 0, pending: 0, overdue: 0, revenue: 0, paidAmount: 0, pendingAmount: 0, overdueAmount: 0 };
      data.forEach(inv => {
        totals.revenue += inv.total || 0;
        if (inv.status === 'paid') { totals.paid++; totals.paidAmount += inv.total || 0; }
        else if (inv.status === 'overdue') { totals.overdue++; totals.overdueAmount += inv.total || 0; }
        else if (inv.status === 'draft' || inv.status === 'sent') { totals.pending++; totals.pendingAmount += inv.total || 0; }
      });
      setSummary(totals);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadInvoices(); loadSummary(); }, [loadInvoices, loadSummary]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Clear messages after delay
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t); }
  }, [success]);

  // ─── Actions ────────────────────────────────────────────────────────────

  async function handleStatusUpdate(id, newStatus) {
    setActionLoading(prev => ({ ...prev, [id]: newStatus }));
    try {
      await api.patch(`/billing/invoices/${id}/status`, { status: newStatus });
      setSuccess(`Invoice marked as ${newStatus}`);
      loadInvoices(pagination.page);
      loadSummary();
      if (showDetail?.id === id) setShowDetail(prev => ({ ...prev, status: newStatus }));
    } catch (err) {
      setError(err.message || 'Failed to update status');
    }
    setActionLoading(prev => ({ ...prev, [id]: null }));
  }

  async function handleSendEmail(id) {
    setActionLoading(prev => ({ ...prev, [`email_${id}`]: true }));
    try {
      const res = await api.post(`/billing/invoices/${id}/send-email`, {});
      setSuccess(res.message || 'Invoice sent via email');
    } catch (err) {
      setError(err.message || 'Failed to send email');
    }
    setActionLoading(prev => ({ ...prev, [`email_${id}`]: false }));
  }

  async function handleDelete(id, invoiceNumber) {
    if (!confirm(`Delete invoice ${invoiceNumber}? This cannot be undone.`)) return;
    setActionLoading(prev => ({ ...prev, [`del_${id}`]: true }));
    try {
      await api.delete(`/billing/invoices/${id}`);
      setSuccess('Invoice deleted');
      setShowDetail(null);
      loadInvoices(pagination.page);
      loadSummary();
    } catch (err) {
      setError(err.message || 'Failed to delete');
    }
    setActionLoading(prev => ({ ...prev, [`del_${id}`]: false }));
  }

  function handleCreated(invoice) {
    setShowCreate(false);
    setSuccess(`Invoice ${invoice.invoiceNumber} created`);
    loadInvoices(1);
    loadSummary();
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={s.heading}>Billing & Invoices</h2>
        <button onClick={() => setShowCreate(true)} style={s.btnPrimary}>+ New Invoice</button>
      </div>

      {error && <div style={s.error}>{error} <span onClick={() => setError('')} style={{ cursor: 'pointer', float: 'right', fontWeight: 700 }}>x</span></div>}
      {success && <div style={s.success}>{success}</div>}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
        <SummaryCard label="Total Revenue" value={fmtCurrency(summary.revenue)} sub={`${summary.total} invoices`} color="#2e7d32" />
        <SummaryCard label="Paid" value={fmtCurrency(summary.paidAmount)} sub={`${summary.paid} invoices`} color="#16a34a" />
        <SummaryCard label="Pending" value={fmtCurrency(summary.pendingAmount)} sub={`${summary.pending} invoices`} color="#d97706" />
        <SummaryCard label="Overdue" value={fmtCurrency(summary.overdueAmount)} sub={`${summary.overdue} invoices`} color="#dc2626" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Status Tabs */}
        <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid #d1d5db' }}>
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              style={{
                padding: '7px 14px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: statusFilter === tab.key ? '#2e7d32' : '#fff',
                color: statusFilter === tab.key ? '#fff' : '#475569',
                borderRight: '1px solid #d1d5db',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {/* Search */}
        <div style={{ flex: 1, minWidth: 180 }}>
          <input
            placeholder="Search customer..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{ ...s.input, maxWidth: 280 }}
          />
        </div>
      </div>

      {/* Invoice Table */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading invoices...</div>
      ) : invoices.length === 0 ? (
        <div style={s.empty}>
          {search || statusFilter ? 'No invoices match your filters.' : 'No invoices yet. Click "+ New Invoice" to create one.'}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
              <thead>
                <tr>
                  <th style={s.th}>Invoice #</th>
                  <th style={s.th}>Customer</th>
                  <th style={s.th}>Date</th>
                  <th style={s.th}>Due Date</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Amount</th>
                  <th style={s.th}>Status</th>
                  <th style={{ ...s.th, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr
                    key={inv.id}
                    style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                    onClick={() => setShowDetail(inv)}
                  >
                    <td style={{ ...s.td, fontWeight: 700, color: '#2e7d32', fontSize: 12 }}>{inv.invoiceNumber || inv.id?.slice(0, 8)}</td>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{inv.customer?.name || '-'}</div>
                      {inv.customer?.email && <div style={{ fontSize: 11, color: '#94a3b8' }}>{inv.customer.email}</div>}
                    </td>
                    <td style={{ ...s.td, fontSize: 12, color: '#64748b' }}>{fmtDate(inv.date || inv.createdAt)}</td>
                    <td style={{ ...s.td, fontSize: 12, color: '#64748b' }}>{fmtDate(inv.dueDate)}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{fmtCurrency(inv.total)}</td>
                    <td style={s.td}><StatusBadge status={inv.status} /></td>
                    <td style={{ ...s.td, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                        {inv.status === 'draft' && (
                          <button
                            onClick={() => handleStatusUpdate(inv.id, 'sent')}
                            disabled={actionLoading[inv.id]}
                            style={{ ...s.btnSmall, color: '#2563eb', borderColor: '#93c5fd' }}
                          >
                            {actionLoading[inv.id] === 'sent' ? '...' : 'Send'}
                          </button>
                        )}
                        {(inv.status === 'sent' || inv.status === 'overdue') && (
                          <button
                            onClick={() => handleStatusUpdate(inv.id, 'paid')}
                            disabled={actionLoading[inv.id]}
                            style={{ ...s.btnSmall, color: '#16a34a', borderColor: '#86efac' }}
                          >
                            {actionLoading[inv.id] === 'paid' ? '...' : 'Paid'}
                          </button>
                        )}
                        {inv.customer?.email && inv.status !== 'cancelled' && (
                          <button
                            onClick={() => handleSendEmail(inv.id)}
                            disabled={actionLoading[`email_${inv.id}`]}
                            style={{ ...s.btnSmall, color: '#7c3aed', borderColor: '#c4b5fd' }}
                          >
                            {actionLoading[`email_${inv.id}`] ? '...' : 'Email'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => loadInvoices(pagination.page - 1)}
                disabled={pagination.page <= 1}
                style={{ ...s.btnSmall, opacity: pagination.page <= 1 ? 0.4 : 1 }}
              >
                Previous
              </button>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                Page {pagination.page} of {pagination.pages} ({pagination.total} total)
              </span>
              <button
                onClick={() => loadInvoices(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                style={{ ...s.btnSmall, opacity: pagination.page >= pagination.pages ? 0.4 : 1 }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateInvoiceModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Detail Modal */}
      {showDetail && (
        <InvoiceDetailModal
          invoice={showDetail}
          onClose={() => setShowDetail(null)}
          onStatusUpdate={handleStatusUpdate}
          onSendEmail={handleSendEmail}
          onDelete={handleDelete}
          actionLoading={actionLoading}
        />
      )}
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{ ...s.card, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, letterSpacing: '-0.5px' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`, textTransform: 'capitalize',
    }}>
      {status || 'draft'}
    </span>
  );
}

// ─── Create Invoice Modal ─────────────────────────────────────────────────────

function CreateInvoiceModal({ onClose, onCreated }) {
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '', address: '', state: '', gstin: '' });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [companyState, setCompanyState] = useState('Haryana');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isInterstate = customer.state && customer.state !== companyState;

  // Calculate totals
  let subtotal = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;

  items.forEach(item => {
    const amt = (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
    const gst = amt * ((parseFloat(item.gstRate) || 0) / 100);
    subtotal += amt;
    if (isInterstate) { totalIGST += gst; }
    else { totalCGST += gst / 2; totalSGST += gst / 2; }
  });

  const total = subtotal + totalCGST + totalSGST + totalIGST;

  function updateItem(idx, field, value) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  function addItem() {
    setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeItem(idx) {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!customer.name.trim()) return setError('Customer name is required');
    if (items.some(it => !it.description.trim())) return setError('All items need a description');
    if (items.some(it => (parseFloat(it.qty) || 0) <= 0 || (parseFloat(it.rate) || 0) <= 0)) return setError('All items need valid qty and rate');

    setSaving(true);
    setError('');
    try {
      const body = {
        customer,
        items: items.map(it => ({
          description: it.description,
          hsn: it.hsn,
          qty: parseFloat(it.qty),
          rate: parseFloat(it.rate),
          gstRate: parseFloat(it.gstRate),
        })),
        notes,
        dueDate: new Date(dueDate).toISOString(),
        companyState,
      };
      const res = await api.post('/billing/invoices', body);
      onCreated(res);
    } catch (err) {
      setError(err.message || 'Failed to create invoice');
    }
    setSaving(false);
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div style={{ padding: '20px 28px', borderBottom: '3px solid #2e7d32', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={s.subheading}>Create New Invoice</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', fontWeight: 300, lineHeight: 1 }}>x</button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 28, maxHeight: '75vh', overflowY: 'auto' }}>
          {error && <div style={s.error}>{error}</div>}

          {/* Customer Info */}
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#1a1a1a' }}>Customer Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
            <Field label="Customer Name *" value={customer.name} onChange={v => setCustomer(p => ({ ...p, name: v }))} />
            <Field label="Email" value={customer.email} onChange={v => setCustomer(p => ({ ...p, email: v }))} type="email" />
            <Field label="Phone" value={customer.phone} onChange={v => setCustomer(p => ({ ...p, phone: v }))} />
            <div>
              <label style={s.label}>State</label>
              <select value={customer.state} onChange={e => setCustomer(p => ({ ...p, state: e.target.value }))} style={s.select}>
                <option value="">Select state</option>
                {INDIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <Field label="GSTIN" value={customer.gstin} onChange={v => setCustomer(p => ({ ...p, gstin: v }))} placeholder="e.g. 06AAWCA4919K1Z3" />
            <Field label="Address" value={customer.address} onChange={v => setCustomer(p => ({ ...p, address: v }))} />
          </div>

          {/* Company State */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginBottom: 24 }}>
            <div style={{ minWidth: 200 }}>
              <label style={s.label}>Your Company State</label>
              <select value={companyState} onChange={e => setCompanyState(e.target.value)} style={s.select}>
                {INDIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 12, color: isInterstate ? '#dc2626' : '#2e7d32', fontWeight: 600, paddingBottom: 8 }}>
              {customer.state ? (isInterstate ? 'Inter-state (IGST applicable)' : 'Intra-state (CGST + SGST applicable)') : 'Select customer state for GST type'}
            </div>
          </div>

          {/* Line Items */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>Line Items</div>
            <button type="button" onClick={addItem} style={{ ...s.btnSmall, color: '#2e7d32', borderColor: '#86efac' }}>+ Add Item</button>
          </div>

          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb', minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: '30%' }}>Description *</th>
                  <th style={{ ...s.th, width: '12%' }}>HSN/SAC</th>
                  <th style={{ ...s.th, width: '10%', textAlign: 'right' }}>Qty</th>
                  <th style={{ ...s.th, width: '14%', textAlign: 'right' }}>Rate</th>
                  <th style={{ ...s.th, width: '10%', textAlign: 'right' }}>GST %</th>
                  <th style={{ ...s.th, width: '16%', textAlign: 'right' }}>Amount</th>
                  <th style={{ ...s.th, width: '8%', textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const amt = (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
                  return (
                    <tr key={idx}>
                      <td style={s.td}>
                        <input value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Service / Product" style={{ ...s.input, padding: '6px 8px', fontSize: 12 }} />
                      </td>
                      <td style={s.td}>
                        <input value={item.hsn} onChange={e => updateItem(idx, 'hsn', e.target.value)} placeholder="HSN" style={{ ...s.input, padding: '6px 8px', fontSize: 12 }} />
                      </td>
                      <td style={s.td}>
                        <input type="number" min="1" value={item.qty} onChange={e => updateItem(idx, 'qty', e.target.value)} style={{ ...s.input, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} />
                      </td>
                      <td style={s.td}>
                        <input type="number" min="0" step="0.01" value={item.rate} onChange={e => updateItem(idx, 'rate', e.target.value)} style={{ ...s.input, padding: '6px 8px', fontSize: 12, textAlign: 'right' }} />
                      </td>
                      <td style={s.td}>
                        <select value={item.gstRate} onChange={e => updateItem(idx, 'gstRate', e.target.value)} style={{ ...s.select, padding: '6px 8px', fontSize: 12, textAlign: 'right' }}>
                          <option value="0">0%</option>
                          <option value="5">5%</option>
                          <option value="12">12%</option>
                          <option value="18">18%</option>
                          <option value="28">28%</option>
                        </select>
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: 600, fontSize: 12 }}>{fmtCurrency(amt)}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        {items.length > 1 && (
                          <button type="button" onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, fontWeight: 700, lineHeight: 1 }}>x</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
            <div style={{ width: 280 }}>
              <TotalRow label="Subtotal" value={fmtCurrency(subtotal)} />
              {isInterstate ? (
                <TotalRow label="IGST" value={fmtCurrency(totalIGST)} />
              ) : (
                <>
                  <TotalRow label="CGST" value={fmtCurrency(totalCGST)} />
                  <TotalRow label="SGST" value={fmtCurrency(totalSGST)} />
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid #1e293b', marginTop: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>Total</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#2e7d32' }}>{fmtCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Notes & Due Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
            <div>
              <label style={s.label}>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Payment terms, bank details, etc." style={{ ...s.input, resize: 'vertical' }} />
            </div>
            <div>
              <label style={s.label}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={s.input} />
            </div>
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={s.btnSecondary}>Cancel</button>
            <button type="submit" disabled={saving} style={{ ...s.btnPrimary, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Creating...' : 'Create Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Invoice Detail Modal ─────────────────────────────────────────────────────

function InvoiceDetailModal({ invoice, onClose, onStatusUpdate, onSendEmail, onDelete, actionLoading }) {
  const inv = invoice;
  const items = inv.items || [];
  const isInterstate = inv.isInterstate;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, maxWidth: 740 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '20px 28px', borderBottom: '3px solid #2e7d32', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ ...s.subheading, marginBottom: 2 }}>{inv.invoiceNumber || 'Invoice'}</h3>
            <div style={{ fontSize: 11, color: '#64748b' }}>Created {fmtDate(inv.date || inv.createdAt)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusBadge status={inv.status} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', fontWeight: 300, lineHeight: 1 }}>x</button>
          </div>
        </div>

        <div style={{ padding: 28, maxHeight: '75vh', overflowY: 'auto' }}>
          {/* Customer Info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Bill To</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>{inv.customer?.name || '-'}</div>
              {inv.customer?.email && <div style={{ fontSize: 12, color: '#475569' }}>{inv.customer.email}</div>}
              {inv.customer?.phone && <div style={{ fontSize: 12, color: '#475569' }}>{inv.customer.phone}</div>}
              {inv.customer?.address && <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{inv.customer.address}</div>}
              {inv.customer?.state && <div style={{ fontSize: 12, color: '#475569' }}>{inv.customer.state}</div>}
              {inv.customer?.gstin && <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>GSTIN: {inv.customer.gstin}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Invoice Details</div>
              <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Due: <strong>{fmtDate(inv.dueDate)}</strong></div>
              <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Type: <strong>{isInterstate ? 'Inter-state' : 'Intra-state'}</strong></div>
              {inv.paidDate && <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>Paid on {fmtDate(inv.paidDate)}</div>}
            </div>
          </div>

          {/* Items Table */}
          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb' }}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: 40 }}>#</th>
                  <th style={s.th}>Description</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>HSN/SAC</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Rate</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>GST %</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td style={s.td}>{i + 1}</td>
                    <td style={{ ...s.td, fontWeight: 600 }}>{it.description || '-'}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#64748b' }}>{it.hsn || '-'}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>{it.qty}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>{fmtCurrency(it.rate)}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>{it.gstRate}%</td>
                    <td style={{ ...s.td, textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(it.amount || (it.qty * it.rate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
            <div style={{ width: 280 }}>
              <TotalRow label="Subtotal" value={fmtCurrency(inv.subtotal)} />
              {isInterstate ? (
                <TotalRow label="IGST" value={fmtCurrency(inv.igst)} />
              ) : (
                <>
                  <TotalRow label="CGST" value={fmtCurrency(inv.cgst)} />
                  <TotalRow label="SGST" value={fmtCurrency(inv.sgst)} />
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid #1e293b', marginTop: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>Total</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#2e7d32' }}>{fmtCurrency(inv.total)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {inv.notes && (
            <div style={{ padding: 16, background: '#f8fafc', borderRadius: 6, border: '1px solid #e5e7eb', marginBottom: 20, fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Notes</div>
              {inv.notes}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid #e5e7eb', paddingTop: 20 }}>
            {inv.status === 'draft' && (
              <button
                onClick={() => onStatusUpdate(inv.id, 'sent')}
                disabled={actionLoading[inv.id]}
                style={{ ...s.btnSmall, color: '#2563eb', borderColor: '#93c5fd' }}
              >
                {actionLoading[inv.id] === 'sent' ? 'Updating...' : 'Mark as Sent'}
              </button>
            )}
            {(inv.status === 'sent' || inv.status === 'overdue') && (
              <button
                onClick={() => onStatusUpdate(inv.id, 'paid')}
                disabled={actionLoading[inv.id]}
                style={{ ...s.btnSmall, color: '#16a34a', borderColor: '#86efac' }}
              >
                {actionLoading[inv.id] === 'paid' ? 'Updating...' : 'Mark as Paid'}
              </button>
            )}
            {inv.status !== 'cancelled' && inv.status !== 'paid' && (
              <button
                onClick={() => onStatusUpdate(inv.id, 'cancelled')}
                disabled={actionLoading[inv.id]}
                style={{ ...s.btnSmall, color: '#6b7280', borderColor: '#d1d5db' }}
              >
                {actionLoading[inv.id] === 'cancelled' ? 'Updating...' : 'Cancel Invoice'}
              </button>
            )}
            {inv.customer?.email && inv.status !== 'cancelled' && (
              <button
                onClick={() => onSendEmail(inv.id)}
                disabled={actionLoading[`email_${inv.id}`]}
                style={{ ...s.btnSmall, color: '#7c3aed', borderColor: '#c4b5fd' }}
              >
                {actionLoading[`email_${inv.id}`] ? 'Sending...' : 'Send via Email'}
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => onDelete(inv.id, inv.invoiceNumber)}
              disabled={actionLoading[`del_${inv.id}`]}
              style={s.btnDanger}
            >
              {actionLoading[`del_${inv.id}`] ? 'Deleting...' : 'Delete Invoice'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared Sub-components ────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={s.label}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} style={s.input} />
    </div>
  );
}

function TotalRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#475569' }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
