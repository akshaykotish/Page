import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const TYPE_STYLES = {
  product_link: { bg: '#e3f2fd', color: '#1565c0', label: 'Product Link' },
  bill:         { bg: '#fff3e0', color: '#e65100', label: 'Bill' },
  document:     { bg: '#f3e5f5', color: '#7b1fa2', label: 'Document' },
  invoice:      { bg: '#e8f5e9', color: '#2e7d32', label: 'Invoice' },
};

function getTypeStyle(type) {
  return TYPE_STYLES[type] || { bg: '#f5f5f5', color: '#444', label: type || 'Other' };
}

function isURL(str) {
  if (!str) return false;
  return str.startsWith('http://') || str.startsWith('https://') || str.startsWith('www.');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

const INVOICE_STATUS_STYLES = {
  paid:    { bg: '#dcfce7', color: '#16a34a', label: 'Paid' },
  pending: { bg: '#fef9c3', color: '#ca8a04', label: 'Pending' },
  sent:    { bg: '#dbeafe', color: '#2563eb', label: 'Sent' },
  overdue: { bg: '#fecaca', color: '#dc2626', label: 'Overdue' },
  draft:   { bg: '#f1f5f9', color: '#64748b', label: 'Draft' },
};

function getInvoiceStatusStyle(status) {
  return INVOICE_STATUS_STYLES[(status || '').toLowerCase()] || { bg: '#f1f5f9', color: '#64748b', label: status || 'Unknown' };
}

export default function ClientPortal() {
  const { user } = useAuth();
  const [shares, setShares] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [error, setError] = useState('');
  const [payingInvoiceId, setPayingInvoiceId] = useState(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    fetchShares();
    fetchInvoices();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function fetchShares() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/auth/my-shares');
      setShares(Array.isArray(data) ? data : data.shares || []);
    } catch (err) {
      setError(err.message || 'Failed to load shared items');
    } finally {
      setLoading(false);
    }
  }

  async function fetchInvoices() {
    setInvoicesLoading(true);
    try {
      const data = await api.get('/billing/invoices');
      const allInvoices = Array.isArray(data) ? data : data.invoices || [];
      // Filter invoices matching this client's email or phone
      const userEmail = (user?.email || '').toLowerCase();
      const userPhone = (user?.phone || user?.phoneNumber || '').replace(/\s+/g, '');
      const myInvoices = allInvoices.filter(inv => {
        const custEmail = (inv.customerEmail || inv.clientEmail || inv.customer?.email || '').toLowerCase();
        const custPhone = (inv.customerPhone || inv.clientPhone || inv.customer?.phone || '').replace(/\s+/g, '');
        if (userEmail && custEmail && custEmail === userEmail) return true;
        if (userPhone && custPhone && custPhone.includes(userPhone.slice(-10))) return true;
        return false;
      });
      setInvoices(myInvoices);
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  }

  async function handlePayNow(invoice) {
    const invoiceId = invoice._id || invoice.id;
    setPayingInvoiceId(invoiceId);
    try {
      const amount = invoice.total || invoice.grandTotal || invoice.amount || 0;
      const description = `Payment for Invoice ${invoice.invoiceNumber || invoice.number || ''}`.trim();
      const customer = {
        name: invoice.clientName || invoice.customerName || user?.name || '',
        email: invoice.customerEmail || invoice.clientEmail || user?.email || '',
        phone: invoice.customerPhone || invoice.clientPhone || user?.phone || user?.phoneNumber || '',
      };
      const result = await api.post('/razorpay/payment-link', {
        amount,
        description,
        customer,
        invoiceId,
      });
      if (result.paymentLink || result.short_url || result.url) {
        window.open(result.paymentLink || result.short_url || result.url, '_blank');
      } else {
        alert('Payment link created. Please check your email for the payment link.');
      }
    } catch (err) {
      console.error('Payment link creation failed:', err);
      alert(err.message || 'Failed to create payment link. Please try again.');
    } finally {
      setPayingInvoiceId(null);
    }
  }

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  })();

  const documents = shares.filter(s => s.type === 'document');
  const unpaidInvoiceCount = invoices.filter(inv => {
    const status = (inv.status || '').toLowerCase();
    return status !== 'paid';
  }).length;

  return (
    <div className="page-client-portal">
      {/* Welcome Card */}
      <div className="card" style={{ marginBottom: 28, background: '#f0faf0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 12,
            background: 'var(--lime)', border: '3px solid #1a1a1a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, fontSize: 24, color: 'var(--text)',
            boxShadow: '4px 4px 0 #1a1a1a', flexShrink: 0,
          }}>
            {(user?.name || '?')[0].toUpperCase()}
          </div>
          <div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 22, margin: 0 }}>
              {greeting}, {user?.name || user?.displayName || 'there'}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: 14, marginTop: 2 }}>
              Your Bills & Documents
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="stat-card blue">
          <div className="stat-label">Total Invoices</div>
          <div className="stat-value">{invoices.length}</div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">Unpaid</div>
          <div className="stat-value" style={{ color: '#e65100' }}>
            {unpaidInvoiceCount}
          </div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Shared Items</div>
          <div className="stat-value" style={{ color: '#2e7d32' }}>
            {shares.length}
          </div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Documents</div>
          <div className="stat-value" style={{ color: '#7b1fa2' }}>
            {documents.length}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card" style={{ marginBottom: 20, padding: '14px 20px', borderLeftColor: 'var(--red)', borderLeftWidth: 6 }}>
          <span style={{ fontWeight: 800, color: 'var(--red)' }}>{error}</span>
        </div>
      )}

      {/* Invoices Section */}
      <div className="section-header" style={{ marginTop: 8 }}>
        <h3 className="section-title">Your Invoices</h3>
        <button className="btn btn-sm btn-secondary" onClick={fetchInvoices}>Refresh</button>
      </div>

      {invoicesLoading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="loader" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Loading invoices...</p>
        </div>
      ) : invoices.length === 0 ? (
        <div className="card" style={{ padding: '24px', marginBottom: 20, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>No invoices found for your account.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={thStyle}>Invoice #</th>
                  <th style={thStyle}>Date</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => {
                  const invId = inv._id || inv.id || idx;
                  const status = (inv.status || 'draft').toLowerCase();
                  const ss = getInvoiceStatusStyle(status);
                  const isPaid = status === 'paid';
                  const amount = inv.total || inv.grandTotal || inv.amount || 0;
                  const invDate = inv.date || inv.invoiceDate || inv.createdAt;
                  return (
                    <tr key={invId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 700 }}>
                          {inv.invoiceNumber || inv.number || `#${String(invId).slice(0, 8)}`}
                        </span>
                      </td>
                      <td style={tdStyle}>{formatDate(invDate)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatCurrency(amount)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 12px',
                          borderRadius: 20,
                          background: ss.bg,
                          color: ss.color,
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          textTransform: 'capitalize',
                        }}>
                          {ss.label}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {!isPaid ? (
                          <button
                            onClick={() => handlePayNow(inv)}
                            disabled={payingInvoiceId === invId}
                            style={{
                              padding: '6px 16px',
                              borderRadius: 6,
                              background: '#2563eb',
                              color: '#fff',
                              border: 'none',
                              fontWeight: 700,
                              fontSize: '0.8rem',
                              cursor: payingInvoiceId === invId ? 'not-allowed' : 'pointer',
                              opacity: payingInvoiceId === invId ? 0.6 : 1,
                            }}
                          >
                            {payingInvoiceId === invId ? 'Processing...' : 'Pay Now'}
                          </button>
                        ) : (
                          <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.8rem' }}>Paid</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Documents Section */}
      <div className="section-header">
        <h3 className="section-title">Documents</h3>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="loader" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Loading documents...</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="card" style={{ padding: '24px', marginBottom: 20, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>No documents shared with you yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginBottom: 24 }}>
          {documents.map((share, idx) => {
            const ts = getTypeStyle(share.type);
            const dataIsLink = isURL(share.data);
            return (
              <div className="card" key={share._id || share.id || idx} style={{ padding: 20, transition: 'all 0.1s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span
                    className="status-badge"
                    style={{
                      background: ts.bg,
                      color: ts.color,
                      borderColor: ts.color,
                    }}
                  >
                    {ts.label}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                    {formatDate(share.createdAt || share.sharedAt)}
                  </span>
                </div>
                <h4 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 17, marginBottom: 10 }}>
                  {share.title || 'Untitled'}
                </h4>
                <div style={{
                  padding: '12px 16px', background: 'var(--bg)', border: '2px solid #eee',
                  borderRadius: 8, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)',
                  wordBreak: 'break-word',
                }}>
                  {dataIsLink ? (
                    <a
                      href={share.data.startsWith('http') ? share.data : `https://${share.data}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#1565c0', fontWeight: 700, textDecoration: 'underline' }}
                    >
                      {share.data}
                    </a>
                  ) : (
                    <span>{share.data || '--'}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Shared Items Section (bills, product links, invoices from shares) */}
      {shares.filter(s => s.type !== 'document').length > 0 && (
        <>
          <div className="section-header">
            <h3 className="section-title">Shared With You</h3>
            <button className="btn btn-sm btn-secondary" onClick={fetchShares}>Refresh</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {shares.filter(s => s.type !== 'document').map((share, idx) => {
              const ts = getTypeStyle(share.type);
              const dataIsLink = isURL(share.data);
              return (
                <div className="card" key={share._id || share.id || idx} style={{ padding: 20, transition: 'all 0.1s' }}>
                  {/* Type Badge + Date */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <span
                      className="status-badge"
                      style={{
                        background: ts.bg,
                        color: ts.color,
                        borderColor: ts.color,
                      }}
                    >
                      {ts.label}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                      {formatDate(share.createdAt || share.sharedAt)}
                    </span>
                  </div>

                  {/* Title */}
                  <h4 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 17, marginBottom: 10 }}>
                    {share.title || 'Untitled'}
                  </h4>

                  {/* Data / Content */}
                  <div style={{
                    padding: '12px 16px', background: 'var(--bg)', border: '2px solid #eee',
                    borderRadius: 8, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)',
                    wordBreak: 'break-word',
                  }}>
                    {share.type === 'product_link' && dataIsLink ? (
                      <a
                        href={share.data.startsWith('http') ? share.data : `https://${share.data}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: '#1565c0', fontWeight: 800, textDecoration: 'underline',
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                        }}
                      >
                        {share.data}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    ) : share.type === 'bill' ? (
                      <div>
                        <span style={{ fontWeight: 800, color: '#e65100' }}>Bill Details: </span>
                        {dataIsLink ? (
                          <a
                            href={share.data.startsWith('http') ? share.data : `https://${share.data}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1565c0', fontWeight: 700, textDecoration: 'underline' }}
                          >
                            {share.data}
                          </a>
                        ) : (
                          <span>{share.data}</span>
                        )}
                      </div>
                    ) : share.type === 'invoice' ? (
                      <div>
                        <span style={{ fontWeight: 800, color: '#2e7d32' }}>Invoice: </span>
                        {dataIsLink ? (
                          <a
                            href={share.data.startsWith('http') ? share.data : `https://${share.data}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1565c0', fontWeight: 700, textDecoration: 'underline' }}
                          >
                            View Invoice
                          </a>
                        ) : (
                          <span>{share.data}</span>
                        )}
                      </div>
                    ) : dataIsLink ? (
                      <a
                        href={share.data.startsWith('http') ? share.data : `https://${share.data}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#1565c0', fontWeight: 700, textDecoration: 'underline' }}
                      >
                        {share.data}
                      </a>
                    ) : (
                      <span>{share.data || '--'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Table styles for invoices
const thStyle = {
  padding: '0.75rem 1rem',
  textAlign: 'left',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '0.75rem 1rem',
  color: '#1e293b',
  whiteSpace: 'nowrap',
};
