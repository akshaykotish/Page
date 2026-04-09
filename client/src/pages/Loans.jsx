import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

const STATUS_OPTIONS = ['', 'active', 'disbursed', 'closed'];
const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card'];

const fmt = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Loans() {
  const [loans, setLoans] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('');

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ borrowerName: '', principalAmount: '', interestRate: '', tenure: '', startDate: new Date().toISOString().slice(0, 10), purpose: '' });
  const [saving, setSaving] = useState(false);

  // Detail view
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [loanDetail, setLoanDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Disburse / Pay EMI dialogs
  const [disburseDialog, setDisburseDialog] = useState(null);
  const [payEmiDialog, setPayEmiDialog] = useState(null);
  const [actionSaving, setActionSaving] = useState(false);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      const data = await api.get(`/loans?${params}`);
      setLoans(data.loans || []);
      setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
    } catch (err) {
      setError(err.message || 'Failed to load loans');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); } }, [success]);

  async function loadDetail(id) {
    setLoadingDetail(true);
    try {
      const data = await api.get(`/loans/${id}`);
      setLoanDetail(data);
      setSelectedLoan(id);
    } catch (err) {
      setError(err.message || 'Failed to load loan details');
    }
    setLoadingDetail(false);
  }

  function resetForm() {
    setForm({ borrowerName: '', principalAmount: '', interestRate: '', tenure: '', startDate: new Date().toISOString().slice(0, 10), purpose: '' });
    setShowForm(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.borrowerName.trim()) return setError('Borrower name is required');
    const principal = parseFloat(form.principalAmount);
    const rate = parseFloat(form.interestRate);
    const months = parseInt(form.tenure);
    if (!principal || principal <= 0) return setError('Principal amount must be greater than 0');
    if (isNaN(rate) || rate < 0) return setError('Interest rate cannot be negative');
    if (!months || months <= 0) return setError('Tenure must be at least 1 month');
    if (!form.startDate) return setError('Start date is required');

    setSaving(true);
    setError('');
    try {
      await api.post('/loans', {
        lenderName: form.borrowerName.trim(),
        principalAmount: principal,
        interestRate: rate,
        tenure: months,
        startDate: form.startDate,
        description: form.purpose,
      });
      setSuccess('Loan created successfully');
      resetForm();
      load(pagination.page);
    } catch (err) {
      setError(err.message || 'Failed to create loan');
    }
    setSaving(false);
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete loan for "${name}"? This will also delete all EMI records and cannot be undone.`)) return;
    try {
      await api.delete(`/loans/${id}`);
      setSuccess('Loan deleted');
      if (selectedLoan === id) { setSelectedLoan(null); setLoanDetail(null); }
      load(pagination.page);
    } catch (err) {
      setError(err.message || 'Failed to delete loan');
    }
  }

  async function handleDisburse(e) {
    e.preventDefault();
    setActionSaving(true);
    setError('');
    try {
      await api.post(`/loans/${disburseDialog.id}/disburse`, {
        amount: disburseDialog.amount,
        date: disburseDialog.date,
        method: disburseDialog.method,
        reference: disburseDialog.reference,
      });
      setSuccess('Loan disbursed and posted to ledger');
      setDisburseDialog(null);
      load(pagination.page);
      if (selectedLoan) loadDetail(selectedLoan);
    } catch (err) {
      setError(err.message || 'Failed to disburse');
    }
    setActionSaving(false);
  }

  async function handlePayEmi(e) {
    e.preventDefault();
    setActionSaving(true);
    setError('');
    try {
      await api.post(`/loans/${payEmiDialog.loanId}/pay-emi`, {
        paymentId: payEmiDialog.paymentId,
        paymentMethod: payEmiDialog.method,
        paymentReference: payEmiDialog.reference,
      });
      setSuccess('EMI payment recorded');
      setPayEmiDialog(null);
      load(pagination.page);
      if (selectedLoan) loadDetail(selectedLoan);
    } catch (err) {
      setError(err.message || 'Failed to record EMI payment');
    }
    setActionSaving(false);
  }

  // Filter loans client-side by status
  const filtered = statusFilter ? loans.filter(l => l.status === statusFilter) : loans;

  // Summary cards
  const totalLoans = filtered.length;
  const activeLoans = filtered.filter(l => l.status === 'active').length;
  const totalDisbursed = filtered.filter(l => l.postedToLedger).reduce((s, l) => s + (l.principalAmount || 0), 0);
  const totalCollected = filtered.reduce((s, l) => s + ((l.paidEMIs || 0) * (l.emiAmount || 0)), 0);

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 24, color: '#1a1a1a', margin: 0 }}>
          {selectedLoan ? 'Loan Details' : 'Loans'}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedLoan && (
            <button onClick={() => { setSelectedLoan(null); setLoanDetail(null); }} style={{ padding: '8px 20px', background: '#64748b', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Back to List
            </button>
          )}
          {!selectedLoan && (
            <button onClick={() => { if (showForm) resetForm(); else setShowForm(true); }} style={{ padding: '8px 20px', background: showForm ? '#64748b' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {showForm ? 'Cancel' : '+ New Loan'}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      {error && <div style={{ padding: '8px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {success && <div style={{ padding: '8px 16px', background: '#f0fdf4', color: '#16a34a', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{success}</div>}

      {/* ===================== DETAIL VIEW ===================== */}
      {selectedLoan ? (
        loadingDetail ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading loan details...</div>
        ) : loanDetail ? (
          <LoanDetailView
            loan={loanDetail}
            onDisburse={() => setDisburseDialog({ id: loanDetail.id, amount: loanDetail.principalAmount, date: new Date().toISOString().slice(0, 10), method: 'Bank Transfer', reference: '' })}
            onPayEmi={(payment) => setPayEmiDialog({ loanId: loanDetail.id, paymentId: payment.id, emiNumber: payment.emiNumber, amount: payment.emiAmount, method: 'Bank Transfer', reference: '' })}
            onDelete={() => handleDelete(loanDetail.id, loanDetail.lenderName)}
          />
        ) : null
      ) : (
        <>
          {/* ===================== LIST VIEW ===================== */}

          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <SummaryCard label="Total Loans" value={String(totalLoans)} color="#1e40af" />
            <SummaryCard label="Active Loans" value={String(activeLoans)} color="#2e7d32" />
            <SummaryCard label="Total Disbursed" value={`₹${fmt(totalDisbursed)}`} color="#b45309" />
            <SummaryCard label="Total Collected" value={`₹${fmt(totalCollected)}`} color="#7c3aed" />
          </div>

          {/* Filter */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Status:</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}>
              <option value="">All</option>
              {STATUS_OPTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>

          {/* Create Form */}
          {showForm && (
            <form onSubmit={handleCreate} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>Create New Loan</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <Field label="Borrower / Lender Name *" value={form.borrowerName} onChange={v => setForm(f => ({ ...f, borrowerName: v }))} placeholder="Name" />
                <Field label="Principal Amount *" type="number" value={form.principalAmount} onChange={v => setForm(f => ({ ...f, principalAmount: v }))} placeholder="0.00" step="0.01" />
                <Field label="Interest Rate (% p.a.) *" type="number" value={form.interestRate} onChange={v => setForm(f => ({ ...f, interestRate: v }))} placeholder="12" step="0.01" />
                <Field label="Tenure (months) *" type="number" value={form.tenure} onChange={v => setForm(f => ({ ...f, tenure: v }))} placeholder="12" />
                <Field label="Start Date *" type="date" value={form.startDate} onChange={v => setForm(f => ({ ...f, startDate: v }))} />
                <Field label="Purpose" value={form.purpose} onChange={v => setForm(f => ({ ...f, purpose: v }))} placeholder="Loan purpose" />
              </div>
              {/* EMI Preview */}
              {form.principalAmount && form.interestRate !== '' && form.tenure && (
                <div style={{ marginTop: 12, padding: 12, background: '#f0fdf4', borderRadius: 6, fontSize: 13 }}>
                  <strong>EMI Preview:</strong> ₹{fmt(calcEMI(parseFloat(form.principalAmount) || 0, parseFloat(form.interestRate) || 0, parseInt(form.tenure) || 1))}/month
                  {' | '}Total Payable: ₹{fmt((calcEMI(parseFloat(form.principalAmount) || 0, parseFloat(form.interestRate) || 0, parseInt(form.tenure) || 1)) * (parseInt(form.tenure) || 1))}
                </div>
              )}
              <button type="submit" disabled={saving} style={{ marginTop: 16, padding: '10px 28px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Creating...' : 'Create Loan'}
              </button>
            </form>
          )}

          {/* Table */}
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading loans...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              No loans found{statusFilter ? ` with status "${statusFilter}"` : ''}. Click "+ New Loan" to create one.
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: "'Poppins',sans-serif" }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={th}>Lender</th>
                      <th style={{ ...th, textAlign: 'right' }}>Principal</th>
                      <th style={{ ...th, textAlign: 'right' }}>Rate</th>
                      <th style={th}>Tenure</th>
                      <th style={{ ...th, textAlign: 'right' }}>EMI</th>
                      <th style={th}>Progress</th>
                      <th style={{ ...th, textAlign: 'center' }}>Status</th>
                      <th style={{ ...th, textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(loan => (
                      <tr key={loan.id} style={{ borderBottom: '1px solid #e5e7eb', cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={td} onClick={() => loadDetail(loan.id)}>
                          <div style={{ fontWeight: 600 }}>{loan.lenderName}</div>
                          {loan.description && <div style={{ fontSize: 11, color: '#94a3b8' }}>{loan.description}</div>}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} onClick={() => loadDetail(loan.id)}>₹{fmt(loan.principalAmount)}</td>
                        <td style={{ ...td, textAlign: 'right' }} onClick={() => loadDetail(loan.id)}>{loan.interestRate}%</td>
                        <td style={td} onClick={() => loadDetail(loan.id)}>{loan.tenure} mo</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} onClick={() => loadDetail(loan.id)}>₹{fmt(loan.emiAmount)}</td>
                        <td style={td} onClick={() => loadDetail(loan.id)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${loan.tenure ? ((loan.paidEMIs || 0) / loan.tenure) * 100 : 0}%`, height: '100%', background: '#2e7d32', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 10, color: '#64748b', whiteSpace: 'nowrap' }}>{loan.paidEMIs || 0}/{loan.tenure}</span>
                          </div>
                        </td>
                        <td style={{ ...td, textAlign: 'center' }} onClick={() => loadDetail(loan.id)}>
                          <StatusBadge status={loan.status} posted={loan.postedToLedger} />
                        </td>
                        <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {!loan.postedToLedger && loan.status === 'active' && (
                            <button onClick={(e) => { e.stopPropagation(); setDisburseDialog({ id: loan.id, amount: loan.principalAmount, date: new Date().toISOString().slice(0, 10), method: 'Bank Transfer', reference: '' }); }} style={{ padding: '3px 8px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', marginRight: 4 }}>
                              Disburse
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(loan.id, loan.lenderName); }} style={{ padding: '3px 8px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pagination.pages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
                  <button disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)} style={pgBtn}>Prev</button>
                  <span style={{ fontSize: 12, color: '#475569' }}>Page {pagination.page} of {pagination.pages} ({pagination.total} total)</span>
                  <button disabled={pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)} style={pgBtn}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ===================== DISBURSE DIALOG ===================== */}
      {disburseDialog && (
        <Modal title="Disburse Loan" onClose={() => setDisburseDialog(null)}>
          <form onSubmit={handleDisburse}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Amount" type="number" value={String(disburseDialog.amount)} onChange={v => setDisburseDialog(d => ({ ...d, amount: v }))} />
              <Field label="Date" type="date" value={disburseDialog.date} onChange={v => setDisburseDialog(d => ({ ...d, date: v }))} />
              <div style={{ marginBottom: 4 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Method</label>
                <select value={disburseDialog.method} onChange={e => setDisburseDialog(d => ({ ...d, method: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <Field label="Reference" value={disburseDialog.reference} onChange={v => setDisburseDialog(d => ({ ...d, reference: v }))} placeholder="Txn ref" />
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button type="submit" disabled={actionSaving} style={{ padding: '10px 24px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: actionSaving ? 0.7 : 1 }}>
                {actionSaving ? 'Processing...' : 'Confirm Disburse'}
              </button>
              <button type="button" onClick={() => setDisburseDialog(null)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================== PAY EMI DIALOG ===================== */}
      {payEmiDialog && (
        <Modal title={`Pay EMI #${payEmiDialog.emiNumber}`} onClose={() => setPayEmiDialog(null)}>
          <form onSubmit={handlePayEmi}>
            <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>Amount: <strong>₹{fmt(payEmiDialog.amount)}</strong></p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ marginBottom: 4 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Payment Method</label>
                <select value={payEmiDialog.method} onChange={e => setPayEmiDialog(d => ({ ...d, method: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <Field label="Reference" value={payEmiDialog.reference} onChange={v => setPayEmiDialog(d => ({ ...d, reference: v }))} placeholder="Txn ref" />
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button type="submit" disabled={actionSaving} style={{ padding: '10px 24px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: actionSaving ? 0.7 : 1 }}>
                {actionSaving ? 'Processing...' : 'Confirm Payment'}
              </button>
              <button type="button" onClick={() => setPayEmiDialog(null)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── LOAN DETAIL VIEW ────────────────────────────────────────────────────────

function LoanDetailView({ loan, onDisburse, onPayEmi, onDelete }) {
  const progress = loan.tenure ? ((loan.paidEMIs || 0) / loan.tenure) * 100 : 0;
  const payments = loan.payments || [];

  return (
    <div>
      {/* Loan Info Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <SummaryCard label="Principal" value={`₹${fmt(loan.principalAmount)}`} color="#1e40af" />
        <SummaryCard label="EMI" value={`₹${fmt(loan.emiAmount)}`} color="#2e7d32" />
        <SummaryCard label="Interest Rate" value={`${loan.interestRate}% p.a.`} color="#b45309" />
        <SummaryCard label="Remaining" value={`₹${fmt(loan.remainingPrincipal)}`} color="#dc2626" />
        <SummaryCard label="Total Payable" value={`₹${fmt(loan.totalPayable)}`} color="#7c3aed" />
        <SummaryCard label="Total Interest" value={`₹${fmt(loan.totalInterest)}`} color="#64748b" />
      </div>

      {/* Loan Meta */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, fontSize: 13 }}>
          <div><span style={{ color: '#64748b', fontWeight: 600 }}>Lender:</span> {loan.lenderName}</div>
          <div><span style={{ color: '#64748b', fontWeight: 600 }}>Status:</span> <StatusBadge status={loan.status} posted={loan.postedToLedger} /></div>
          <div><span style={{ color: '#64748b', fontWeight: 600 }}>Tenure:</span> {loan.tenure} months</div>
          <div><span style={{ color: '#64748b', fontWeight: 600 }}>Start:</span> {loan.startDate}</div>
          <div><span style={{ color: '#64748b', fontWeight: 600 }}>End:</span> {loan.endDate}</div>
          <div><span style={{ color: '#64748b', fontWeight: 600 }}>Progress:</span> {loan.paidEMIs || 0}/{loan.tenure} EMIs paid</div>
          {loan.description && <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b', fontWeight: 600 }}>Purpose:</span> {loan.description}</div>}
        </div>

        {/* Progress bar */}
        <div style={{ marginTop: 16, height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: '#2e7d32', borderRadius: 4, transition: 'width 0.3s' }} />
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          {!loan.postedToLedger && loan.status === 'active' && (
            <button onClick={onDisburse} style={{ padding: '8px 20px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Disburse Loan</button>
          )}
          <button onClick={onDelete} style={{ padding: '8px 20px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete Loan</button>
        </div>
      </div>

      {/* EMI Schedule Table */}
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 18, color: '#1a1a1a', margin: '0 0 12px' }}>EMI Schedule</h3>
      </div>

      {payments.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}>
          No EMI schedule found. The schedule is generated when the loan is created.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: "'Poppins',sans-serif" }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={th}>#</th>
                <th style={th}>Due Date</th>
                <th style={{ ...th, textAlign: 'right' }}>EMI</th>
                <th style={{ ...th, textAlign: 'right' }}>Principal</th>
                <th style={{ ...th, textAlign: 'right' }}>Interest</th>
                <th style={{ ...th, textAlign: 'right' }}>Balance</th>
                <th style={{ ...th, textAlign: 'center' }}>Status</th>
                <th style={th}>Paid Date</th>
                <th style={{ ...th, textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb', background: p.status === 'paid' ? '#f0fdf4' : 'transparent' }}>
                  <td style={td}>{p.emiNumber}</td>
                  <td style={td}>{p.dueDate}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>₹{fmt(p.emiAmount)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>₹{fmt(p.principalComponent)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#b45309' }}>₹{fmt(p.interestComponent)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>₹{fmt(p.remainingBalance)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {p.status === 'paid'
                      ? <span style={{ background: '#dcfce7', color: '#16a34a', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>Paid</span>
                      : <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>Pending</span>
                    }
                  </td>
                  <td style={td}>{p.paidDate || '-'}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {p.status !== 'paid' && (
                      <button onClick={() => onPayEmi(p)} style={{ padding: '3px 10px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                        Pay EMI
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 18, color: '#1a1a1a' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>x</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status, posted }) {
  const styles = {
    active: { background: posted ? '#dcfce7' : '#dbeafe', color: posted ? '#16a34a' : '#1e40af' },
    closed: { background: '#f1f5f9', color: '#64748b' },
    disbursed: { background: '#dcfce7', color: '#16a34a' },
  };
  const s = styles[status] || styles.active;
  const label = posted && status === 'active' ? 'Disbursed' : (status || 'active').charAt(0).toUpperCase() + (status || 'active').slice(1);
  return <span style={{ ...s, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{label}</span>;
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

function calcEMI(principal, annualRate, months) {
  if (!principal || !months || months <= 0) return 0;
  if (annualRate === 0) return principal / months;
  const r = annualRate / 12 / 100;
  const n = months;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#475569', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' };
const td = { padding: '10px 12px', color: '#1a1a1a' };
const pgBtn = { padding: '6px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' };
