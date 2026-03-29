import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const ROLE_COLORS = {
  superadmin: { bg: '#ffebee', color: '#c62828', border: '#c62828' },
  admin:      { bg: '#e3f2fd', color: '#1565c0', border: '#1565c0' },
  employee:   { bg: '#e8f5e9', color: '#2e7d32', border: '#2e7d32' },
  client:     { bg: '#fff3e0', color: '#e65100', border: '#e65100' },
};

const TABS = ['all', 'admin', 'employee', 'client'];

const EMPTY_USER = { name: '', phone: '', email: '', role: 'client' };
const EMPTY_SHARE = { type: 'product_link', title: '', data: '' };

export default function Users() {
  const { user: currentUser, isSuperadmin, isAdmin } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');

  // Add user form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_USER });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Share content form
  const [sharingClientId, setSharingClientId] = useState(null);
  const [shareForm, setShareForm] = useState({ ...EMPTY_SHARE });
  const [sharingLoading, setSharingLoading] = useState(false);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function fetchUsers() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/auth/users');
      setUsers(Array.isArray(data) ? data : data.users || []);
    } catch (err) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function handleEdit(u) {
    setEditingId(u._id || u.id);
    setForm({
      name: u.name || '',
      phone: u.phone || '',
      email: u.email || '',
      role: u.role || 'client',
    });
    setShowForm(true);
    setFormError('');
  }

  function handleCancel() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_USER });
    setFormError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    if (!form.phone.trim() && !form.email.trim()) { setFormError('Phone or email is required'); return; }

    setSaving(true);
    setFormError('');
    try {
      if (editingId) {
        await api.put(`/auth/users/${editingId}`, {
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          role: form.role,
        });
      } else {
        await api.post('/auth/users', {
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          role: form.role,
        });
      }
      handleCancel();
      await fetchUsers();
    } catch (err) {
      setFormError(err.message || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(u) {
    const userId = u._id || u.id;
    if (!window.confirm(`Deactivate user "${u.name}"? They will no longer be able to log in.`)) return;
    try {
      await api.delete(`/auth/users/${userId}`);
      await fetchUsers();
    } catch (err) {
      alert(err.message || 'Failed to deactivate user');
    }
  }

  // Share content
  function handleShareOpen(clientId) {
    setSharingClientId(clientId);
    setShareForm({ ...EMPTY_SHARE });
  }

  function handleShareClose() {
    setSharingClientId(null);
    setShareForm({ ...EMPTY_SHARE });
  }

  async function handleShareSubmit(e) {
    e.preventDefault();
    if (!shareForm.title.trim() || !shareForm.data.trim()) return;

    setSharingLoading(true);
    try {
      await api.post('/auth/client-shares', {
        clientId: sharingClientId,
        type: shareForm.type,
        title: shareForm.title.trim(),
        data: shareForm.data.trim(),
      });
      handleShareClose();
    } catch (err) {
      alert(err.message || 'Failed to share content');
    } finally {
      setSharingLoading(false);
    }
  }

  // Filtering
  const filtered = users.filter(u => {
    const matchesTab = activeTab === 'all' || u.role === activeTab;
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      (u.name || '').toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  });

  // Counts
  const counts = {
    all: users.length,
    admin: users.filter(u => u.role === 'admin').length,
    employee: users.filter(u => u.role === 'employee').length,
    client: users.filter(u => u.role === 'client').length,
  };

  // Role options based on current user
  function getRoleOptions() {
    if (isSuperadmin) return ['admin', 'employee', 'client'];
    if (isAdmin) return ['client'];
    return ['client'];
  }

  function formatLastLogin(dateStr) {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Never';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="page-users">
      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="stat-label">Total Users</div>
          <div className="stat-value">{counts.all}</div>
        </div>
        <div className="stat-card" style={{ '--accent': '#1565c0' }}>
          <div className="stat-label">Admins</div>
          <div className="stat-value" style={{ color: '#1565c0' }}>{counts.admin}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Employees</div>
          <div className="stat-value" style={{ color: '#2e7d32' }}>{counts.employee}</div>
        </div>
        <div className="stat-card" style={{ '--accent': '#e65100' }}>
          <div className="stat-label">Clients</div>
          <div className="stat-value" style={{ color: '#e65100' }}>{counts.client}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t}
            className={`tab ${activeTab === t ? 'active' : ''}`}
            onClick={() => setActiveTab(t)}
          >
            {t === 'all' ? 'All Users' : t === 'admin' ? 'Admins' : t === 'employee' ? 'Employees' : 'Clients'}
            <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>({counts[t]})</span>
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search by name, phone, email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => { handleCancel(); setShowForm(true); }}>
          + Add User
        </button>
        <button className="btn btn-secondary" onClick={fetchUsers}>
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card" style={{ marginBottom: 20, padding: '14px 20px', borderLeftColor: 'var(--red)', borderLeftWidth: 6 }}>
          <span style={{ fontWeight: 800, color: 'var(--red)' }}>{error}</span>
        </div>
      )}

      {/* Add / Edit User Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3 className="card-title">{editingId ? 'Edit User' : 'Add New User'}</h3>
            <button className="btn btn-sm btn-secondary" onClick={handleCancel}>Cancel</button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Full Name *</label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  required
                  placeholder="User's full name"
                />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={handleFormChange}
                  placeholder="+91 XXXXX XXXXX"
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleFormChange}
                  placeholder="user@example.com"
                />
              </div>
              <div className="form-group">
                <label>Role *</label>
                <select name="role" value={form.role} onChange={handleFormChange}>
                  {getRoleOptions().map(r => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            {formError && (
              <p style={{ color: 'var(--red)', fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{formError}</p>
            )}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update User' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  Loading users...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {users.length === 0 ? 'No users found. Add your first user above.' : 'No users match your search.'}
                </td>
              </tr>
            ) : (
              filtered.map(u => {
                const userId = u._id || u.id;
                const rc = ROLE_COLORS[u.role] || ROLE_COLORS.client;
                return (
                  <React.Fragment key={userId}>
                    <tr>
                      <td style={{ fontWeight: 700 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: 8,
                            background: rc.bg, color: rc.color,
                            border: `2px solid ${rc.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 900, fontSize: 14, flexShrink: 0,
                          }}>
                            {(u.name || '?')[0].toUpperCase()}
                          </div>
                          {u.name || '--'}
                        </div>
                      </td>
                      <td>{u.phone || '--'}</td>
                      <td>{u.email || '--'}</td>
                      <td>
                        <span
                          className="status-badge"
                          style={{
                            color: rc.color,
                            background: rc.bg,
                            borderColor: rc.color,
                          }}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <span
                          className="status-badge"
                          style={{
                            color: u.isActive === false ? 'var(--red)' : 'var(--green)',
                            background: u.isActive === false ? '#ffebee' : '#e8f5e9',
                            borderColor: u.isActive === false ? 'var(--red)' : 'var(--green)',
                          }}
                        >
                          {u.isActive === false ? 'Inactive' : 'Active'}
                        </span>
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {formatLastLogin(u.lastLogin)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {(isSuperadmin || isAdmin) && (
                            <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(u)}>
                              Edit
                            </button>
                          )}
                          {u.role === 'client' && (isSuperadmin || isAdmin) && (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => handleShareOpen(userId)}
                            >
                              Share
                            </button>
                          )}
                          {isSuperadmin && u.role !== 'superadmin' && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleDeactivate(u)}>
                              Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Inline Share Form */}
                    {sharingClientId === userId && (
                      <tr>
                        <td colSpan="7" style={{ background: '#f0faf0', padding: 20 }}>
                          <form onSubmit={handleShareSubmit} style={{ maxWidth: 700 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                              <span style={{ fontWeight: 900, fontSize: 15 }}>
                                Share Content with {u.name}
                              </span>
                              <button type="button" className="btn btn-sm btn-secondary" onClick={handleShareClose}>
                                Cancel
                              </button>
                            </div>
                            <div className="form-row">
                              <div className="form-group">
                                <label>Type</label>
                                <select
                                  value={shareForm.type}
                                  onChange={e => setShareForm(p => ({ ...p, type: e.target.value }))}
                                >
                                  <option value="product_link">Product Link</option>
                                  <option value="bill">Bill</option>
                                  <option value="document">Document</option>
                                  <option value="invoice">Invoice</option>
                                </select>
                              </div>
                              <div className="form-group">
                                <label>Title *</label>
                                <input
                                  type="text"
                                  value={shareForm.title}
                                  onChange={e => setShareForm(p => ({ ...p, title: e.target.value }))}
                                  required
                                  placeholder="e.g. Marble Sample #42"
                                />
                              </div>
                              <div className="form-group">
                                <label>Data (URL or text) *</label>
                                <input
                                  type="text"
                                  value={shareForm.data}
                                  onChange={e => setShareForm(p => ({ ...p, data: e.target.value }))}
                                  required
                                  placeholder="https://... or details"
                                />
                              </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <button type="submit" className="btn btn-primary btn-sm" disabled={sharingLoading}>
                                {sharingLoading ? 'Sharing...' : 'Share'}
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
