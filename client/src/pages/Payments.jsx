import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { formatCurrency, formatDate } from '../utils/formatters';
import { api } from '../utils/api';

const METHODS = ['Bank Transfer', 'UPI', 'Cash', 'Credit Card', 'Cheque', 'Other'];
const TYPES = ['Incoming', 'Outgoing'];

const emptyPayment = {
  amount: '',
  type: 'Incoming',
  method: 'Bank Transfer',
  reference: '',
  description: '',
  invoiceId: '',
  status: 'Completed'
};

export default function Payments() {
  const [activeTab, setActiveTab] = useState('payments');
  const [payments, setPayments] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [apiLogs, setApiLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyPayment });
  const [newKeyName, setNewKeyName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    fetchPayments();
    fetchApiKeys();
    fetchApiLogs();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function fetchPayments() {
    setLoading(true);
    setError('');
    try {
      const q = query(collection(db, 'payments'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching payments:', err);
      setError('Failed to load payments');
    }
    setLoading(false);
  }

  async function fetchApiKeys() {
    try {
      const q = query(collection(db, 'api_keys'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setApiKeys(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching API keys:', err);
    }
  }

  async function fetchApiLogs() {
    try {
      const q = query(collection(db, 'api_logs'), orderBy('timestamp', 'desc'));
      const snap = await getDocs(q);
      setApiLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching API logs:', err);
    }
  }

  async function handleSubmitPayment(e) {
    e.preventDefault();
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setSaving(true);
    setError('');
    const data = {
      amount: parseFloat(form.amount),
      type: form.type,
      method: form.method,
      reference: form.reference.trim(),
      description: form.description.trim(),
      invoiceId: form.invoiceId.trim() || null,
      status: 'Completed',
      source: 'Manual',
      createdAt: new Date().toISOString()
    };

    try {
      await addDoc(collection(db, 'payments'), data);
      setForm({ ...emptyPayment });
      setShowForm(false);
      await fetchPayments();
    } catch (err) {
      console.error('Error recording payment:', err);
      setError('Failed to record payment');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePayment(id) {
    setSaving(true);
    setError('');
    try {
      await deleteDoc(doc(db, 'payments', id));
      setDeleteConfirm(null);
      await fetchPayments();
    } catch (err) {
      console.error('Error deleting payment:', err);
      setError('Failed to delete payment');
    } finally {
      setSaving(false);
    }
  }

  function generateUUID() {
    return 'ak_' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  async function handleGenerateKey() {
    if (!newKeyName.trim()) return;
    const data = {
      key: generateUUID(),
      name: newKeyName.trim(),
      active: true,
      createdAt: new Date().toISOString()
    };
    try {
      await addDoc(collection(db, 'api_keys'), data);
      setNewKeyName('');
      fetchApiKeys();
    } catch (err) {
      console.error('Error generating API key:', err);
    }
  }

  async function toggleKeyStatus(keyDoc) {
    try {
      await updateDoc(doc(db, 'api_keys', keyDoc.id), { active: !keyDoc.active });
      fetchApiKeys();
    } catch (err) {
      console.error('Error toggling key status:', err);
    }
  }

  async function deleteKey(id) {
    if (!window.confirm('Delete this API key?')) return;
    try {
      await deleteDoc(doc(db, 'api_keys', id));
      fetchApiKeys();
    } catch (err) {
      console.error('Error deleting API key:', err);
    }
  }

  function maskKey(key) {
    if (!key) return '';
    if (key.length <= 12) return key;
    return key.substring(0, 6) + '...' + key.substring(key.length - 4);
  }

  // Summary
  const totalIncoming = payments.filter(p => p.type === 'Incoming').reduce((s, p) => s + (p.amount || 0), 0);
  const totalOutgoing = payments.filter(p => p.type === 'Outgoing').reduce((s, p) => s + (p.amount || 0), 0);
  const netBalance = totalIncoming - totalOutgoing;

  const tabs = [
    { key: 'payments', label: 'Payments' },
    { key: 'api_keys', label: 'API Keys' },
    { key: 'api_logs', label: 'API Logs' }
  ];

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="loader"></div></div>;
  }

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', borderBottom: '2px solid #e5e7eb' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '0.75rem 1.25rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #1e3a5f' : '2px solid transparent',
              marginBottom: '-2px',
              cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#1e3a5f' : '#6b7280',
              fontSize: '0.9rem'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* PAYMENTS TAB */}
      {activeTab === 'payments' && (
        <div>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Total Incoming</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#22c55e' }}>{formatCurrency(totalIncoming)}</div>
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Total Outgoing</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#ef4444' }}>{formatCurrency(totalOutgoing)}</div>
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Net Balance</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: netBalance >= 0 ? '#22c55e' : '#ef4444' }}>{formatCurrency(netBalance)}</div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', background: '#fee2e2', border: '1px solid #fca5a5' }}>
              <div style={{ color: '#991b1b', fontWeight: 500 }}>{error}</div>
            </div>
          )}

          {/* Action bar */}
          <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Payment Records ({payments.length})</h3>
            <button className="btn btn-primary" onClick={() => setShowForm(!showForm)} disabled={saving}>
              {showForm ? 'Cancel' : '+ Record Payment'}
            </button>
          </div>

          {/* Payment form */}
          {showForm && (
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h4 style={{ marginTop: 0, marginBottom: '1rem' }}>Record Payment</h4>
              <form onSubmit={handleSubmitPayment}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Amount (INR) *</label>
                    <input type="number" step="0.01" min="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required disabled={saving} />
                  </div>
                  <div className="form-group">
                    <label>Type *</label>
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} disabled={saving}>
                      {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Method *</label>
                    <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} disabled={saving}>
                      {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Reference / Transaction ID</label>
                    <input type="text" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="e.g. UTR / Cheque No." disabled={saving} />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Payment description" disabled={saving} />
                  </div>
                  <div className="form-group">
                    <label>Invoice ID (optional)</label>
                    <input type="text" value={form.invoiceId} onChange={e => setForm({ ...form, invoiceId: e.target.value })} placeholder="Link to invoice" disabled={saving} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="submit" className="btn btn-primary" disabled={saving} style={{ opacity: saving ? 0.7 : 1 }}>
                    {saving ? 'Recording...' : 'Record Payment'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Payment table */}
          {payments.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
              <p>No payments recorded yet.</p>
            </div>
          ) : (
            <div className="card" style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem' }}>Date</th>
                    <th style={{ padding: '0.75rem' }}>Payment ID</th>
                    <th style={{ padding: '0.75rem' }}>Amount</th>
                    <th style={{ padding: '0.75rem' }}>Type</th>
                    <th style={{ padding: '0.75rem' }}>Method</th>
                    <th style={{ padding: '0.75rem' }}>Reference</th>
                    <th style={{ padding: '0.75rem' }}>Status</th>
                    <th style={{ padding: '0.75rem' }}>Source</th>
                    <th style={{ padding: '0.75rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.75rem', whiteSpace: 'nowrap' }}>{formatDate(p.createdAt)}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.75rem', fontFamily: 'monospace' }}>{p.id.substring(0, 8)}...</td>
                      <td style={{ padding: '0.75rem', fontWeight: 600, color: p.type === 'Incoming' ? '#22c55e' : '#ef4444' }}>{formatCurrency(p.amount)}</td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{
                          padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600,
                          background: p.type === 'Incoming' ? '#dcfce7' : '#fee2e2',
                          color: p.type === 'Incoming' ? '#166534' : '#991b1b'
                        }}>{p.type}</span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>{p.method}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>{p.reference || '--'}</td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{ padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: '#dcfce7', color: '#166534' }}>{p.status || 'Completed'}</span>
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>{p.source || 'Manual'}</td>
                      <td style={{ padding: '0.75rem' }}>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#ef4444', opacity: saving ? 0.5 : 1 }} onClick={() => setDeleteConfirm(p.id)} disabled={saving}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* API KEYS TAB */}
      {activeTab === 'api_keys' && (
        <div>
          {/* Generate key */}
          <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
            <h4 style={{ marginTop: 0, marginBottom: '1rem' }}>Generate API Key</h4>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
                <label>Key Name</label>
                <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="e.g. Mobile App, Website" />
              </div>
              <button className="btn btn-primary" onClick={handleGenerateKey} style={{ whiteSpace: 'nowrap' }}>Generate Key</button>
            </div>
          </div>

          {/* Key list */}
          <div className="card" style={{ overflow: 'auto', marginBottom: '1.5rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem' }}>Name</th>
                  <th style={{ padding: '0.75rem' }}>API Key</th>
                  <th style={{ padding: '0.75rem' }}>Status</th>
                  <th style={{ padding: '0.75rem' }}>Created</th>
                  <th style={{ padding: '0.75rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>No API keys generated yet.</td></tr>
                ) : apiKeys.map(k => (
                  <tr key={k.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{k.name}</td>
                    <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{maskKey(k.key)}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{
                        padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600,
                        background: k.active ? '#dcfce7' : '#fee2e2',
                        color: k.active ? '#166534' : '#991b1b'
                      }}>{k.active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>{formatDate(k.createdAt)}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => toggleKeyStatus(k)}>
                          {k.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => { navigator.clipboard.writeText(k.key); }}>
                          Copy
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#ef4444' }} onClick={() => deleteKey(k.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* API Documentation */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h4 style={{ marginTop: 0, marginBottom: '0.75rem' }}>API Documentation</h4>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>Use the following endpoint to record payments via API.</p>

            <div style={{ background: '#1e293b', color: '#e2e8f0', padding: '1rem', borderRadius: '8px', fontSize: '0.8rem', fontFamily: 'monospace', overflow: 'auto', marginBottom: '1rem' }}>
              <div style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>// Record a payment via API</div>
              <div><span style={{ color: '#22d3ee' }}>POST</span> /api/payments</div>
              <br />
              <div style={{ color: '#94a3b8' }}>// Headers</div>
              <div>{'{'}</div>
              <div>&nbsp;&nbsp;"Content-Type": "application/json",</div>
              <div>&nbsp;&nbsp;"X-API-Key": "your_api_key_here"</div>
              <div>{'}'}</div>
              <br />
              <div style={{ color: '#94a3b8' }}>// Request Body</div>
              <div>{'{'}</div>
              <div>&nbsp;&nbsp;"amount": 5000.00,</div>
              <div>&nbsp;&nbsp;"type": "Incoming",&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;// "Incoming" | "Outgoing"</div>
              <div>&nbsp;&nbsp;"method": "UPI",&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;// "Bank Transfer" | "UPI" | "Cash" | ...</div>
              <div>&nbsp;&nbsp;"reference": "UTR123",</div>
              <div>&nbsp;&nbsp;"description": "Client payment"</div>
              <div>{'}'}</div>
              <br />
              <div style={{ color: '#94a3b8' }}>// Response (201 Created)</div>
              <div>{'{'}</div>
              <div>&nbsp;&nbsp;"success": true,</div>
              <div>&nbsp;&nbsp;"paymentId": "abc123..."</div>
              <div>{'}'}</div>
            </div>

            <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: '8px', padding: '0.75rem', fontSize: '0.8rem', color: '#92400e' }}>
              <strong>Note:</strong> Keep your API keys secure. Do not expose them in client-side code. Each API call is logged for auditing purposes.
            </div>
          </div>
        </div>
      )}

      {/* API LOGS TAB */}
      {activeTab === 'api_logs' && (
        <div>
          <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>API Call Logs ({apiLogs.length})</h3>
            <button className="btn btn-secondary" onClick={fetchApiLogs} style={{ fontSize: '0.85rem' }}>Refresh</button>
          </div>

          {apiLogs.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
              <p>No API calls logged yet.</p>
            </div>
          ) : (
            <div className="card" style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem' }}>Timestamp</th>
                    <th style={{ padding: '0.75rem' }}>Endpoint</th>
                    <th style={{ padding: '0.75rem' }}>Method</th>
                    <th style={{ padding: '0.75rem' }}>Status</th>
                    <th style={{ padding: '0.75rem' }}>Payment ID</th>
                  </tr>
                </thead>
                <tbody>
                  {apiLogs.map(log => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.75rem', whiteSpace: 'nowrap' }}>
                        {log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : '--'}
                      </td>
                      <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{log.endpoint || '--'}</td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{
                          padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600,
                          background: '#e0e7ff', color: '#3730a3'
                        }}>{log.method || 'POST'}</span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{
                          padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600,
                          background: (log.status >= 200 && log.status < 300) ? '#dcfce7' : '#fee2e2',
                          color: (log.status >= 200 && log.status < 300) ? '#166534' : '#991b1b'
                        }}>{log.status || '--'}</span>
                      </td>
                      <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{log.paymentId || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
              Delete Payment?
            </h3>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
              Are you sure you want to delete this payment record? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
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
              <button
                onClick={() => handleDeletePayment(deleteConfirm)}
                disabled={saving}
                style={{
                  padding: '0.5rem 1.5rem',
                  borderRadius: '6px',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1
                }}
              >
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
