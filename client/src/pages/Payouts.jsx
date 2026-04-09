import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

const formatINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n || 0);

const STATUS_COLORS = {
  processed: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  processing: { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  queued: { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  pending: { bg: '#fefce8', color: '#ca8a04', border: '#fde68a' },
  reversed: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  cancelled: { bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' },
  failed: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  rejected: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
};

export default function Payouts() {
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [view, setView] = useState('list'); // list | create | bulk | detail
  const [selectedPayout, setSelectedPayout] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError('');
    try { setPayouts(await api.get('/payouts')); } catch (err) { setError(err.message || 'Failed to load payouts'); }
    setLoading(false);
  }

  async function viewDetail(payout) {
    setDetailLoading(true); setError('');
    try {
      if (payout.razorpayPayoutId) {
        const detail = await api.get(`/payouts/${payout.razorpayPayoutId}`);
        setSelectedPayout({ ...payout, ...detail });
      } else {
        setSelectedPayout(payout);
      }
      setView('detail');
    } catch (err) { setSelectedPayout(payout); setView('detail'); }
    setDetailLoading(false);
  }

  // Summary cards
  const summary = {
    total: payouts.length,
    pending: payouts.filter(p => ['pending', 'queued', 'processing'].includes((p.status || '').toLowerCase())).length,
    processed: payouts.filter(p => (p.status || '').toLowerCase() === 'processed').length,
    failed: payouts.filter(p => ['failed', 'reversed', 'cancelled', 'rejected'].includes((p.status || '').toLowerCase())).length,
  };

  const filtered = statusFilter === 'all' ? payouts : payouts.filter(p => (p.status || '').toLowerCase() === statusFilter);

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 24, color: '#1a1a1a', margin: 0 }}>Payouts</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {view !== 'list' && (
            <button onClick={() => { setView('list'); setSelectedPayout(null); }} style={btnStyle('#64748b')}>Back to List</button>
          )}
          {view === 'list' && (
            <>
              <button onClick={() => setView('create')} style={btnStyle('#2e7d32')}>+ New Payout</button>
              <button onClick={() => setView('bulk')} style={btnStyle('#6366f1')}>Bulk Salary</button>
            </>
          )}
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      {/* Summary Cards */}
      {view === 'list' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          <SummaryCard label="Total Payouts" value={summary.total} color="#1e293b" bg="#f8fafc" />
          <SummaryCard label="Pending" value={summary.pending} color="#ca8a04" bg="#fefce8" />
          <SummaryCard label="Processed" value={summary.processed} color="#16a34a" bg="#f0fdf4" />
          <SummaryCard label="Failed" value={summary.failed} color="#dc2626" bg="#fef2f2" />
        </div>
      )}

      {view === 'list' && <PayoutList payouts={filtered} loading={loading} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onView={viewDetail} />}
      {view === 'create' && <CreatePayout onDone={() => { setView('list'); load(); }} setError={setError} />}
      {view === 'bulk' && <BulkSalary onDone={() => { setView('list'); load(); }} setError={setError} />}
      {view === 'detail' && <PayoutDetail payout={selectedPayout} loading={detailLoading} />}
    </div>
  );
}

