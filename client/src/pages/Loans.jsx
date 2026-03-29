import React, { useState, useEffect, useMemo, useRef } from 'react';
import { formatCurrency, formatDate } from '../utils/formatters';
import { api } from '../utils/api';

const LOAN_TYPES = ['Personal', 'Business', 'Home', 'Vehicle', 'Equipment', 'Education', 'Other'];
const PAYMENT_METHODS = ['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Auto-Debit', 'Other'];

const EMPTY_FORM = {
  lenderName: '',
  loanType: 'Business',
  principalAmount: '',
  interestRate: '',
  tenure: '',
  startDate: new Date().toISOString().split('T')[0],
  description: '',
  reference: '',
};

export default function Loans() {
  const [activeTab, setActiveTab] = useState('loans');
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const abortControllerRef = useRef(null);

  // EMI schedule view
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [emiSchedule, setEmiSchedule] = useState([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [payingEMI, setPayingEMI] = useState(null);
  const [payMethod, setPayMethod] = useState('Bank Transfer');
  const [payRef, setPayRef] = useState('');
  const [payingLoading, setPayingLoading] = useState(false);

  useEffect(() => { fetchLoans(); }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function fetchLoans() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/loans');
      setLoans(Array.isArray(res) ? res : res.data || []);
    } catch (err) {
      console.error('Error fetching loans:', err);
      setError('Failed to load loans');
    }
    setLoading(false);
  }

  async function fetchLoanDetail(loanId) {
    setLoadingSchedule(true);
    setError('');
    try {
      const res = await api.get(`/loans/${loanId}`);
      setSelectedLoan(res);
      setEmiSchedule(res.payments || []);
    } catch (err) {
      console.error('Error fetching loan detail:', err);
      setError('Failed to load loan details');
    }
    setLoadingSchedule(false);
  }

  // Calculated EMI preview
  const emiPreview = useMemo(() => {
    const p = parseFloat(form.principalAmount) || 0;
    const r = parseFloat(form.interestRate) || 0;
    const n = parseInt(form.tenure) || 0;
    if (p <= 0 || n <= 0) return null;
    let emi;
    if (r === 0) {
      emi = p / n;
    } else {
      const mr = r / 12 / 100;
      emi = p * mr * Math.pow(1 + mr, n) / (Math.pow(1 + mr, n) - 1);
    }
    const totalPayable = emi * n;
    const totalInterest = totalPayable - p;
    return {
      emi: Math.round(emi * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100,
      totalPayable: Math.round(totalPayable * 100) / 100,
    };
  }, [form.principalAmount, form.interestRate, form.tenure]);

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.lenderName || !form.principalAmount || !form.tenure || !form.startDate) {
      setError('Please fill all required fields');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('/loans', form);
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      await fetchLoans();
    } catch (err) {
      console.error('Error creating loan:', err);
      setError(err.message || 'Failed to create loan');
    }
    setSaving(false);
  }

  async function handleDisburse(loanId) {
    if (!window.confirm('Post loan disbursement to ledger? This will debit Bank Account and credit Loan Payable.')) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/loans/${loanId}/disburse`);
      await fetchLoans();
      if (selectedLoan?.id === loanId) await fetchLoanDetail(loanId);
    } catch (err) {
      console.error('Error disbursing loan:', err);
      setError(err.message || 'Failed to post to ledger');
    }
    setSaving(false);
  }

  async function handlePayEMI(loanId, paymentId) {
    setPayingLoading(true);
    setError('');
    try {
      await api.post(`/loans/${loanId}/pay-emi`, {
        paymentId,
        paymentMethod: payMethod,
        paymentReference: payRef,
      });
      setPayingEMI(null);
      setPayMethod('Bank Transfer');
      setPayRef('');
      await fetchLoanDetail(loanId);
      await fetchLoans();
    } catch (err) {
      console.error('Error paying EMI:', err);
      setError(err.message || 'Failed to record EMI payment');
    }
    setPayingLoading(false);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this loan and all its EMI records? This cannot be undone.')) return;
    setSaving(true);
    setError('');
    try {
      await api.delete(`/loans/${id}`);
      if (selectedLoan?.id === id) {
        setSelectedLoan(null);
        setEmiSchedule([]);
      }
      await fetchLoans();
    } catch (err) {
      console.error('Error deleting loan:', err);
      setError(err.message || 'Failed to delete loan');
    }
    setSaving(false);
  }

  // Summary
  const summary = useMemo(() => {
    const active = loans.filter(l => l.status === 'active');
    const totalOutstanding = active.reduce((s, l) => s + (l.remainingPrincipal || 0), 0);
    const totalPrincipal = loans.reduce((s, l) => s + (l.principalAmount || 0), 0);
    const totalInterest = loans.reduce((s, l) => s + (l.totalInterest || 0), 0);
    const monthlyEMI = active.reduce((s, l) => s + (l.emiAmount || 0), 0);
    return { activeCount: active.length, totalOutstanding, totalPrincipal, totalInterest, monthlyEMI };
  }, [loans]);

  const tabs = [
    { key: 'loans', label: 'Loans' },
    { key: 'schedule', label: 'EMI Schedule' },
  ];

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="loader"></div></div>;
  }

  return (
    <div>
      {/* Error message */}
      {error && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', background: '#fee2e2', border: '1px solid #fca5a5' }}>
          <div style={{ color: '#991b1b', fontWeight: 500 }}>{error}</div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '1.5rem', borderBottom: '2px solid #e5e7eb' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '0.75rem 1.25rem', background: 'none', border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #1e3a5f' : '2px solid transparent',
              marginBottom: '-2px', cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#1e3a5f' : '#6b7280',
              fontSize: '0.9rem',
            }}
          >{tab.label}</button>
        ))}
      </div>

      {/* LOANS TAB */}
      {activeTab === 'loans' && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Active Loans</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#2563eb' }}>{summary.activeCount}</div>
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Outstanding Principal</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#ef4444' }}>{formatCurrency(summary.totalOutstanding)}</div>
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Monthly EMI Total</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f59e0b' }}>{formatCurrency(summary.monthlyEMI)}</div>
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Total Interest</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#8b5cf6' }}>{formatCurrency(summary.totalInterest)}</div>
            </div>
          </div>

          {/* Action bar */}
          <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h3 style={{ margin: 0 }}>Loans ({loans.length})</h3>
            <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancel' : '+ Add Loan'}
            </button>
          </div>

          {/* Add Loan Form */}
          {showForm && (
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: '2px solid #2563eb' }}>
              <h4 style={{ marginTop: 0, marginBottom: '1rem' }}>Add New Loan</h4>
              <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={labelStyle}>Lender / Bank Name *</label>
                    <input type="text" name="lenderName" value={form.lenderName} onChange={handleChange} placeholder="e.g., HDFC Bank" required style={inputStyle} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={labelStyle}>Loan Type</label>
                    <select name="loanType" value={form.loanType} onChange={handleChange} style={inputStyle}>
                      {LOAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={labelStyle}>Principal Amount (INR) *</label>
                    <input type="number" name="principalAmount" value={form.principalAmount} onChange={handleChange} placeholder="e.g., 500000" min="1" step="0.01" required style={inputStyle} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={labelStyle}>Annual Interest Rate (%)</label>
                    <input type="number" name="interestRate" value={form.interestRate} onChange={handleChange} placeholder="e.g., 10.5" min="0" step="0.01" style={inputStyle} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={labelStyle}>Tenure (months) *</label>
                    <input type="number" name="tenure" value={form.tenure} onChange={handleChange} placeholder="e.g., 24" min="1" required style={inputStyle} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={labelStyle}>Start Date *</label>
                    <input type="date" name="startDate" value={form.startDate} onChange={handleChange} required style={inputStyle} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={labelStyle}>Loan Account / Reference</label>
                    <input type="text" name="reference" value={form.reference} onChange={handleChange} placeholder="e.g., Loan A/C 12345" style={inputStyle} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={labelStyle}>Description</label>
                    <input type="text" name="description" value={form.description} onChange={handleChange} placeholder="Purpose of loan" style={inputStyle} />
                  </div>
                </div>

                {/* EMI Preview */}
                {emiPreview && (
                  <div style={{ margin: '1rem 0 0', padding: '0.75rem 1rem', background: '#eff6ff', borderRadius: '6px', border: '1px solid #bfdbfe', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.85rem' }}>
                    <div><span style={{ color: '#6b7280' }}>Monthly EMI: </span><strong style={{ color: '#2563eb' }}>{formatCurrency(emiPreview.emi)}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>Total Interest: </span><strong style={{ color: '#f59e0b' }}>{formatCurrency(emiPreview.totalInterest)}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>Total Payable: </span><strong style={{ color: '#ef4444' }}>{formatCurrency(emiPreview.totalPayable)}</strong></div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                  <button type="submit" disabled={saving} className="btn btn-primary" style={{ padding: '0.5rem 1.5rem', opacity: saving ? 0.7 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
                    {saving ? 'Saving...' : 'Create Loan'}
                  </button>
                  <button type="button" onClick={() => { setShowForm(false); setForm({ ...EMPTY_FORM }); }} disabled={saving} className="btn btn-secondary" style={{ padding: '0.5rem 1.5rem', opacity: saving ? 0.6 : 1 }}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Loans Table */}
          {loans.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
              <p>No loans recorded yet. Click "+ Add Loan" to get started.</p>
            </div>
          ) : (
            <div className="card" style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                    <th style={thStyle}>Lender</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Principal</th>
                    <th style={thStyle}>Rate</th>
                    <th style={thStyle}>EMI</th>
                    <th style={thStyle}>Tenure</th>
                    <th style={thStyle}>Outstanding</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Ledger</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map(loan => (
                    <tr key={loan.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{loan.lenderName}</div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{loan.reference || ''}</div>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: '#e0e7ff', color: '#3730a3' }}>{loan.loanType}</span>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{formatCurrency(loan.principalAmount)}</td>
                      <td style={tdStyle}>{loan.interestRate}%</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#2563eb' }}>{formatCurrency(loan.emiAmount)}</td>
                      <td style={tdStyle}>
                        <div>{loan.paidEMIs || 0}/{loan.tenure}</div>
                        <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>{formatDate(loan.startDate)} — {formatDate(loan.endDate)}</div>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#ef4444' }}>{formatCurrency(loan.remainingPrincipal)}</td>
                      <td style={tdStyle}>
                        <span style={{
                          padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600,
                          background: loan.status === 'active' ? '#dcfce7' : loan.status === 'closed' ? '#e0e7ff' : '#fee2e2',
                          color: loan.status === 'active' ? '#166534' : loan.status === 'closed' ? '#3730a3' : '#991b1b',
                        }}>{loan.status}</span>
                      </td>
                      <td style={tdStyle}>
                        {loan.postedToLedger ? (
                          <span style={{ padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: '#dcfce7', color: '#166534' }}>Posted</span>
                        ) : (
                          <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleDisburse(loan.id)}>
                            Post to Ledger
                          </button>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => { setActiveTab('schedule'); fetchLoanDetail(loan.id); }}>
                            EMIs
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#ef4444' }}
                            onClick={() => handleDelete(loan.id)}>
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
      )}

      {/* EMI SCHEDULE TAB */}
      {activeTab === 'schedule' && (
        <div>
          {/* Loan selector */}
          <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 500, color: '#374151' }}>Select Loan:</label>
              <select
                value={selectedLoan?.id || ''}
                onChange={(e) => { if (e.target.value) fetchLoanDetail(e.target.value); }}
                style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem', minWidth: '250px' }}
              >
                <option value="">-- Choose a loan --</option>
                {loans.map(l => (
                  <option key={l.id} value={l.id}>{l.lenderName} — {formatCurrency(l.principalAmount)} ({l.loanType})</option>
                ))}
              </select>
            </div>
          </div>

          {loadingSchedule && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><div className="loader"></div></div>
          )}

          {selectedLoan && !loadingSchedule && (
            <>
              {/* Loan Summary Card */}
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase' }}>Lender</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600 }}>{selectedLoan.lenderName}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase' }}>Principal</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600 }}>{formatCurrency(selectedLoan.principalAmount)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase' }}>Interest Rate</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600 }}>{selectedLoan.interestRate}% p.a.</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase' }}>EMI Amount</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#2563eb' }}>{formatCurrency(selectedLoan.emiAmount)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase' }}>Progress</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600 }}>{selectedLoan.paidEMIs || 0} / {selectedLoan.tenure} EMIs</div>
                    <div style={{ width: '100%', height: '6px', background: '#e5e7eb', borderRadius: '3px', marginTop: '0.35rem' }}>
                      <div style={{ width: `${((selectedLoan.paidEMIs || 0) / selectedLoan.tenure) * 100}%`, height: '100%', background: '#22c55e', borderRadius: '3px', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase' }}>Remaining</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#ef4444' }}>{formatCurrency(selectedLoan.remainingPrincipal)}</div>
                  </div>
                </div>
              </div>

              {/* EMI Table */}
              <div className="card" style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>Due Date</th>
                      <th style={thStyle}>EMI Amount</th>
                      <th style={thStyle}>Principal</th>
                      <th style={thStyle}>Interest</th>
                      <th style={thStyle}>Balance After</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Paid Date</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emiSchedule.map(emi => (
                      <tr key={emi.id} style={{ borderBottom: '1px solid #f3f4f6', background: emi.status === 'paid' ? '#f0fdf4' : 'transparent' }}>
                        <td style={tdStyle}>{emi.emiNumber}</td>
                        <td style={tdStyle}>{formatDate(emi.dueDate)}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{formatCurrency(emi.emiAmount)}</td>
                        <td style={tdStyle}>{formatCurrency(emi.principalComponent)}</td>
                        <td style={{ ...tdStyle, color: '#f59e0b' }}>{formatCurrency(emi.interestComponent)}</td>
                        <td style={tdStyle}>{formatCurrency(emi.remainingBalance)}</td>
                        <td style={tdStyle}>
                          <span style={{
                            padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600,
                            background: emi.status === 'paid' ? '#dcfce7' : emi.dueDate < new Date().toISOString().slice(0, 10) ? '#fee2e2' : '#fef9c3',
                            color: emi.status === 'paid' ? '#166534' : emi.dueDate < new Date().toISOString().slice(0, 10) ? '#991b1b' : '#854d0e',
                          }}>
                            {emi.status === 'paid' ? 'Paid' : emi.dueDate < new Date().toISOString().slice(0, 10) ? 'Overdue' : 'Pending'}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, fontSize: '0.8rem' }}>{emi.paidDate ? formatDate(emi.paidDate) : '—'}</td>
                        <td style={tdStyle}>
                          {emi.status === 'paid' ? (
                            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{emi.paymentMethod || ''}</span>
                          ) : payingEMI === emi.id ? (
                            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #d1d5db' }}>
                                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                              <input type="text" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Ref #" style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #d1d5db', width: '80px' }} />
                              <button className="btn btn-primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                onClick={() => handlePayEMI(selectedLoan.id, emi.id)}>
                                Confirm
                              </button>
                              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                onClick={() => setPayingEMI(null)}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button className="btn btn-primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => setPayingEMI(emi.id)}>
                              Pay EMI
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!selectedLoan && !loadingSchedule && (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
              <p>Select a loan above to view its EMI schedule.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#374151', marginBottom: '0.35rem' };
const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem', background: '#fff', color: '#1e293b', boxSizing: 'border-box' };
const thStyle = { padding: '0.75rem', textAlign: 'left', fontSize: '0.78rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' };
const tdStyle = { padding: '0.75rem', color: '#1e293b', whiteSpace: 'nowrap' };
