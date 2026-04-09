import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

const formatINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n || 0);

const TYPE_COLORS = {
  Asset: '#2563eb',
  Liability: '#dc2626',
  Equity: '#7c3aed',
  Revenue: '#16a34a',
  Expense: '#ea580c',
};

const TYPE_BG = {
  Asset: '#eff6ff',
  Liability: '#fef2f2',
  Equity: '#f5f3ff',
  Revenue: '#f0fdf4',
  Expense: '#fff7ed',
};

export default function Accounting() {
  const [tab, setTab] = useState('trial-balance');

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 24, color: '#1a1a1a', margin: '0 0 20px' }}>Accounting</h2>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid #e5e7eb' }}>
        {[{ key: 'trial-balance', label: 'Trial Balance' }, { key: 'journal-entries', label: 'Journal Entries' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none',
            background: tab === t.key ? '#fff' : 'transparent',
            color: tab === t.key ? '#2e7d32' : '#64748b',
            borderBottom: tab === t.key ? '2px solid #2e7d32' : '2px solid transparent',
            marginBottom: -2, fontFamily: "'Poppins',sans-serif",
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'trial-balance' ? <TrialBalance /> : <JournalEntries />}
    </div>
  );
}

// ─── Trial Balance Tab ──────────────────────────────────────────────────────

