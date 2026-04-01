import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

const PLATFORMS = [
  { id: 'razorpay', label: 'Razorpay', color: '#2563eb' },
  { id: 'cashfree', label: 'Cashfree', color: '#6d28d9' },
];

// ─── Documentation (exact platform payloads) ────────────────────────────────

const DOCS = {
  razorpay: {
    title: 'Razorpay Proxy API',
    desc: 'Your app sends Razorpay-format payloads to our gateway. We forward to Razorpay, track accounting, and return the real response.',
    baseUrl: 'https://akshaykotish.com/api/gateway/v1/razorpay',
    auth: `// Basic Auth — same as Razorpay
Authorization: Basic base64(ak_live_xxx:sk_live_xxx)

// Or header-based
x-api-key: ak_live_xxx
x-api-secret: sk_live_xxx`,
    flow: `Your App  →  akshaykotish.com/api/gateway  →  Razorpay
              ↓
    Auto: Accounting, Logging, Status Tracking`,
    endpoints: [
      {
        method: 'POST', path: '/orders', title: 'Create Order',
        desc: 'Payload is forwarded directly to Razorpay. Response is the real Razorpay order.',
        payload: `{
  "amount": 50000,
  "currency": "INR",
  "receipt": "receipt_1",
  "partial_payment": false,
  "notes": {
    "order_ref": "your-app-order-123"
  }
}`,
        response: `// Real Razorpay response
{
  "id": "order_EKm05x...",
  "entity": "order",
  "amount": 50000,
  "amount_paid": 0,
  "amount_due": 50000,
  "currency": "INR",
  "receipt": "receipt_1",
  "status": "created",
  "created_at": 1711929600
}`,
        curl: (key) => `curl -X POST \\
  https://akshaykotish.com/api/gateway/v1/razorpay/orders \\
  -u ${key || 'ak_live_xxx'}:sk_live_xxx \\
  -H "Content-Type: application/json" \\
  -d '{"amount":50000,"currency":"INR","receipt":"receipt_1"}'`,
      },
      {
        method: 'POST', path: '/payment_links', title: 'Create Payment Link',
        desc: 'Creates a real Razorpay payment link. The short_url in the response is a live payment page.',
        payload: `{
  "amount": 100000,
  "currency": "INR",
  "description": "Payment for Order #456",
  "customer": {
    "name": "Gaurav Kumar",
    "email": "gaurav@example.com",
    "contact": "+919999999999"
  },
  "notify": { "sms": true, "email": true },
  "callback_url": "https://yourapp.com/payment/done",
  "callback_method": "get"
}`,
        response: `{
  "id": "plink_ExjpAU...",
  "amount": 100000,
  "short_url": "https://rzp.io/i/nxrHnLJ",
  "status": "created",
  ...
}`,
        curl: (key) => `curl -X POST \\
  https://akshaykotish.com/api/gateway/v1/razorpay/payment_links \\
  -u ${key || 'ak_live_xxx'}:sk_live_xxx \\
  -H "Content-Type: application/json" \\
  -d '{"amount":100000,"currency":"INR","description":"Order #456","customer":{"name":"Gaurav","contact":"+919999999999"}}'`,
      },
      {
        method: 'GET', path: '/orders/:orderId', title: 'Fetch Order Status',
        desc: 'Fetches real-time order status from Razorpay. Our gateway also syncs the status locally.',
        payload: null,
        response: `{
  "id": "order_EKm05x...",
  "status": "paid",
  "amount_paid": 50000,
  ...
}`,
        curl: (key) => `curl https://akshaykotish.com/api/gateway/v1/razorpay/orders/order_EKm05x \\
  -u ${key || 'ak_live_xxx'}:sk_live_xxx`,
      },
      {
        method: 'GET', path: '/payments/:paymentId', title: 'Fetch Payment',
        desc: 'Get payment details from Razorpay.',
        payload: null, response: `{ "id": "pay_FHf...", "status": "captured", ... }`,
        curl: (key) => `curl https://akshaykotish.com/api/gateway/v1/razorpay/payments/pay_FHf \\
  -u ${key || 'ak_live_xxx'}:sk_live_xxx`,
      },
      {
        method: 'POST', path: '/payments/:paymentId/refund', title: 'Refund Payment',
        desc: 'Initiate a refund on Razorpay.',
        payload: `{ "amount": 50000, "speed": "normal" }`,
        response: `{ "id": "rfnd_...", "amount": 50000, "status": "processed" }`,
        curl: (key) => `curl -X POST \\
  https://akshaykotish.com/api/gateway/v1/razorpay/payments/pay_FHf/refund \\
  -u ${key || 'ak_live_xxx'}:sk_live_xxx \\
  -H "Content-Type: application/json" \\
  -d '{"amount":50000}'`,
      },
    ],
  },
  cashfree: {
    title: 'Cashfree Proxy API',
    desc: 'Your app sends Cashfree-format payloads to our gateway. We forward to Cashfree, track accounting, and return the real response.',
    baseUrl: 'https://akshaykotish.com/api/gateway/v1/cashfree',
    auth: `// Cashfree-style headers
x-client-id: ak_live_xxx
x-client-secret: sk_live_xxx

// Or generic headers
x-api-key: ak_live_xxx
x-api-secret: sk_live_xxx`,
    flow: `Your App  →  akshaykotish.com/api/gateway  →  Cashfree
              ↓
    Auto: Accounting, Logging, Status Tracking`,
    endpoints: [
      {
        method: 'POST', path: '/orders', title: 'Create Order',
        desc: 'Payload is forwarded directly to Cashfree PG. Response is the real Cashfree order.',
        payload: `{
  "order_id": "order_123",
  "order_amount": 10.15,
  "order_currency": "INR",
  "customer_details": {
    "customer_id": "cust_001",
    "customer_email": "john@example.com",
    "customer_phone": "9999999999",
    "customer_name": "John Doe"
  },
  "order_meta": {
    "return_url": "https://yourapp.com/return?order_id={order_id}",
    "notify_url": "https://yourapp.com/webhook"
  }
}`,
        response: `// Real Cashfree response
{
  "cf_order_id": 5145632,
  "order_id": "order_123",
  "order_status": "ACTIVE",
  "payment_session_id": "session_xxx...",
  "order_amount": 10.15,
  ...
}`,
        curl: (key) => `curl -X POST \\
  https://akshaykotish.com/api/gateway/v1/cashfree/orders \\
  -H "x-client-id: ${key || 'ak_live_xxx'}" \\
  -H "x-client-secret: sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"order_id":"order_123","order_amount":10.15,"order_currency":"INR","customer_details":{"customer_id":"cust_001","customer_phone":"9999999999"}}'`,
      },
      {
        method: 'POST', path: '/links', title: 'Create Payment Link',
        desc: 'Creates a real Cashfree payment link.',
        payload: `{
  "link_id": "link_001",
  "link_amount": 100,
  "link_currency": "INR",
  "link_purpose": "Payment for subscription",
  "customer_details": {
    "customer_phone": "9999999999",
    "customer_email": "john@example.com",
    "customer_name": "John Doe"
  }
}`,
        response: `{
  "cf_link_id": 345643,
  "link_id": "link_001",
  "link_url": "https://payments.cashfree.com/links/link_001",
  "link_status": "ACTIVE",
  ...
}`,
        curl: (key) => `curl -X POST \\
  https://akshaykotish.com/api/gateway/v1/cashfree/links \\
  -H "x-client-id: ${key || 'ak_live_xxx'}" \\
  -H "x-client-secret: sk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"link_id":"link_001","link_amount":100,"link_purpose":"Subscription"}'`,
      },
      {
        method: 'GET', path: '/orders/:orderId', title: 'Get Order Status',
        desc: 'Fetches real-time order status from Cashfree.',
        payload: null,
        response: `{ "order_id": "order_123", "order_status": "PAID", ... }`,
        curl: (key) => `curl https://akshaykotish.com/api/gateway/v1/cashfree/orders/order_123 \\
  -H "x-client-id: ${key || 'ak_live_xxx'}" \\
  -H "x-client-secret: sk_live_xxx"`,
      },
    ],
  },
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  page: { maxWidth: 1400, margin: '0 auto' },
  pageTitle: { fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 28, color: '#1a1a1a', margin: 0 },
  pageSub: { color: '#888', fontSize: 14, fontWeight: 600, marginTop: 4 },

  flowBox: {
    background: '#1a1a1a', color: '#c0e040', fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13, padding: '16px 20px', borderRadius: 10, border: '3px solid #1a1a1a',
    lineHeight: 1.8, whiteSpace: 'pre', overflowX: 'auto', marginBottom: 20,
    boxShadow: '4px 4px 0 #1a1a1a',
  },

  platformTabs: { display: 'flex', gap: 4, borderBottom: '3px solid #1a1a1a', marginBottom: 28 },
  platformTab: (active, color) => ({
    padding: '12px 28px', fontSize: 14, fontWeight: 800, textTransform: 'uppercase',
    letterSpacing: 0.5, background: active ? color : 'transparent',
    color: active ? '#fff' : '#888', border: 'none',
    borderBottom: active ? `4px solid ${color}` : '4px solid transparent',
    cursor: 'pointer', borderRadius: '8px 8px 0 0',
  }),

  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 },
  statCard: (accent) => ({
    background: '#fff', border: '3px solid #1a1a1a', borderRadius: 12,
    padding: '16px 20px', boxShadow: '4px 4px 0 #1a1a1a', borderTop: `4px solid ${accent}`,
  }),
  statLabel: { fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1.5, color: '#888', marginBottom: 4 },
  statValue: { fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 900 },

  card: { background: '#fff', border: '3px solid #1a1a1a', borderRadius: 12, padding: 24, boxShadow: '6px 6px 0 #1a1a1a' },
  cardTitle: { fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 18, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 },
  divider: { borderTop: '3px solid #1a1a1a', marginTop: 28, paddingTop: 28 },

  codeBlock: {
    background: '#1a1a1a', borderRadius: 8, padding: 16,
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.7,
    color: '#c0e040', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    position: 'relative', border: '3px solid #1a1a1a',
  },
  codeLabel: {
    display: 'inline-block', padding: '2px 10px', background: '#333', borderRadius: 4,
    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: '#aaa', marginBottom: 8, letterSpacing: 1,
  },
  copyBtn: {
    position: 'absolute', top: 8, right: 8, background: '#333', border: '2px solid #555',
    color: '#aaa', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },

  methodBadge: (m) => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 900,
    background: m === 'POST' ? '#dcfce7' : m === 'GET' ? '#dbeafe' : '#fee2e2',
    color: m === 'POST' ? '#166534' : m === 'GET' ? '#1e40af' : '#991b1b',
    border: `2px solid ${m === 'POST' ? '#166534' : m === 'GET' ? '#1e40af' : '#991b1b'}`,
  }),

  input: { width: '100%', padding: '10px 14px', background: '#fff', border: '2px solid #1a1a1a', borderRadius: 8, fontSize: 14, outline: 'none' },
  select: { padding: '10px 14px', background: '#fff', border: '2px solid #1a1a1a', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  label: { display: 'block', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1a1a1a', marginBottom: 6 },
  btnPrimary: {
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px',
    background: '#2e7d32', color: '#fff', border: '2px solid #1a1a1a', borderRadius: 8,
    fontSize: 13, fontWeight: 800, textTransform: 'uppercase', cursor: 'pointer', boxShadow: '4px 4px 0 #1a1a1a',
  },
  btnDanger: {
    padding: '6px 14px', background: '#ef5350', color: '#fff', border: '2px solid #1a1a1a',
    borderRadius: 6, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', cursor: 'pointer',
  },
  btnGhost: { background: 'transparent', border: '2px solid #1a1a1a', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase' },

  keyDisplay: {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 13, background: '#f5f5f0',
    border: '2px solid #ddd', borderRadius: 6, padding: '8px 12px', wordBreak: 'break-all',
  },
  secretBanner: { background: '#fff3e0', border: '3px solid #f57c00', borderRadius: 10, padding: 20, marginBottom: 20 },

  ipTag: {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px',
    background: '#f0faf0', border: '2px solid #2e7d32', borderRadius: 6, fontSize: 12, fontWeight: 700, color: '#1b5e20',
  },
  ipRemove: { background: 'none', border: 'none', color: '#ef5350', fontSize: 16, fontWeight: 900, cursor: 'pointer', padding: 0 },

  endpointCard: { background: '#fff', border: '2px solid #e0e0e0', borderRadius: 10, marginBottom: 16, overflow: 'hidden' },
  endpointHeader: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
    cursor: 'pointer', background: '#fafafa', borderBottom: '2px solid #e0e0e0',
  },

  th: { textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '3px solid #1a1a1a', background: '#f0faf0' },
  td: { padding: '10px 14px', fontSize: 13, borderBottom: '2px solid #eee', color: '#444', verticalAlign: 'middle' },

  appCard: (color) => ({
    background: '#fff', border: '3px solid #1a1a1a', borderRadius: 12, padding: 20,
    boxShadow: '4px 4px 0 #1a1a1a', borderLeft: `6px solid ${color}`,
  }),

  toast: (type) => ({
    position: 'fixed', bottom: 24, right: 24, zIndex: 10000, padding: '14px 20px',
    background: '#fff', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 14, fontWeight: 700,
    boxShadow: '6px 6px 0 #1a1a1a',
    borderLeft: `6px solid ${type === 'success' ? '#2e7d32' : type === 'error' ? '#ef5350' : '#90caf9'}`,
    maxWidth: 400,
  }),
  empty: { textAlign: 'center', padding: '40px 20px', color: '#888' },
};

const APP_COLORS = ['#2563eb', '#6d28d9', '#059669', '#d97706', '#dc2626', '#0891b2', '#7c3aed', '#ea580c'];

export default function ApiGateway() {
  const [activePlatform, setActivePlatform] = useState('razorpay');
  const [activeSection, setActiveSection] = useState('overview');
  const [keys, setKeys] = useState([]);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyMode, setNewKeyMode] = useState('live');
  const [newKeyPlatform, setNewKeyPlatform] = useState('all');
  const [generatedKey, setGeneratedKey] = useState(null);
  const [generating, setGenerating] = useState(false);

  const [editingIpKeyId, setEditingIpKeyId] = useState(null);
  const [ipInput, setIpInput] = useState('');
  const [expandedEndpoint, setExpandedEndpoint] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [keysRes, statsRes, logsRes, txnsRes] = await Promise.all([
        api.get('/gateway/manage/keys'),
        api.get('/gateway/manage/stats'),
        api.get('/gateway/manage/logs?limit=20'),
        api.get('/gateway/manage/transactions?limit=30'),
      ]);
      setKeys(keysRes || []);
      setStats(statsRes || {});
      setLogs(logsRes?.logs || []);
      setTransactions(txnsRes?.transactions || []);
    } catch (err) {
      console.error('Failed to fetch gateway data:', err);
      showToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'info');
  };

  const handleGenerateKey = async () => {
    if (!newKeyName.trim()) return showToast('Enter a key name (your app name)', 'error');
    setGenerating(true);
    try {
      const res = await api.post('/gateway/manage/keys', {
        name: newKeyName.trim(), platform: newKeyPlatform, mode: newKeyMode,
      });
      setGeneratedKey(res);
      setKeys(prev => [res, ...prev]);
      setNewKeyName('');
      showToast('API key generated');
      api.get('/gateway/manage/stats').then(setStats);
    } catch (err) {
      showToast(err.message || 'Failed to generate key', 'error');
    } finally { setGenerating(false); }
  };

  const handleRevokeKey = async (id) => {
    if (!window.confirm('Revoke this API key? All requests from this app will stop working.')) return;
    try {
      await api.delete(`/gateway/manage/keys/${id}`);
      setKeys(prev => prev.map(k => k.id === id ? { ...k, active: false } : k));
      showToast('API key revoked');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleAddIp = async (keyId) => {
    const ip = ipInput.trim();
    if (!ip) return;
    const ipRegex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    if (ip !== '0.0.0.0' && !ipRegex.test(ip)) return showToast('Invalid IP format', 'error');
    const key = keys.find(k => k.id === keyId);
    if (!key) return;
    const updated = [...(key.whitelistedIPs || []), ip];
    try {
      await api.put(`/gateway/manage/keys/${keyId}/ips`, { whitelistedIPs: updated });
      setKeys(prev => prev.map(k => k.id === keyId ? { ...k, whitelistedIPs: updated } : k));
      setIpInput('');
      showToast('IP whitelisted');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleRemoveIp = async (keyId, ipToRemove) => {
    const key = keys.find(k => k.id === keyId);
    if (!key) return;
    const updated = (key.whitelistedIPs || []).filter(ip => ip !== ipToRemove);
    try {
      await api.put(`/gateway/manage/keys/${keyId}/ips`, { whitelistedIPs: updated });
      setKeys(prev => prev.map(k => k.id === keyId ? { ...k, whitelistedIPs: updated } : k));
      showToast('IP removed');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const docs = DOCS[activePlatform];
  const firstActiveKey = keys.find(k => k.active)?.apiKey;

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}><div className="loader" /></div>;
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={S.pageTitle}>Payment API Gateway</h1>
        <p style={S.pageSub}>Single payment window for all your applications — auto accounting, real-time tracking</p>
      </div>

      {/* Flow diagram */}
      <div style={S.flowBox}>{`  LawMS, PetsCare, ZetsGeo ...
        │
        ▼
  akshaykotish.com/api/gateway   ← You are here (middleware)
        │
        ├──→  Auto Accounting (journal entries, ledger)
        ├──→  Real-time Status Tracking (per app)
        ├──→  API Logs & Analytics
        │
        ▼
  Razorpay / Cashfree   (single account, real transactions)`}</div>

      {/* Stats */}
      {stats && (
        <div style={S.statsGrid}>
          <div style={S.statCard('#2e7d32')}>
            <div style={S.statLabel}>Connected Apps</div>
            <div style={S.statValue}>{stats.activeKeys || 0}</div>
          </div>
          <div style={S.statCard('#2563eb')}>
            <div style={S.statLabel}>Total Transactions</div>
            <div style={S.statValue}>{stats.totalTransactions || 0}</div>
          </div>
          <div style={S.statCard('#059669')}>
            <div style={S.statLabel}>Paid</div>
            <div style={S.statValue}>{stats.paidTransactions || 0}</div>
          </div>
          <div style={S.statCard('#f59e0b')}>
            <div style={S.statLabel}>Total Volume</div>
            <div style={{ ...S.statValue, fontSize: 22 }}>Rs. {(stats.totalVolume || 0).toLocaleString('en-IN')}</div>
          </div>
          <div style={S.statCard('#2563eb')}>
            <div style={S.statLabel}>Razorpay</div>
            <div style={S.statValue}>{stats.razorpayTransactions || 0}</div>
          </div>
          <div style={S.statCard('#6d28d9')}>
            <div style={S.statLabel}>Cashfree</div>
            <div style={S.statValue}>{stats.cashfreeTransactions || 0}</div>
          </div>
        </div>
      )}

      {/* Per-App Breakdown */}
      {stats?.appBreakdown && Object.keys(stats.appBreakdown).length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ ...S.cardTitle, marginBottom: 12 }}>Per-App Breakdown</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {Object.entries(stats.appBreakdown).map(([app, data], idx) => (
              <div key={app} style={S.appCard(APP_COLORS[idx % APP_COLORS.length])}>
                <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>{app}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                  <div><span style={{ color: '#888' }}>Orders:</span> <strong>{data.orders}</strong></div>
                  <div><span style={{ color: '#888' }}>Paid:</span> <strong style={{ color: '#2e7d32' }}>{data.paid}</strong></div>
                  <div><span style={{ color: '#888' }}>Volume:</span> <strong>Rs. {data.totalAmount.toLocaleString('en-IN')}</strong></div>
                  <div><span style={{ color: '#888' }}>Collected:</span> <strong style={{ color: '#2e7d32' }}>Rs. {data.paidAmount.toLocaleString('en-IN')}</strong></div>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
                  {data.razorpay > 0 && <span style={{ marginRight: 12 }}>Razorpay: {data.razorpay}</span>}
                  {data.cashfree > 0 && <span>Cashfree: {data.cashfree}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section Tabs */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        {['overview', 'docs', 'transactions', 'logs'].map(s => (
          <button key={s} className={`tab ${activeSection === s ? 'active' : ''}`} onClick={() => setActiveSection(s)}>
            {s === 'overview' ? 'Keys & Security' : s === 'docs' ? 'Documentation' : s === 'transactions' ? 'Transactions' : 'API Logs'}
          </button>
        ))}
      </div>

      {/* ═══ KEYS & SECURITY ═══ */}
      {activeSection === 'overview' && (
        <>
          {generatedKey && (
            <div style={S.secretBanner}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <strong style={{ fontSize: 15, color: '#e65100' }}>Save your secret key now — it won't be shown again!</strong>
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <div style={S.label}>API Key (for {generatedKey.name})</div>
                  <div style={{ ...S.keyDisplay, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <code>{generatedKey.apiKey}</code>
                    <button style={S.btnGhost} onClick={() => copyToClipboard(generatedKey.apiKey)}>Copy</button>
                  </div>
                </div>
                <div>
                  <div style={S.label}>Secret Key</div>
                  <div style={{ ...S.keyDisplay, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff3e0', borderColor: '#f57c00' }}>
                    <code style={{ color: '#e65100' }}>{generatedKey.secretKey}</code>
                    <button style={S.btnGhost} onClick={() => copyToClipboard(generatedKey.secretKey)}>Copy</button>
                  </div>
                </div>
              </div>
              <button style={{ ...S.btnGhost, marginTop: 12 }} onClick={() => setGeneratedKey(null)}>I've saved my keys — dismiss</button>
            </div>
          )}

          <div style={S.card}>
            <h3 style={S.cardTitle}>Connect a New App</h3>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              Generate credentials for each app (LawMS, PetsCare, etc.) so you can track payments per application.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={S.label}>App Name</label>
                <input style={S.input} placeholder="e.g. LawMS, PetsCare, ZetsGeo" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} />
              </div>
              <div style={{ minWidth: 130 }}>
                <label style={S.label}>Platform</label>
                <select style={S.select} value={newKeyPlatform} onChange={e => setNewKeyPlatform(e.target.value)}>
                  <option value="all">All</option>
                  <option value="razorpay">Razorpay</option>
                  <option value="cashfree">Cashfree</option>
                </select>
              </div>
              <div style={{ minWidth: 110 }}>
                <label style={S.label}>Mode</label>
                <select style={S.select} value={newKeyMode} onChange={e => setNewKeyMode(e.target.value)}>
                  <option value="live">Live</option>
                  <option value="test">Test</option>
                </select>
              </div>
              <button style={{ ...S.btnPrimary, opacity: generating ? 0.6 : 1 }} onClick={handleGenerateKey} disabled={generating}>
                {generating ? 'Generating...' : 'Generate Credentials'}
              </button>
            </div>
          </div>

          <div style={S.divider}>
            <h3 style={S.cardTitle}>Connected Apps</h3>
            {keys.filter(k => k.active).length === 0 ? (
              <div style={S.empty}>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1a1a1a', marginBottom: 8 }}>No apps connected</h3>
                <p>Generate credentials above to connect your first app.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {keys.filter(k => k.active).map((key, idx) => (
                  <div key={key.id} style={{ ...S.card, padding: 20, borderLeft: `6px solid ${APP_COLORS[idx % APP_COLORS.length]}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <strong style={{ fontSize: 16 }}>{key.name}</strong>
                          <span style={{ padding: '2px 10px', borderRadius: 4, fontSize: 10, fontWeight: 900, background: key.mode === 'live' ? '#dcfce7' : '#fef3c7', color: key.mode === 'live' ? '#166534' : '#92400e', border: `2px solid ${key.mode === 'live' ? '#166534' : '#92400e'}` }}>
                            {key.mode?.toUpperCase()}
                          </span>
                          <span style={{ padding: '2px 10px', borderRadius: 4, fontSize: 10, fontWeight: 900, background: '#dbeafe', color: '#1e40af', border: '2px solid #1e40af' }}>
                            {key.platform?.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ ...S.keyDisplay, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <code style={{ flex: 1 }}>{key.apiKey}</code>
                          <button style={S.btnGhost} onClick={() => copyToClipboard(key.apiKey)}>Copy</button>
                        </div>
                        <div style={{ fontSize: 12, color: '#888' }}>
                          {key.requestCount || 0} requests
                          {key.lastUsed && <> &middot; Last used {new Date(key.lastUsed).toLocaleDateString('en-IN')}</>}
                        </div>
                      </div>
                      <button style={S.btnDanger} onClick={() => handleRevokeKey(key.id)}>Revoke</button>
                    </div>

                    {/* IP Whitelist */}
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '2px solid #eee' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>
                          IP Whitelist
                          <span style={{ fontWeight: 600, color: '#888', textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>
                            {(!key.whitelistedIPs || key.whitelistedIPs.length === 0) ? '(all IPs allowed)' : `(${key.whitelistedIPs.length} IPs)`}
                          </span>
                        </div>
                        <button style={S.btnGhost} onClick={() => setEditingIpKeyId(editingIpKeyId === key.id ? null : key.id)}>
                          {editingIpKeyId === key.id ? 'Done' : 'Edit'}
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: editingIpKeyId === key.id ? 12 : 0 }}>
                        {(key.whitelistedIPs || []).map(ip => (
                          <div key={ip} style={S.ipTag}>
                            {ip}
                            {editingIpKeyId === key.id && <button style={S.ipRemove} onClick={() => handleRemoveIp(key.id, ip)}>&times;</button>}
                          </div>
                        ))}
                      </div>
                      {editingIpKeyId === key.id && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <input style={{ ...S.input, flex: 1 }} placeholder="e.g. 13.235.10.50 (your server IP)" value={ipInput} onChange={e => setIpInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddIp(key.id)} />
                          <button style={{ ...S.btnPrimary, padding: '8px 16px' }} onClick={() => handleAddIp(key.id)}>Add IP</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {keys.filter(k => !k.active).length > 0 && (
            <div style={S.divider}>
              <h3 style={{ ...S.cardTitle, color: '#888' }}>Revoked</h3>
              {keys.filter(k => !k.active).map(key => (
                <div key={key.id} style={{ padding: '12px 16px', background: '#f5f5f5', border: '2px solid #ddd', borderRadius: 8, opacity: 0.6, marginBottom: 8 }}>
                  <strong style={{ textDecoration: 'line-through' }}>{key.name}</strong>
                  <code style={{ fontSize: 12, color: '#888', marginLeft: 12 }}>{key.apiKey.slice(0, 20)}...</code>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══ DOCUMENTATION ═══ */}
      {activeSection === 'docs' && (
        <>
          <div style={S.platformTabs}>
            {PLATFORMS.map(p => (
              <button key={p.id} style={S.platformTab(activePlatform === p.id, p.color)} onClick={() => { setActivePlatform(p.id); setExpandedEndpoint(null); }}>
                {p.label}
              </button>
            ))}
          </div>

          <div style={S.card}>
            <h3 style={S.cardTitle}>{docs.title}</h3>
            <p style={{ fontSize: 14, color: '#555', marginBottom: 16 }}>{docs.desc}</p>
            <div style={{ marginBottom: 16 }}>
              <div style={S.codeLabel}>How it works</div>
              <div style={S.codeBlock}>{docs.flow}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={S.codeLabel}>Base URL</div>
              <div style={{ ...S.keyDisplay, display: 'inline-block' }}>{docs.baseUrl}</div>
            </div>
            <div>
              <div style={S.codeLabel}>Authentication</div>
              <div style={S.codeBlock}>
                <button style={S.copyBtn} onClick={() => copyToClipboard(docs.auth)}>Copy</button>
                {docs.auth}
              </div>
            </div>
          </div>

          <div style={S.divider}>
            <h3 style={S.cardTitle}>Endpoints</h3>
            {docs.endpoints.map((ep, idx) => {
              const ek = `${activePlatform}-${idx}`;
              const open = expandedEndpoint === ek;
              return (
                <div key={ek} style={S.endpointCard}>
                  <div style={S.endpointHeader} onClick={() => setExpandedEndpoint(open ? null : ek)}>
                    <span style={S.methodBadge(ep.method)}>{ep.method}</span>
                    <code style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{ep.path}</code>
                    <strong style={{ fontSize: 14 }}>{ep.title}</strong>
                    <svg viewBox="0 0 24 24" width="18" height="18" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', flexShrink: 0 }}>
                      <path fill="#888" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                    </svg>
                  </div>
                  {open && (
                    <div style={{ padding: 18 }}>
                      <p style={{ fontSize: 14, color: '#555', marginBottom: 16 }}>{ep.desc}</p>
                      {ep.payload && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={S.codeLabel}>Request Payload</div>
                          <div style={S.codeBlock}>
                            <button style={S.copyBtn} onClick={() => copyToClipboard(ep.payload)}>Copy</button>
                            {ep.payload}
                          </div>
                        </div>
                      )}
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.codeLabel}>Response (real {activePlatform} response)</div>
                        <div style={S.codeBlock}>
                          <button style={S.copyBtn} onClick={() => copyToClipboard(ep.response)}>Copy</button>
                          {ep.response}
                        </div>
                      </div>
                      {ep.curl && (
                        <div>
                          <div style={S.codeLabel}>cURL</div>
                          <div style={S.codeBlock}>
                            <button style={S.copyBtn} onClick={() => copyToClipboard(ep.curl(firstActiveKey))}>Copy</button>
                            {ep.curl(firstActiveKey)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={S.divider}>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Quick Reference</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 900, marginBottom: 8, textTransform: 'uppercase' }}>What the gateway does automatically</h4>
                  <div style={{ fontSize: 13, lineHeight: 2.2 }}>
                    <div>Creates journal entries in your ledger</div>
                    <div>Tracks per-app payment volume</div>
                    <div>Logs every API call with IP & timestamp</div>
                    <div>Syncs payment status via webhooks</div>
                    <div>Updates accounting when payment is captured</div>
                  </div>
                </div>
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 900, marginBottom: 8, textTransform: 'uppercase' }}>Amount Format</h4>
                  <div style={{ fontSize: 13, lineHeight: 2 }}>
                    {activePlatform === 'razorpay' ? (
                      <>
                        <div>Amounts in <strong>paise</strong> (smallest unit)</div>
                        <div>Rs. 500 = <code style={{ fontWeight: 800 }}>50000</code></div>
                      </>
                    ) : (
                      <>
                        <div>Amounts in <strong>rupees</strong></div>
                        <div>Rs. 500 = <code style={{ fontWeight: 800 }}>500.00</code></div>
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 900, marginBottom: 8, textTransform: 'uppercase' }}>Error Codes</h4>
                  <div style={{ fontSize: 13, lineHeight: 2 }}>
                    <div><code style={{ fontWeight: 800, color: '#2e7d32' }}>200</code> — Success</div>
                    <div><code style={{ fontWeight: 800, color: '#ef5350' }}>401</code> — Invalid key/secret</div>
                    <div><code style={{ fontWeight: 800, color: '#ef5350' }}>403</code> — IP not whitelisted</div>
                    <div><code style={{ fontWeight: 800, color: '#f57c00' }}>400</code> — Bad payload (Razorpay/Cashfree rejected)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ TRANSACTIONS ═══ */}
      {activeSection === 'transactions' && (
        <div style={S.card}>
          <h3 style={S.cardTitle}>Payment Transactions</h3>
          {transactions.length === 0 ? (
            <div style={S.empty}>
              <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>No transactions yet</h3>
              <p>Transactions from your connected apps will appear here in real-time.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={S.th}>App</th>
                    <th style={S.th}>Type</th>
                    <th style={S.th}>Platform</th>
                    <th style={S.th}>Order / Link ID</th>
                    <th style={S.th}>Amount</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(txn => {
                    const amt = txn.platform === 'razorpay' ? (txn.amount || 0) / 100 : (txn.amount || 0);
                    const statusColor = (txn.status === 'paid' || txn.status === 'captured') ? '#2e7d32' : txn.status === 'created' ? '#f59e0b' : '#ef5350';
                    return (
                      <tr key={txn.id}>
                        <td style={S.td}><strong>{txn.appName}</strong></td>
                        <td style={S.td}>{txn.type}</td>
                        <td style={S.td}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', background: txn.platform === 'razorpay' ? '#dbeafe' : '#f3e8ff', color: txn.platform === 'razorpay' ? '#1e40af' : '#6b21a8' }}>
                            {txn.platform}
                          </span>
                        </td>
                        <td style={S.td}><code style={{ fontSize: 11 }}>{txn.orderId || txn.linkId || '-'}</code></td>
                        <td style={S.td}><strong>Rs. {amt.toLocaleString('en-IN')}</strong></td>
                        <td style={S.td}>
                          <span style={{ padding: '2px 10px', borderRadius: 4, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', background: statusColor + '20', color: statusColor, border: `2px solid ${statusColor}` }}>
                            {txn.status}
                          </span>
                        </td>
                        <td style={{ ...S.td, fontSize: 12 }}>
                          {new Date(txn.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ API LOGS ═══ */}
      {activeSection === 'logs' && (
        <div style={S.card}>
          <h3 style={S.cardTitle}>API Call Logs</h3>
          {logs.length === 0 ? (
            <div style={S.empty}><p>API calls will appear here once your apps start making requests.</p></div>
          ) : (
            <div className="table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={S.th}>Time</th>
                    <th style={S.th}>App</th>
                    <th style={S.th}>Method</th>
                    <th style={S.th}>Endpoint</th>
                    <th style={S.th}>Platform</th>
                    <th style={S.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td style={{ ...S.td, fontSize: 12 }}>
                        {new Date(log.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td style={S.td}><strong>{log.appName || '-'}</strong></td>
                      <td style={S.td}><span style={S.methodBadge(log.method)}>{log.method}</span></td>
                      <td style={S.td}><code style={{ fontSize: 11 }}>{log.endpoint}</code></td>
                      <td style={S.td}>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', background: log.platform === 'razorpay' ? '#dbeafe' : '#f3e8ff', color: log.platform === 'razorpay' ? '#1e40af' : '#6b21a8' }}>
                          {log.platform}
                        </span>
                      </td>
                      <td style={S.td}>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, background: log.status === 200 ? '#dcfce7' : '#fee2e2', color: log.status === 200 ? '#166534' : '#991b1b', border: `2px solid ${log.status === 200 ? '#166534' : '#991b1b'}` }}>
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {toast && <div style={S.toast(toast.type)}>{toast.message}</div>}
    </div>
  );
}
