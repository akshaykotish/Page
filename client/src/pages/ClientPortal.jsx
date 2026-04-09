import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'bills', label: 'Bills' },
  { key: 'documents', label: 'Documents' },
  { key: 'messages', label: 'Messages' },
  { key: 'profile', label: 'Profile' },
];

function fmtCurrency(v) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v || 0);
}

function fmtDate(d) {
  if (!d) return '--';
  try {
    const dt = typeof d === 'object' && d._seconds ? new Date(d._seconds * 1000) : new Date(d);
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return '--'; }
}

function StatusBadge({ status }) {
  const s = (status || 'draft').toLowerCase();
  const colors = {
    paid: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
    sent: { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
    overdue: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
    draft: { bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' },
    pending: { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
    cancelled: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  };
  const c = colors[s] || colors.draft;
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: c.bg, color: c.color, border: `1px solid ${c.border}`, textTransform: 'capitalize' }}>
      {status || 'Draft'}
    </span>
  );
}

export default function ClientPortal() {
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Dashboard
  const [dashboard, setDashboard] = useState(null);

  // Bills
  const [bills, setBills] = useState([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [payingId, setPayingId] = useState(null);

  // Documents
  const [documents, setDocuments] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Messages
  const [threads, setThreads] = useState([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [selectedThread, setSelectedThread] = useState(null);
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');
  const [sending, setSending] = useState(false);

  // Profile
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  const msgTimer = useRef(null);

  function flash(text) {
    setMsg(text);
    clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(''), 3000);
  }

  // ─── Load Dashboard on mount ────────────────────────────────────────────
  useEffect(() => { loadDashboard(); }, []);

  useEffect(() => {
    if (tab === 'bills' && bills.length === 0) loadBills();
    if (tab === 'documents' && documents.length === 0) loadDocuments();
    if (tab === 'messages' && threads.length === 0) loadMessages();
    if (tab === 'profile' && !profile) loadProfile();
  }, [tab]);

  async function loadDashboard() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/client/dashboard');
      setDashboard(data);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function loadBills() {
    setBillsLoading(true);
    try {
      const data = await api.get('/client/bills');
      setBills(data.bills || []);
    } catch (err) {
      flash('Failed to load bills: ' + (err.message || ''));
    } finally {
      setBillsLoading(false);
    }
  }

  async function loadDocuments() {
    setDocsLoading(true);
    try {
      const data = await api.get('/client/documents');
      setDocuments(data.documents || []);
      setReceipts(data.receipts || []);
    } catch (err) {
      flash('Failed to load documents: ' + (err.message || ''));
    } finally {
      setDocsLoading(false);
    }
  }

  async function loadMessages() {
    setMsgsLoading(true);
    try {
      const data = await api.get('/client/messages');
      setThreads(data.threads || []);
      setTotalUnread(data.totalUnread || 0);
    } catch (err) {
      flash('Failed to load messages: ' + (err.message || ''));
    } finally {
      setMsgsLoading(false);
    }
  }

  async function loadProfile() {
    setProfileLoading(true);
    try {
      const data = await api.get('/client/profile');
      setProfile(data);
      setProfileForm({ name: data.name || '', company: data.company || '', address: data.address || '', gstin: data.gstin || '', pan: data.pan || '' });
    } catch (err) {
      flash('Failed to load profile: ' + (err.message || ''));
    } finally {
      setProfileLoading(false);
    }
  }

  async function handlePay(billId) {
    setPayingId(billId);
    try {
      const data = await api.post(`/client/bills/${billId}/pay`);
      if (data.paymentLink) {
        window.open(data.paymentLink, '_blank');
        flash('Payment link opened in new tab');
      }
    } catch (err) {
      flash('Payment failed: ' + (err.message || ''));
    } finally {
      setPayingId(null);
    }
  }

  async function handleDownloadDoc(docId) {
    try {
      const data = await api.get(`/client/documents/${docId}/download`);
      if (data.document?.url || data.document?.fileUrl || data.document?.data) {
        const url = data.document.url || data.document.fileUrl || data.document.data;
        window.open(url, '_blank');
      } else {
        flash('No download URL available');
      }
    } catch (err) {
      flash('Download failed: ' + (err.message || ''));
    }
  }

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!newBody.trim()) return;
    setSending(true);
    try {
      const payload = { body: newBody.trim() };
      if (selectedThread) {
        payload.threadId = selectedThread.threadId;
        payload.subject = selectedThread.subject;
      } else {
        payload.subject = newSubject.trim() || 'New Message';
      }
      await api.post('/client/messages', payload);
      setNewBody('');
      setNewSubject('');
      flash('Message sent');
      loadMessages();
    } catch (err) {
      flash('Send failed: ' + (err.message || ''));
    } finally {
      setSending(false);
    }
  }

  async function handleMarkRead(threadId) {
    try {
      await api.put(`/client/messages/${threadId}/read`);
      loadMessages();
    } catch { /* silent */ }
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    setProfileSaving(true);
    try {
      await api.put('/client/profile', profileForm);
      flash('Profile updated');
      loadProfile();
    } catch (err) {
      flash('Save failed: ' + (err.message || ''));
    } finally {
      setProfileSaving(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#666', fontFamily: "'Poppins', sans-serif" }}>Loading...</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#dc2626', fontFamily: "'Poppins', sans-serif" }}>{error}</div>;

  return (
    <div style={{ padding: '0 20px 40px', maxWidth: 1400, margin: '0 auto', fontFamily: "'Poppins', sans-serif" }}>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 22, color: '#1a1a1a', margin: '0 0 16px' }}>Client Portal</h2>

      {msg && (
        <div style={{ padding: '7px 14px', background: msg.includes('ail') || msg.includes('error') ? '#fef2f2' : '#f0fdf4', color: msg.includes('ail') || msg.includes('error') ? '#dc2626' : '#16a34a', borderRadius: 6, marginBottom: 10, fontSize: 12, fontWeight: 500 }}>
          {msg}
        </div>
      )}

      {/* ═══ TABS ═══ */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '10px 24px', border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', fontWeight: tab === t.key ? 700 : 500, borderBottom: tab === t.key ? '3px solid #2e7d32' : '3px solid transparent', background: tab === t.key ? '#f0fdf4' : 'transparent', color: tab === t.key ? '#2e7d32' : '#64748b', marginBottom: -2 }}>
            {t.label}
            {t.key === 'messages' && totalUnread > 0 && (
              <span style={{ marginLeft: 6, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, verticalAlign: 'super' }}>{totalUnread}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* DASHBOARD TAB                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'dashboard' && dashboard && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
            {[
              { label: 'Total Bills', value: dashboard.summary?.totalBills || 0, icon: '📄', color: '#2563eb' },
              { label: 'Unpaid Bills', value: dashboard.summary?.unpaidBills || 0, icon: '⏳', color: '#d97706' },
              { label: 'Outstanding', value: fmtCurrency(dashboard.summary?.totalOutstanding), icon: '💰', color: '#dc2626' },
              { label: 'Total Paid', value: fmtCurrency(dashboard.summary?.totalPaid), icon: '✅', color: '#16a34a' },
              { label: 'Active Projects', value: dashboard.summary?.activeProjects || 0, icon: '🔧', color: '#7c3aed' },
              { label: 'Shared Documents', value: dashboard.summary?.sharedDocuments || 0, icon: '📁', color: '#0891b2' },
              { label: 'Unread Messages', value: dashboard.summary?.unreadMessages || 0, icon: '✉️', color: '#e11d48' },
            ].map((card, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 28, lineHeight: 1 }}>{card.icon}</div>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginBottom: 2 }}>{card.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: card.color }}>{card.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Recent Invoices */}
          {(dashboard.recentInvoices || []).length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: '#1a1a1a', marginBottom: 10 }}>Recent Invoices</h3>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Invoice #</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Date</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Amount</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recentInvoices.map(inv => (
                      <tr key={inv.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 500 }}>{inv.invoiceNumber || '--'}</td>
                        <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmtDate(inv.date)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(inv.total)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}><StatusBadge status={inv.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Payments */}
          {(dashboard.recentPayments || []).length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: '#1a1a1a', marginBottom: 10 }}>Recent Payments</h3>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Date</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Amount</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recentPayments.map(p => (
                      <tr key={p.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmtDate(p.paidAt)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>{fmtCurrency(p.amount)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', textTransform: 'capitalize' }}>{p.method}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Active Projects */}
          {(dashboard.activeProjects || []).length > 0 && (
            <div>
              <h3 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: '#1a1a1a', marginBottom: 10 }}>Active Projects</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {dashboard.activeProjects.map(p => (
                  <div key={p.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 18 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: '#1a1a1a' }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, textTransform: 'capitalize' }}>{p.status}</div>
                    <div style={{ background: '#f1f5f9', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${p.progress || 0}%`, height: '100%', background: '#2e7d32', borderRadius: 6, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, textAlign: 'right' }}>{p.progress || 0}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* BILLS TAB                                                          */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'bills' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: '#1a1a1a', margin: 0 }}>Your Bills</h3>
            <button onClick={loadBills} disabled={billsLoading} style={{ padding: '6px 16px', background: '#f8fafc', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', color: '#475569' }}>
              {billsLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {billsLoading && bills.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading bills...</div>
          ) : bills.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>No bills found</div>
              <div style={{ fontSize: 13 }}>Bills will appear here when invoices are created for your account.</div>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Invoice #</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Date</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Due Date</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Amount</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map(bill => (
                    <tr key={bill.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 500 }}>{bill.invoiceNumber || '--'}</td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmtDate(bill.date)}</td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmtDate(bill.dueDate)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(bill.total)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}><StatusBadge status={bill.status} /></td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        {(bill.status || '').toLowerCase() !== 'paid' ? (
                          <button onClick={() => handlePay(bill.id)} disabled={payingId === bill.id} style={{ padding: '5px 14px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: payingId === bill.id ? 'wait' : 'pointer', opacity: payingId === bill.id ? 0.6 : 1 }}>
                            {payingId === bill.id ? 'Creating...' : 'Pay Now'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 500 }}>Paid {fmtDate(bill.paidDate)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Bill Items Expansion (simple inline preview) */}
          {bills.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 }}>Bill Details</h4>
              <div style={{ display: 'grid', gap: 12 }}>
                {bills.filter(b => (b.items || []).length > 0).slice(0, 5).map(bill => (
                  <div key={bill.id} style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#1a1a1a' }}>{bill.invoiceNumber || 'Invoice'} - {fmtCurrency(bill.total)}</div>
                    {(bill.items || []).map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#475569', padding: '3px 0', borderBottom: idx < bill.items.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                        <span>{item.description} x{item.qty}</span>
                        <span style={{ fontWeight: 500 }}>{fmtCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* DOCUMENTS TAB                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'documents' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: '#1a1a1a', margin: 0 }}>Shared Documents</h3>
            <button onClick={loadDocuments} disabled={docsLoading} style={{ padding: '6px 16px', background: '#f8fafc', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', color: '#475569' }}>
              {docsLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {docsLoading && documents.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading documents...</div>
          ) : documents.length === 0 && receipts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>No documents</div>
              <div style={{ fontSize: 13 }}>Documents shared with you will appear here.</div>
            </div>
          ) : (
            <>
              {/* Shared Documents */}
              {documents.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Document</th>
                          <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Type</th>
                          <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Shared On</th>
                          <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map(doc => (
                          <tr key={doc.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 14px', fontWeight: 500 }}>{doc.title || doc.name || 'Untitled'}</td>
                            <td style={{ padding: '10px 14px', color: '#64748b', textTransform: 'capitalize' }}>{doc.type || doc.category || 'Document'}</td>
                            <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmtDate(doc.sharedAt)}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                              <button onClick={() => handleDownloadDoc(doc.id)} style={{ padding: '5px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                Download
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Receipts */}
              {receipts.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginBottom: 8 }}>Payment Receipts</h4>
                  <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Receipt</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Amount</th>
                          <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>Paid Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receipts.map(r => (
                          <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 14px', fontWeight: 500 }}>{r.title || r.invoiceNumber || '--'}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>{fmtCurrency(r.total)}</td>
                            <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmtDate(r.paidDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* MESSAGES TAB                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'messages' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: '#1a1a1a', margin: 0 }}>
              Messages {totalUnread > 0 && <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>({totalUnread} unread)</span>}
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedThread && (
                <button onClick={() => setSelectedThread(null)} style={{ padding: '6px 16px', background: '#f8fafc', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', color: '#475569' }}>
                  Back to Threads
                </button>
              )}
              <button onClick={loadMessages} disabled={msgsLoading} style={{ padding: '6px 16px', background: '#f8fafc', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', color: '#475569' }}>
                {msgsLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>

          {msgsLoading && threads.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading messages...</div>
          ) : !selectedThread ? (
            <>
              {/* New Message Form */}
              <form onSubmit={handleSendMessage} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 10 }}>New Message</div>
                <input value={newSubject} onChange={e => setNewSubject(e.target.value)} placeholder="Subject" style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', marginBottom: 8, outline: 'none', boxSizing: 'border-box' }} />
                <textarea value={newBody} onChange={e => setNewBody(e.target.value)} placeholder="Type your message..." rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button type="submit" disabled={sending || !newBody.trim()} style={{ padding: '8px 20px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: sending ? 'wait' : 'pointer', opacity: sending || !newBody.trim() ? 0.6 : 1 }}>
                    {sending ? 'Sending...' : 'Send Message'}
                  </button>
                </div>
              </form>

              {/* Threads List */}
              {threads.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>No messages</div>
                  <div style={{ fontSize: 13 }}>Start a conversation using the form above.</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {threads.map(thread => (
                    <div key={thread.threadId} onClick={() => { setSelectedThread(thread); if (thread.unread > 0) handleMarkRead(thread.threadId); }} style={{ background: thread.unread > 0 ? '#eff6ff' : '#fff', border: `1px solid ${thread.unread > 0 ? '#bfdbfe' : '#e5e7eb'}`, borderRadius: 8, padding: '14px 18px', cursor: 'pointer', transition: 'border-color 0.2s' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ fontWeight: thread.unread > 0 ? 700 : 500, fontSize: 14, color: '#1a1a1a' }}>
                          {thread.subject}
                          {thread.unread > 0 && <span style={{ marginLeft: 8, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>{thread.unread}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtDate(thread.lastMessage?.createdAt)}</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ fontWeight: 500, color: thread.lastMessage?.sender === 'client' ? '#2e7d32' : '#2563eb' }}>
                          {thread.lastMessage?.sender === 'client' ? 'You' : 'Admin'}:
                        </span>{' '}
                        {thread.lastMessage?.body?.substring(0, 100)}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{thread.messages?.length || 0} message{(thread.messages?.length || 0) !== 1 ? 's' : ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Thread Detail View */
            <div>
              <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 18px', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a1a' }}>{selectedThread.subject}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{selectedThread.messages?.length || 0} messages</div>
              </div>

              {/* Message Thread */}
              <div style={{ display: 'grid', gap: 10, marginBottom: 20, maxHeight: 500, overflowY: 'auto', padding: '4px 0' }}>
                {(selectedThread.messages || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: m.sender === 'client' ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '70%', background: m.sender === 'client' ? '#f0fdf4' : '#eff6ff', border: `1px solid ${m.sender === 'client' ? '#bbf7d0' : '#bfdbfe'}`, borderRadius: 10, padding: '10px 14px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: m.sender === 'client' ? '#2e7d32' : '#2563eb', marginBottom: 4 }}>
                        {m.sender === 'client' ? (m.clientName || 'You') : 'Admin'}
                      </div>
                      <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, textAlign: 'right' }}>{fmtDate(m.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply Form */}
              <form onSubmit={handleSendMessage} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14 }}>
                <textarea value={newBody} onChange={e => setNewBody(e.target.value)} placeholder="Type your reply..." rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button type="submit" disabled={sending || !newBody.trim()} style={{ padding: '8px 20px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: sending ? 'wait' : 'pointer', opacity: sending || !newBody.trim() ? 0.6 : 1 }}>
                    {sending ? 'Sending...' : 'Reply'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PROFILE TAB                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'profile' && (
        <div>
          <h3 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: '#1a1a1a', marginBottom: 14 }}>Your Profile</h3>

          {profileLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading profile...</div>
          ) : !profile ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 13 }}>Unable to load profile.</div>
              <button onClick={loadProfile} style={{ marginTop: 10, padding: '6px 16px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Retry</button>
            </div>
          ) : (
            <form onSubmit={handleSaveProfile} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, maxWidth: 700 }}>
              {/* Read-only info */}
              <div style={{ marginBottom: 20, padding: '12px 16px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginBottom: 2 }}>Email</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{profile.email || '--'}</div>
                {profile.phone && (
                  <>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginTop: 8, marginBottom: 2 }}>Phone</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{profile.phone}</div>
                  </>
                )}
                {profile.createdAt && (
                  <>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginTop: 8, marginBottom: 2 }}>Member Since</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{fmtDate(profile.createdAt)}</div>
                  </>
                )}
              </div>

              {/* Editable Fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { key: 'name', label: 'Full Name', full: false },
                  { key: 'company', label: 'Company', full: false },
                  { key: 'gstin', label: 'GSTIN', full: false },
                  { key: 'pan', label: 'PAN', full: false },
                  { key: 'address', label: 'Address', full: true },
                ].map(f => (
                  <div key={f.key} style={{ gridColumn: f.full ? '1 / -1' : undefined }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>{f.label}</label>
                    {f.full ? (
                      <textarea value={profileForm[f.key] || ''} onChange={e => setProfileForm(prev => ({ ...prev, [f.key]: e.target.value }))} rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
                    ) : (
                      <input value={profileForm[f.key] || ''} onChange={e => setProfileForm(prev => ({ ...prev, [f.key]: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                    )}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 20 }}>
                <button type="submit" disabled={profileSaving} style={{ padding: '10px 28px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: profileSaving ? 'wait' : 'pointer', opacity: profileSaving ? 0.6 : 1 }}>
                  {profileSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