function TrialBalance() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recalculating, setRecalculating] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const qs = params.toString();
      const data = await api.get(`/accounting/trial-balance${qs ? '?' + qs : ''}`);
      setAccounts(data.accounts || []);
    } catch (err) { setError(err.message || 'Failed to load trial balance'); }
    setLoading(false);
  }

  async function handleRecalculate() {
    setRecalculating(true); setError('');
    try {
      await api.post('/accounting/recalculate');
      await load();
    } catch (err) { setError(err.message || 'Recalculation failed'); }
    setRecalculating(false);
  }

  // Group accounts by type
  const grouped = {};
  const typeOrder = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];
  for (const acc of accounts) {
    const type = acc.type || 'Other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(acc);
  }

  const totalDebit = accounts.reduce((s, a) => s + (a.debit || 0), 0);
  const totalCredit = accounts.reduce((s, a) => s + (a.credit || 0), 0);

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
        <DateField label="Start Date" value={startDate} onChange={setStartDate} />
        <DateField label="End Date" value={endDate} onChange={setEndDate} />
        <button onClick={load} style={btnStyle('#2e7d32')}>Filter</button>
        <button onClick={handleRecalculate} disabled={recalculating} style={btnStyle('#6366f1')}>
          {recalculating ? 'Recalculating...' : 'Recalculate'}
        </button>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {loading ? <Loading text="Loading trial balance..." /> : accounts.length === 0 ? <Empty text="No trial balance data found." /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={thStyle}>Account Name</th>
                <th style={thStyle}>Account Type</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Debit</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Credit</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {typeOrder.map(type => {
                const group = grouped[type];
                if (!group || group.length === 0) return null;
                return (
                  <React.Fragment key={type}>
                    <tr>
                      <td colSpan={5} style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, color: TYPE_COLORS[type] || '#475569', background: TYPE_BG[type] || '#f9fafb', borderBottom: '1px solid #e5e7eb', letterSpacing: '0.5px' }}>
                        {type}s
                      </td>
                    </tr>
                    {group.map((acc, i) => (
                      <tr key={acc.id || acc.name + i} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                        <td style={tdStyle}>{acc.name}</td>
                        <td style={tdStyle}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: TYPE_COLORS[type] || '#475569', background: TYPE_BG[type] || '#f1f5f9' }}>{type}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{acc.debit ? formatINR(acc.debit) : '-'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{acc.credit ? formatINR(acc.credit) : '-'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{formatINR(acc.balance || 0)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {/* Other types not in typeOrder */}
              {Object.keys(grouped).filter(t => !typeOrder.includes(t)).map(type => (
                <React.Fragment key={type}>
                  <tr><td colSpan={5} style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, color: '#475569', background: '#f1f5f9', borderBottom: '1px solid #e5e7eb' }}>{type}</td></tr>
                  {grouped[type].map((acc, i) => (
                    <tr key={acc.id || acc.name + i} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                      <td style={tdStyle}>{acc.name}</td>
                      <td style={tdStyle}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#475569', background: '#f1f5f9' }}>{type}</span></td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{acc.debit ? formatINR(acc.debit) : '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{acc.credit ? formatINR(acc.credit) : '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{formatINR(acc.balance || 0)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {/* Totals row */}
              <tr style={{ background: '#1e293b' }}>
                <td colSpan={2} style={{ ...tdStyle, fontWeight: 800, color: '#fff', fontSize: 14 }}>TOTALS</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#fff', fontFamily: 'monospace', fontSize: 14 }}>{formatINR(totalDebit)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#fff', fontFamily: 'monospace', fontSize: 14 }}>{formatINR(totalCredit)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, fontFamily: 'monospace', fontSize: 14, color: Math.abs(totalDebit - totalCredit) < 0.01 ? '#4ade80' : '#f87171' }}>
                  {Math.abs(totalDebit - totalCredit) < 0.01 ? 'Balanced' : formatINR(totalDebit - totalCredit)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Journal Entries Tab ────────────────────────────────────────────────────

function JournalEntries() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [account, setAccount] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});

  useEffect(() => { load(1); }, []);

  async function load(page = 1) {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (account) params.set('account', account);
      const data = await api.get(`/accounting/journal-entries?${params.toString()}`);
      setEntries(data.data || []);
      setPagination(data.pagination || { page, limit: 50, total: 0, pages: 0 });
    } catch (err) { setError(err.message || 'Failed to load journal entries'); }
    setLoading(false);
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  // Client-side search filter
  const filtered = search.trim()
    ? entries.filter(e =>
        (e.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.reference || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.entryNumber || '').toString().toLowerCase().includes(search.toLowerCase())
      )
    : entries;

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
        <DateField label="Start Date" value={startDate} onChange={setStartDate} />
        <DateField label="End Date" value={endDate} onChange={setEndDate} />
        <div>
          <label style={labelStyle}>Account</label>
          <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Filter by account..." style={inputStyle} />
        </div>
        <button onClick={() => load(1)} style={btnStyle('#2e7d32')}>Filter</button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={labelStyle}>Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search description or reference..." style={{ ...inputStyle, width: '100%' }} />
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {loading ? <Loading text="Loading journal entries..." /> : filtered.length === 0 ? <Empty text="No journal entries found." /> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ ...thStyle, width: 40 }}></th>
                  <th style={thStyle}>Entry #</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Reference</th>
                  <th style={thStyle}>Source</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Debit</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, i) => {
                  const isOpen = expanded[entry.id];
                  const lines = entry.lines || [];
                  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
                  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
                  return (
                    <React.Fragment key={entry.id}>
                      <tr style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc', cursor: 'pointer' }} onClick={() => toggleExpand(entry.id)}>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 12, color: '#94a3b8', transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 600, color: '#1e293b' }}>{entry.entryNumber || entry.id?.substring(0, 8)}</td>
                        <td style={tdStyle}>{entry.date ? new Date(entry.date).toLocaleDateString('en-IN') : '-'}</td>
                        <td style={{ ...tdStyle, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.description || '-'}</td>
                        <td style={tdStyle}>{entry.reference || '-'}</td>
                        <td style={tdStyle}>
                          {entry.source ? <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#6366f1', background: '#eef2ff' }}>{entry.source}</span> : '-'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{formatINR(totalDebit)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{formatINR(totalCredit)}</td>
                      </tr>
                      {isOpen && lines.length > 0 && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0, background: '#f8fafc' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', margin: '0' }}>
                              <thead>
                                <tr style={{ background: '#eef2ff' }}>
                                  <th style={{ ...thStyle, fontSize: 11, padding: '6px 14px', paddingLeft: 50 }}>Account</th>
                                  <th style={{ ...thStyle, fontSize: 11, padding: '6px 14px' }}>Narration</th>
                                  <th style={{ ...thStyle, fontSize: 11, padding: '6px 14px', textAlign: 'right' }}>Debit</th>
                                  <th style={{ ...thStyle, fontSize: 11, padding: '6px 14px', textAlign: 'right' }}>Credit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((line, li) => (
                                  <tr key={li} style={{ background: li % 2 === 0 ? '#f8fafc' : '#fff' }}>
                                    <td style={{ ...tdStyle, fontSize: 12, paddingLeft: 50 }}>{line.account || '-'}</td>
                                    <td style={{ ...tdStyle, fontSize: 12, color: '#64748b' }}>{line.narration || line.description || '-'}</td>
                                    <td style={{ ...tdStyle, fontSize: 12, textAlign: 'right', fontFamily: 'monospace', color: line.debit ? '#2563eb' : '#ccc' }}>{line.debit ? formatINR(line.debit) : '-'}</td>
                                    <td style={{ ...tdStyle, fontSize: 12, textAlign: 'right', fontFamily: 'monospace', color: line.credit ? '#dc2626' : '#ccc' }}>{line.credit ? formatINR(line.credit) : '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 20 }}>
              <button disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)} style={pageBtnStyle(pagination.page <= 1)}>Previous</button>
              <span style={{ fontSize: 13, color: '#475569' }}>Page {pagination.page} of {pagination.pages} ({pagination.total} entries)</span>
              <button disabled={pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)} style={pageBtnStyle(pagination.page >= pagination.pages)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Shared Components & Styles ─────────────────────────────────────────────

function DateField({ label, value, onChange }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type="date" value={value} onChange={e => onChange(e.target.value)} style={inputStyle} />
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

function pageBtnStyle(disabled) {
  return { padding: '6px 16px', background: disabled ? '#e5e7eb' : '#2e7d32', color: disabled ? '#94a3b8' : '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' };
}