// ─── Summary Card ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, color, bg }) {
  return (
    <div style={{ background: bg, border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

// ─── Payout List ────────────────────────────────────────────────────────────

function PayoutList({ payouts, loading, statusFilter, setStatusFilter, onView }) {
  const statuses = ['all', 'processed', 'pending', 'processing', 'failed', 'reversed', 'cancelled'];

  if (loading) return <Loading text="Loading payouts..." />;

  return (
    <div>
      {/* Status filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {statuses.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} style={{
            padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: statusFilter === s ? '2px solid #2e7d32' : '1px solid #d1d5db',
            background: statusFilter === s ? '#f0fdf4' : '#fff',
            color: statusFilter === s ? '#2e7d32' : '#64748b',
            textTransform: 'capitalize',
          }}>{s}</button>
        ))}
      </div>

      {payouts.length === 0 ? <Empty text="No payouts found." /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={thStyle}>Employee</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Purpose</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p, i) => {
                const st = STATUS_COLORS[(p.status || '').toLowerCase()] || STATUS_COLORS.pending;
                return (
                  <tr key={p.id} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{p.employeeName || p.narration || '-'}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{formatINR(p.amount)}</td>
                    <td style={tdStyle}>{p.mode || '-'}</td>
                    <td style={tdStyle}><span style={{ textTransform: 'capitalize' }}>{p.purpose || '-'}</span></td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, border: `1px solid ${st.border}`, textTransform: 'capitalize' }}>{p.status || 'unknown'}</span>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: '#64748b' }}>{p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : '-'}</td>
                    <td style={tdStyle}>
                      <button onClick={() => onView(p)} style={{ padding: '4px 12px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>View</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Create Payout Form ─────────────────────────────────────────────────────

function CreatePayout({ onDone, setError }) {
  const [step, setStep] = useState(1); // 1: contact, 2: fund account, 3: payout
  const [saving, setSaving] = useState(false);
  const [contactId, setContactId] = useState('');
  const [fundAccountId, setFundAccountId] = useState('');
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', type: 'employee' });
  const [fundForm, setFundForm] = useState({ accountType: 'bank_account', bankName: '', bankIfsc: '', bankAccount: '', vpa: '' });
  const [payoutForm, setPayoutForm] = useState({ amount: '', mode: 'NEFT', purpose: 'salary', narration: '' });
  const [stepError, setStepError] = useState('');

  async function createContact(e) {
    e.preventDefault(); setSaving(true); setStepError('');
    try {
      const res = await api.post('/payouts/contacts', { name: contactForm.name, email: contactForm.email, phone: contactForm.phone, type: contactForm.type });
      setContactId(res.id);
      setStep(2);
    } catch (err) { setStepError(err.message || 'Failed to create contact'); }
    setSaving(false);
  }

  async function createFundAccount(e) {
    e.preventDefault(); setSaving(true); setStepError('');
    try {
      const body = { contactId, accountType: fundForm.accountType };
      if (fundForm.accountType === 'bank_account') {
        body.bankAccount = { name: fundForm.bankName, ifsc: fundForm.bankIfsc, accountNumber: fundForm.bankAccount };
      } else {
        body.vpa = fundForm.vpa;
      }
      const res = await api.post('/payouts/fund-accounts', body);
      setFundAccountId(res.id);
      setStep(3);
    } catch (err) { setStepError(err.message || 'Failed to create fund account'); }
    setSaving(false);
  }

  async function createPayout(e) {
    e.preventDefault(); setSaving(true); setStepError('');
    try {
      await api.post('/payouts/payouts', {
        fundAccountId,
        amount: parseFloat(payoutForm.amount),
        currency: 'INR',
        mode: payoutForm.mode,
        purpose: payoutForm.purpose,
        narration: payoutForm.narration,
      });
      onDone();
    } catch (err) { setStepError(err.message || 'Failed to create payout'); }
    setSaving(false);
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, maxWidth: 600 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#1a1a1a' }}>Create Payout</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20 }}>Step {step} of 3: {step === 1 ? 'Contact Details' : step === 2 ? 'Fund Account' : 'Payout Amount'}</div>

      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {[1, 2, 3].map(s => (
          <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? '#2e7d32' : '#e5e7eb' }} />
        ))}
      </div>

      {stepError && <div style={errorStyle}>{stepError}</div>}

      {step === 1 && (
        <form onSubmit={createContact}>
          <Field label="Name *" value={contactForm.name} onChange={v => setContactForm(f => ({ ...f, name: v }))} />
          <Field label="Email" value={contactForm.email} onChange={v => setContactForm(f => ({ ...f, email: v }))} />
          <Field label="Phone" value={contactForm.phone} onChange={v => setContactForm(f => ({ ...f, phone: v }))} />
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Type</label>
            <select value={contactForm.type} onChange={e => setContactForm(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
              <option value="employee">Employee</option>
              <option value="vendor">Vendor</option>
              <option value="customer">Customer</option>
            </select>
          </div>
          <button type="submit" disabled={saving} style={btnStyle('#2e7d32')}>{saving ? 'Creating...' : 'Next: Fund Account'}</button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={createFundAccount}>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Account Type</label>
            <select value={fundForm.accountType} onChange={e => setFundForm(f => ({ ...f, accountType: e.target.value }))} style={inputStyle}>
              <option value="bank_account">Bank Account</option>
              <option value="vpa">UPI (VPA)</option>
            </select>
          </div>
          {fundForm.accountType === 'bank_account' ? (
            <>
              <Field label="Account Holder Name *" value={fundForm.bankName} onChange={v => setFundForm(f => ({ ...f, bankName: v }))} />
              <Field label="IFSC Code *" value={fundForm.bankIfsc} onChange={v => setFundForm(f => ({ ...f, bankIfsc: v }))} placeholder="e.g. SBIN0001234" />
              <Field label="Account Number *" value={fundForm.bankAccount} onChange={v => setFundForm(f => ({ ...f, bankAccount: v }))} />
            </>
          ) : (
            <Field label="VPA Address *" value={fundForm.vpa} onChange={v => setFundForm(f => ({ ...f, vpa: v }))} placeholder="e.g. user@paytm" />
          )}
          <button type="submit" disabled={saving} style={btnStyle('#2e7d32')}>{saving ? 'Creating...' : 'Next: Payout Details'}</button>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={createPayout}>
          <Field label="Amount (INR) *" value={payoutForm.amount} onChange={v => setPayoutForm(f => ({ ...f, amount: v }))} type="number" />
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Payment Mode</label>
            <select value={payoutForm.mode} onChange={e => setPayoutForm(f => ({ ...f, mode: e.target.value }))} style={inputStyle}>
              <option value="NEFT">NEFT</option>
              <option value="RTGS">RTGS</option>
              <option value="IMPS">IMPS</option>
              <option value="UPI">UPI</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Purpose</label>
            <select value={payoutForm.purpose} onChange={e => setPayoutForm(f => ({ ...f, purpose: e.target.value }))} style={inputStyle}>
              <option value="salary">Salary</option>
              <option value="refund">Refund</option>
              <option value="cashback">Cashback</option>
              <option value="payout">Payout</option>
              <option value="utility_bill">Utility Bill</option>
              <option value="vendor_bill">Vendor Bill</option>
            </select>
          </div>
          <Field label="Narration" value={payoutForm.narration} onChange={v => setPayoutForm(f => ({ ...f, narration: v }))} placeholder="e.g. Salary April 2026" />
          <button type="submit" disabled={saving} style={btnStyle('#2e7d32')}>{saving ? 'Processing...' : 'Create Payout'}</button>
        </form>
      )}
    </div>
  );
}

// ─── Bulk Salary Payout ─────────────────────────────────────────────────────

function BulkSalary({ onDone, setError }) {
  const [month, setMonth] = useState('');
  const [payrolls, setPayrolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selected, setSelected] = useState([]);
  const [results, setResults] = useState(null);
  const [sendSlips, setSendSlips] = useState(true);

  async function fetchPayrolls() {
    if (!month) return;
    setLoading(true); setError('');
    try {
      const data = await api.get(`/employees/payroll?month=${month}`);
      const list = Array.isArray(data) ? data : (data.data || []);
      setPayrolls(list);
      setSelected(list.filter(p => p.status !== 'Paid').map(p => p.id));
    } catch (err) { setError(err.message || 'Failed to load payroll records'); }
    setLoading(false);
  }

  async function processBulk() {
    if (selected.length === 0) return setError('No payroll records selected');
    setProcessing(true); setError('');
    try {
      const res = await api.post('/payouts/bulk-salary', { payrollIds: selected, sendSlips });
      setResults(res);
    } catch (err) { setError(err.message || 'Bulk salary processing failed'); }
    setProcessing(false);
  }

  function toggleSelect(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleAll() {
    const unpaid = payrolls.filter(p => p.status !== 'Paid');
    if (selected.length === unpaid.length) setSelected([]);
    else setSelected(unpaid.map(p => p.id));
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>Bulk Salary Payout</div>

      {/* Month selector */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <label style={labelStyle}>Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={inputStyle} />
        </div>
        <button onClick={fetchPayrolls} disabled={!month || loading} style={btnStyle('#2e7d32')}>{loading ? 'Loading...' : 'Fetch Payroll'}</button>
      </div>

      {/* Results */}
      {results && (
        <div style={{ marginBottom: 20, padding: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 8 }}>Processing Complete</div>
          <div style={{ fontSize: 13, color: '#1e293b' }}>
            Successful: {results.success?.length || 0} | Failed: {results.failed?.length || 0} | Emails Sent: {results.emailsSent?.length || 0}
          </div>
          {results.failed?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#dc2626' }}>Failed:</div>
              {results.failed.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: '#dc2626', marginTop: 2 }}>{f.error}</div>
              ))}
            </div>
          )}
          <button onClick={onDone} style={{ ...btnStyle('#2e7d32'), marginTop: 12 }}>Back to Payouts</button>
        </div>
      )}

      {/* Payroll table */}
      {payrolls.length > 0 && !results && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#475569' }}>{selected.length} of {payrolls.filter(p => p.status !== 'Paid').length} selected</div>
            <label style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={sendSlips} onChange={e => setSendSlips(e.target.checked)} /> Send salary slips via email
            </label>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ ...thStyle, width: 40 }}>
                    <input type="checkbox" onChange={toggleAll} checked={selected.length === payrolls.filter(p => p.status !== 'Paid').length && selected.length > 0} />
                  </th>
                  <th style={thStyle}>Employee</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Net Salary</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Month</th>
                </tr>
              </thead>
              <tbody>
                {payrolls.map((p, i) => {
                  const isPaid = p.status === 'Paid';
                  return (
                    <tr key={p.id} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc', opacity: isPaid ? 0.5 : 1 }}>
                      <td style={tdStyle}>
                        <input type="checkbox" disabled={isPaid} checked={selected.includes(p.id)} onChange={() => toggleSelect(p.id)} />
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{p.employeeName || p.employeeId}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{formatINR(p.netSalary)}</td>
                      <td style={tdStyle}>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, color: isPaid ? '#16a34a' : '#ca8a04', background: isPaid ? '#f0fdf4' : '#fefce8' }}>{p.status || 'Pending'}</span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12, color: '#64748b' }}>{p.month || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button onClick={processBulk} disabled={processing || selected.length === 0} style={{ ...btnStyle(selected.length === 0 ? '#94a3b8' : '#2e7d32'), marginTop: 16 }}>
            {processing ? 'Processing...' : `Process ${selected.length} Payroll(s)`}
          </button>
        </>
      )}

      {payrolls.length === 0 && month && !loading && <Empty text="No payroll records found for this month." />}
    </div>
  );
}

