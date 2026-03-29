import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const ACTION_COLORS = {
  login_success:    { bg: '#e8f5e9', color: '#2e7d32' },
  otp_sent_sms:     { bg: '#e3f2fd', color: '#1565c0' },
  otp_sent_email:   { bg: '#e3f2fd', color: '#1565c0' },
  otp_verify_failed:{ bg: '#ffebee', color: '#c62828' },
  otp_rate_limited: { bg: '#fff3e0', color: '#e65100' },
  user_created:     { bg: '#e8f5e9', color: '#2e7d32' },
  user_deactivated: { bg: '#ffebee', color: '#c62828' },
};

function getActionStyle(action) {
  if (!action) return { bg: '#f5f5f5', color: '#888' };
  // Exact match first
  if (ACTION_COLORS[action]) return ACTION_COLORS[action];
  // Partial match for otp_sent_*
  if (action.startsWith('otp_sent')) return { bg: '#e3f2fd', color: '#1565c0' };
  if (action.includes('fail') || action.includes('deactivat')) return { bg: '#ffebee', color: '#c62828' };
  if (action.includes('success') || action.includes('created')) return { bg: '#e8f5e9', color: '#2e7d32' };
  if (action.includes('limit') || action.includes('warn')) return { bg: '#fff3e0', color: '#e65100' };
  return { bg: '#f5f5f5', color: '#444' };
}

export default function AuthLogs() {
  const { isSuperadmin } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const abortControllerRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    setError('');
    try {
      const data = await api.get('/auth/logs');
      setLogs(Array.isArray(data) ? data : data.logs || []);
    } catch (err) {
      setError(err.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  function formatTimestamp(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  if (!isSuperadmin) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 60 }}>
        <h3 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 20, marginBottom: 8 }}>
          Access Denied
        </h3>
        <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
          Only superadmins can view authentication logs.
        </p>
      </div>
    );
  }

  const filtered = logs.filter(log => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (log.identifier || '').toLowerCase().includes(q) ||
      (log.action || '').toLowerCase().includes(q) ||
      (log.userId || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="page-auth-logs">
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="stat-label">Total Logs</div>
          <div className="stat-value">{logs.length}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Successful Logins</div>
          <div className="stat-value" style={{ color: '#2e7d32' }}>
            {logs.filter(l => l.action === 'login_success').length}
          </div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">Failed Attempts</div>
          <div className="stat-value" style={{ color: '#c62828' }}>
            {logs.filter(l => l.action === 'otp_verify_failed').length}
          </div>
        </div>
        <div className="stat-card" style={{ '--accent': '#e65100' }}>
          <div className="stat-label">Rate Limited</div>
          <div className="stat-value" style={{ color: '#e65100' }}>
            {logs.filter(l => l.action === 'otp_rate_limited').length}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search by identifier, action, user ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 240 }}
        />
        <div className="spacer" />
        <button
          className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setAutoRefresh(prev => !prev)}
          title={autoRefresh ? 'Auto-refresh ON (10s)' : 'Enable auto-refresh'}
        >
          {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
        </button>
        <button className="btn btn-sm btn-secondary" onClick={() => { setLoading(true); fetchLogs(); }}>
          Refresh Now
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card" style={{ marginBottom: 20, padding: '14px 20px', borderLeftColor: 'var(--red)', borderLeftWidth: 6 }}>
          <span style={{ fontWeight: 800, color: 'var(--red)' }}>{error}</span>
        </div>
      )}

      {/* Showing count */}
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12 }}>
        Showing {filtered.length} of {logs.length} log entries
        {autoRefresh && <span style={{ marginLeft: 8, color: 'var(--green)' }}> -- Live</span>}
      </p>

      {/* Logs Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Identifier</th>
              <th>User ID</th>
              <th>Role</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  Loading logs...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {logs.length === 0 ? 'No log entries found.' : 'No logs match your search.'}
                </td>
              </tr>
            ) : (
              filtered.map((log, idx) => {
                const as = getActionStyle(log.action);
                return (
                  <tr key={log._id || log.id || idx}>
                    <td style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {formatTimestamp(log.timestamp || log.createdAt)}
                    </td>
                    <td>
                      <span
                        className="status-badge"
                        style={{
                          background: as.bg,
                          color: as.color,
                          borderColor: as.color,
                        }}
                      >
                        {(log.action || '--').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, fontFamily: "'Inter', monospace", fontSize: 13 }}>
                      {log.identifier || '--'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {log.userId || '--'}
                    </td>
                    <td>
                      {log.role ? (
                        <span style={{
                          fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
                          color: log.role === 'superadmin' ? '#c62828' :
                                 log.role === 'admin' ? '#1565c0' :
                                 log.role === 'employee' ? '#2e7d32' :
                                 log.role === 'client' ? '#e65100' : '#444'
                        }}>
                          {log.role}
                        </span>
                      ) : '--'}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.reason || log.details || log.userAgent || '--'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
