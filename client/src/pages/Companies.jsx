import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', legalName: '', legalLine: '', tagline: '', gstin: '', cin: '', pan: '', address: '', phone: '', email: '', website: '', state: '', stateCode: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setCompanies(await api.get('/companies')); } catch { setError('Failed to load'); }
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Company name is required');
    setSaving(true); setError('');
    try {
      const res = await api.post('/companies', form);
      setCompanies(prev => [res, ...prev]);
      setShowCreate(false);
      setForm({ name: '', legalName: '', legalLine: '', tagline: '', gstin: '', cin: '', pan: '', address: '', phone: '', email: '', website: '', state: '', stateCode: '' });
    } catch (err) { setError(err.message || 'Failed to create'); }
    setSaving(false);
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try { await api.delete(`/companies/${id}`); setCompanies(prev => prev.filter(c => c.id !== id)); } catch { setError('Failed to delete'); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading companies...</div>;

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 24, color: '#1a1a1a', margin: 0 }}>Companies</h2>
        {isSuperadmin && (
          <button onClick={() => setShowCreate(!showCreate)} style={{ padding: '8px 20px', background: showCreate ? '#64748b' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {showCreate ? 'Cancel' : '+ New Company'}
          </button>
        )}
      </div>

      {error && <div style={{ padding: '8px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>Create New Company</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Company Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
            <Field label="Legal Name" value={form.legalName} onChange={v => setForm(f => ({ ...f, legalName: v }))} placeholder="e.g. XYZ Private Limited" />
            <Field label="Legal Line" value={form.legalLine} onChange={v => setForm(f => ({ ...f, legalLine: v }))} placeholder="e.g. A Brand of XYZ Pvt Ltd" />
            <Field label="Tagline" value={form.tagline} onChange={v => setForm(f => ({ ...f, tagline: v }))} placeholder="e.g. Chartered Accountants" />
            <Field label="GSTIN" value={form.gstin} onChange={v => setForm(f => ({ ...f, gstin: v }))} />
            <Field label="CIN" value={form.cin} onChange={v => setForm(f => ({ ...f, cin: v }))} />
            <Field label="PAN" value={form.pan} onChange={v => setForm(f => ({ ...f, pan: v }))} />
            <Field label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} />
            <Field label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} />
            <Field label="Website" value={form.website} onChange={v => setForm(f => ({ ...f, website: v }))} />
            <Field label="State" value={form.state} onChange={v => setForm(f => ({ ...f, state: v }))} />
            <Field label="State Code" value={form.stateCode} onChange={v => setForm(f => ({ ...f, stateCode: v }))} />
          </div>
          <Field label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} full />
          <button type="submit" disabled={saving} style={{ marginTop: 16, padding: '10px 28px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Creating...' : 'Create Company'}
          </button>
        </form>
      )}

      {/* Company cards */}
      {companies.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          No companies yet. {isSuperadmin ? 'Click "+ New Company" to create one.' : ''}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {companies.map(c => (
            <div key={c.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onClick={() => navigate(`/companies/${c.id}`)}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
              <div style={{ padding: '16px 20px', borderBottom: '3px solid #2e7d32' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#1a1a1a', letterSpacing: '-0.3px', marginBottom: 2 }}>{c.name}</div>
                {c.legalName && <div style={{ fontSize: 11, color: '#64748b' }}>{c.legalLine || `A Brand of ${c.legalName}`}</div>}
                {c.tagline && <div style={{ fontSize: 11, color: '#2e7d32', fontWeight: 600, marginTop: 2 }}>{c.tagline}</div>}
              </div>
              <div style={{ padding: '12px 20px', fontSize: 11, color: '#475569', lineHeight: 1.8 }}>
                {c.gstin && <div>GSTIN: {c.gstin}</div>}
                {c.email && <div>{c.email}</div>}
                {c.phone && <div>{c.phone}</div>}
              </div>
              <div style={{ padding: '8px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>Created {new Date(c.createdAt).toLocaleDateString()}</span>
                {isSuperadmin && (
                  <button onClick={e => { e.stopPropagation(); handleDelete(c.id, c.name); }} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, full }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined, marginBottom: 4 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
    </div>
  );
}