// ─── Payout Detail ──────────────────────────────────────────────────────────

function PayoutDetail({ payout, loading }) {
  if (loading) return <Loading text="Loading payout details..." />;
  if (!payout) return <Empty text="No payout selected." />;

  const st = STATUS_COLORS[(payout.status || '').toLowerCase()] || STATUS_COLORS.pending;

  const fields = [
    { label: 'Payout ID', value: payout.razorpayPayoutId || payout.id },
    { label: 'Employee', value: payout.employeeName || '-' },
    { label: 'Amount', value: formatINR(payout.amount) },
    { label: 'Currency', value: payout.currency || 'INR' },
    { label: 'Mode', value: payout.mode || '-' },
    { label: 'Purpose', value: payout.purpose || '-' },
    { label: 'Narration', value: payout.narration || '-' },
    { label: 'Reference', value: payout.referenceId || payout.reference_id || '-' },
    { label: 'Month', value: payout.month || '-' },
    { label: 'Created', value: payout.createdAt ? new Date(payout.createdAt).toLocaleString('en-IN') : '-' },
    { label: 'Created By', value: payout.createdBy || '-' },
  ];

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, maxWidth: 600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>Payout Details</div>
        <span style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 14, fontSize: 12, fontWeight: 700, color: st.color, background: st.bg, border: `1px solid ${st.border}`, textTransform: 'capitalize' }}>{payout.status || 'unknown'}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {fields.map(f => (
          <div key={f.label}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{f.label}</div>
            <div style={{ fontSize: 14, color: '#1e293b', fontWeight: f.label === 'Amount' ? 700 : 400 }}>{f.value}</div>
          </div>
        ))}
      </div>

      {/* Status timeline */}
      {payout.status_details && (
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>Status Details</div>
          <div style={{ fontSize: 13, color: '#1e293b' }}>
            {payout.status_details.description || payout.status_details.reason || 'No additional details.'}
          </div>
        </div>
      )}

      {payout.notes && Object.keys(payout.notes).length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>Notes</div>
          {Object.entries(payout.notes).map(([k, v]) => (
            <div key={k} style={{ fontSize: 12, color: '#64748b' }}><strong>{k}:</strong> {v}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared Components & Styles ─────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} style={{ ...inputStyle, width: '100%' }} />
    </div>
  );
}

function Loading({ text }) {
  return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>{text}</div>;
}

function Empty({ text }) {
  return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>{text}</div>;
}

const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 };
const inputStyle = { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' };
const errorStyle = { padding: '8px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 12, fontSize: 13 };
const tableStyle = { width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' };
const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#475569', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' };
const tdStyle = { padding: '8px 14px', fontSize: 13, color: '#1e293b', borderBottom: '1px solid #e5e7eb' };

function btnStyle(bg) {
  return { padding: '8px 20px', background: bg, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
}
