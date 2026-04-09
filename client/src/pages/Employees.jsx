import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../utils/api';

const TABS = ['Employees', 'Attendance', 'Payroll'];
const DEPARTMENTS = ['Engineering', 'Design', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Support', 'Legal', 'Admin'];
const ATTENDANCE_STATUSES = ['present', 'absent', 'leave', 'half-day'];
const PAYROLL_STATUSES = ['pending', 'approved', 'Paid'];

const STATUS_COLORS = {
  present: { bg: '#dcfce7', color: '#166534', border: '#bbf7d0' },
  absent: { bg: '#fef2f2', color: '#991b1b', border: '#fecaca' },
  leave: { bg: '#fefce8', color: '#854d0e', border: '#fef08a' },
  'half-day': { bg: '#fff7ed', color: '#9a3412', border: '#fed7aa' },
};

const PAYROLL_STATUS_COLORS = {
  pending: { bg: '#fefce8', color: '#854d0e', border: '#fef08a' },
  approved: { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
  Paid: { bg: '#dcfce7', color: '#166534', border: '#bbf7d0' },
};

function formatINR(num) {
  if (num == null || isNaN(num)) return '0.00';
  return Number(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// ─── Shared UI Components ────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, full, type = 'text', options, required, disabled }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined, marginBottom: 4 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
        {label}{required && ' *'}
      </label>
      {options ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', background: disabled ? '#f1f5f9' : '#fff' }}
        >
          <option value="">Select...</option>
          {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ''}
          required={required}
          disabled={disabled}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: disabled ? '#f1f5f9' : '#fff' }}
        />
      )}
    </div>
  );
}

function Badge({ text, color, bg, border }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: bg, border: `1px solid ${border}`, textTransform: 'capitalize' }}>
      {text}
    </span>
  );
}

function Pagination({ pagination, onPageChange }) {
  if (!pagination || pagination.pages <= 1) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
      <button
        onClick={() => onPageChange(pagination.page - 1)}
        disabled={pagination.page <= 1}
        style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: pagination.page <= 1 ? 'default' : 'pointer', background: '#fff', color: pagination.page <= 1 ? '#94a3b8' : '#1a1a1a' }}
      >
        Previous
      </button>
      <span style={{ fontSize: 12, color: '#64748b' }}>
        Page {pagination.page} of {pagination.pages} ({pagination.total} total)
      </span>
      <button
        onClick={() => onPageChange(pagination.page + 1)}
        disabled={pagination.page >= pagination.pages}
        style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: pagination.page >= pagination.pages ? 'default' : 'pointer', background: '#fff', color: pagination.page >= pagination.pages ? '#94a3b8' : '#1a1a1a' }}
      >
        Next
      </button>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14 }}>
      {message}
    </div>
  );
}

function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div style={{ padding: '8px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 12, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{error}</span>
      {onDismiss && <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 700, fontSize: 16 }}>&times;</button>}
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px 20px', flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#1a1a1a', fontFamily: "'Playfair Display',serif" }}>{value}</div>
    </div>
  );
}

// ─── Tab 1: Employee List ────────────────────────────────────────────────────

function EmployeesTab({ employees, setEmployees, loadEmployees, pagination, onPageChange }) {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', department: '', designation: '', phone: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Debounced search
  const [searchTimer, setSearchTimer] = useState(null);
  function handleSearchChange(val) {
    setSearch(val);
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(setTimeout(() => loadEmployees(1, val, deptFilter), 400));
  }

  function handleDeptChange(val) {
    setDeptFilter(val);
    loadEmployees(1, search, val);
  }

  function resetForm() {
    setForm({ name: '', email: '', department: '', designation: '', phone: '', address: '' });
    setShowForm(false);
    setEditId(null);
    setError('');
  }

  function startEdit(emp) {
    setEditId(emp.id);
    setForm({ name: emp.name || '', email: emp.email || '', department: emp.department || '', designation: emp.designation || '', phone: emp.phone || '', address: emp.address || '' });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Employee name is required');
    setSaving(true);
    setError('');
    try {
      if (editId) {
        await api.put(`/employees/${editId}`, form);
        setEmployees(prev => prev.map(emp => emp.id === editId ? { ...emp, ...form, updatedAt: new Date().toISOString() } : emp));
      } else {
        const res = await api.post('/employees', form);
        setEmployees(prev => [res, ...prev]);
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save employee');
    }
    setSaving(false);
  }

  async function handleDelete(emp) {
    if (!confirm(`Deactivate "${emp.name}"? They will be marked as inactive.`)) return;
    try {
      await api.delete(`/employees/${emp.id}`);
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, status: 'inactive' } : e));
    } catch {
      setError('Failed to deactivate employee');
    }
  }

  async function handleReactivate(emp) {
    try {
      await api.put(`/employees/${emp.id}`, { status: 'active' });
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, status: 'active' } : e));
    } catch {
      setError('Failed to reactivate employee');
    }
  }

  return (
    <div>
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {/* Search and filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
        />
        <select
          value={deptFilter}
          onChange={e => handleDeptChange(e.target.value)}
          style={{ padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', background: '#fff', minWidth: 150 }}
        >
          <option value="">All Departments</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button
          onClick={() => { if (showForm && !editId) { resetForm(); } else { resetForm(); setShowForm(true); } }}
          style={{ padding: '8px 20px', background: showForm && !editId ? '#64748b' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {showForm && !editId ? 'Cancel' : '+ Add Employee'}
        </button>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>
            {editId ? 'Edit Employee' : 'Add New Employee'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} required />
            <Field label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" />
            <Field label="Department" value={form.department} onChange={v => setForm(f => ({ ...f, department: v }))} options={DEPARTMENTS} />
            <Field label="Designation" value={form.designation} onChange={v => setForm(f => ({ ...f, designation: v }))} placeholder="e.g. Software Engineer" />
            <Field label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} />
            <Field label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="submit" disabled={saving} style={{ padding: '10px 28px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving...' : editId ? 'Update Employee' : 'Add Employee'}
            </button>
            {editId && (
              <button type="button" onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {/* Table */}
      {employees.length === 0 ? (
        <EmptyState message="No employees found. Click '+ Add Employee' to create one." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Name', 'Email', 'Department', 'Designation', 'Phone', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id} style={{ borderBottom: '1px solid #e5e7eb' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1a1a1a' }}>{emp.name}</td>
                  <td style={{ padding: '10px 12px', color: '#475569' }}>{emp.email || '-'}</td>
                  <td style={{ padding: '10px 12px', color: '#475569' }}>{emp.department || '-'}</td>
                  <td style={{ padding: '10px 12px', color: '#475569' }}>{emp.designation || '-'}</td>
                  <td style={{ padding: '10px 12px', color: '#475569' }}>{emp.phone || '-'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <Badge
                      text={emp.status || 'active'}
                      color={emp.status === 'inactive' ? '#64748b' : '#166534'}
                      bg={emp.status === 'inactive' ? '#f1f5f9' : '#dcfce7'}
                      border={emp.status === 'inactive' ? '#cbd5e1' : '#bbf7d0'}
                    />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => startEdit(emp)} style={{ padding: '4px 10px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Edit</button>
                      {emp.status === 'inactive' ? (
                        <button onClick={() => handleReactivate(emp)} style={{ padding: '4px 10px', background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Activate</button>
                      ) : (
                        <button onClick={() => handleDelete(emp)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Deactivate</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination pagination={pagination} onPageChange={onPageChange} />
    </div>
  );
}

// ─── Tab 2: Attendance ───────────────────────────────────────────────────────

function AttendanceTab({ employees }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(getCurrentMonth());
  const [filterEmployee, setFilterEmployee] = useState('');
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);

  // Mark attendance form
  const [form, setForm] = useState({ employeeId: '', date: getTodayDate(), status: 'present', checkIn: '09:00', checkOut: '18:00', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadRecords = useCallback(async (p = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: p, limit: 50 });
      if (month) params.set('month', month);
      if (filterEmployee) params.set('employeeId', filterEmployee);
      const res = await api.get(`/employees/attendance/records?${params}`);
      setRecords(res.data || []);
      setPagination(res.pagination || null);
    } catch (err) {
      setError(err.message || 'Failed to load attendance records');
    }
    setLoading(false);
  }, [month, filterEmployee]);

  useEffect(() => { loadRecords(1); }, [loadRecords]);

  const employeeMap = useMemo(() => {
    const map = {};
    employees.forEach(e => { map[e.id] = e.name; });
    return map;
  }, [employees]);

  async function handleMarkAttendance(e) {
    e.preventDefault();
    if (!form.employeeId) return setError('Please select an employee');
    if (!form.date) return setError('Please select a date');
    setSaving(true);
    setError('');
    try {
      await api.post('/employees/attendance', {
        employeeId: form.employeeId,
        date: form.date,
        status: form.status,
        checkIn: form.checkIn || null,
        checkOut: form.checkOut || null,
        notes: form.notes,
      });
      setShowForm(false);
      setForm({ employeeId: '', date: getTodayDate(), status: 'present', checkIn: '09:00', checkOut: '18:00', notes: '' });
      loadRecords(page);
    } catch (err) {
      setError(err.message || 'Failed to mark attendance');
    }
    setSaving(false);
  }

  const activeEmployees = employees.filter(e => e.status !== 'inactive');

  return (
    <div>
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Employee</label>
          <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', background: '#fff', minWidth: 180 }}>
            <option value="">All Employees</option>
            {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div style={{ marginTop: 'auto' }}>
          <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 20px', background: showForm ? '#64748b' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {showForm ? 'Cancel' : '+ Mark Attendance'}
          </button>
        </div>
      </div>

      {/* Mark attendance form */}
      {showForm && (
        <form onSubmit={handleMarkAttendance} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>Mark Attendance</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field
              label="Employee"
              value={form.employeeId}
              onChange={v => setForm(f => ({ ...f, employeeId: v }))}
              options={activeEmployees.map(e => ({ value: e.id, label: e.name }))}
              required
            />
            <Field label="Date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} type="date" required />
            <Field
              label="Status"
              value={form.status}
              onChange={v => setForm(f => ({ ...f, status: v }))}
              options={ATTENDANCE_STATUSES}
              required
            />
            <Field label="Check In" value={form.checkIn} onChange={v => setForm(f => ({ ...f, checkIn: v }))} type="time" />
            <Field label="Check Out" value={form.checkOut} onChange={v => setForm(f => ({ ...f, checkOut: v }))} type="time" />
            <Field label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Optional notes" />
          </div>
          <button type="submit" disabled={saving} style={{ marginTop: 16, padding: '10px 28px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Saving...' : 'Save Attendance'}
          </button>
        </form>
      )}

      {/* Records table */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading attendance records...</div>
      ) : records.length === 0 ? (
        <EmptyState message="No attendance records found for this period." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Date', 'Employee', 'Status', 'Check In', 'Check Out', 'Notes'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(rec => {
                const sc = STATUS_COLORS[rec.status] || STATUS_COLORS.present;
                return (
                  <tr key={rec.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1a1a1a' }}>{rec.date}</td>
                    <td style={{ padding: '10px 12px', color: '#475569' }}>{employeeMap[rec.employeeId] || rec.employeeId}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge text={rec.status} color={sc.color} bg={sc.bg} border={sc.border} />
                    </td>
                    <td style={{ padding: '10px 12px', color: '#475569' }}>{rec.checkIn || '-'}</td>
                    <td style={{ padding: '10px 12px', color: '#475569' }}>{rec.checkOut || '-'}</td>
                    <td style={{ padding: '10px 12px', color: '#475569' }}>{rec.notes || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination pagination={pagination} onPageChange={p => { setPage(p); loadRecords(p); }} />
    </div>
  );
}

// ─── Tab 3: Payroll ──────────────────────────────────────────────────────────

function PayrollTab({ employees }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(getCurrentMonth());
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);

  // Create payroll form
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employeeId: '', month: getCurrentMonth(),
    basic: '', hra: '', da: '', other: '',
    pf: '', pt: '', tds: '',
  });

  const loadRecords = useCallback(async (p = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: p, limit: 50 });
      if (month) params.set('month', month);
      const res = await api.get(`/employees/payroll/records?${params}`);
      setRecords(res.data || []);
      setPagination(res.pagination || null);
    } catch (err) {
      setError(err.message || 'Failed to load payroll records');
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { loadRecords(1); }, [loadRecords]);

  const employeeMap = useMemo(() => {
    const map = {};
    employees.forEach(e => { map[e.id] = e.name; });
    return map;
  }, [employees]);

  // Auto-calculate
  const basicNum = parseFloat(form.basic) || 0;
  const hraNum = parseFloat(form.hra) || 0;
  const daNum = parseFloat(form.da) || 0;
  const otherNum = parseFloat(form.other) || 0;
  const pfNum = parseFloat(form.pf) || 0;
  const ptNum = parseFloat(form.pt) || 0;
  const tdsNum = parseFloat(form.tds) || 0;
  const grossSalary = basicNum + hraNum + daNum + otherNum;
  const totalDeductions = pfNum + ptNum + tdsNum;
  const netSalary = Math.max(0, grossSalary - totalDeductions);

  // Summary cards
  const summary = useMemo(() => {
    let totalProcessed = 0, pendingAmount = 0, paidAmount = 0;
    records.forEach(r => {
      totalProcessed += r.netSalary || 0;
      if (r.status === 'pending' || r.status === 'approved') pendingAmount += r.netSalary || 0;
      if (r.status === 'Paid') paidAmount += r.netSalary || 0;
    });
    return { totalProcessed, pendingAmount, paidAmount };
  }, [records]);

  async function handleCreatePayroll(e) {
    e.preventDefault();
    if (!form.employeeId) return setError('Please select an employee');
    if (basicNum <= 0) return setError('Basic salary must be greater than 0');
    setSaving(true);
    setError('');
    try {
      const payload = {
        employeeId: form.employeeId,
        month: form.month,
        basic: basicNum,
        hra: hraNum,
        da: daNum,
        other: otherNum,
        deductions: { pf: pfNum, professionalTax: ptNum, tds: tdsNum },
      };
      const res = await api.post('/employees/payroll', payload);
      setRecords(prev => [res, ...prev]);
      setShowForm(false);
      setForm({ employeeId: '', month: getCurrentMonth(), basic: '', hra: '', da: '', other: '', pf: '', pt: '', tds: '' });
    } catch (err) {
      setError(err.message || 'Failed to create payroll');
    }
    setSaving(false);
  }

  async function handleStatusChange(id, newStatus) {
    try {
      await api.patch(`/employees/payroll/${id}/status`, { status: newStatus });
      setRecords(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r));
    } catch (err) {
      setError(err.message || 'Failed to update status');
    }
  }

  const activeEmployees = employees.filter(e => e.status !== 'inactive');

  return (
    <div>
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <SummaryCard label="Total Processed" value={`INR ${formatINR(summary.totalProcessed)}`} />
        <SummaryCard label="Pending / Approved" value={`INR ${formatINR(summary.pendingAmount)}`} color="#854d0e" />
        <SummaryCard label="Paid" value={`INR ${formatINR(summary.paidAmount)}`} color="#166534" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
        </div>
        <div style={{ marginTop: 'auto' }}>
          <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 20px', background: showForm ? '#64748b' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {showForm ? 'Cancel' : '+ Create Payroll'}
          </button>
        </div>
      </div>

      {/* Create payroll form */}
      {showForm && (
        <form onSubmit={handleCreatePayroll} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>Create Payroll</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field
              label="Employee"
              value={form.employeeId}
              onChange={v => setForm(f => ({ ...f, employeeId: v }))}
              options={activeEmployees.map(e => ({ value: e.id, label: e.name }))}
              required
            />
            <Field label="Month" value={form.month} onChange={v => setForm(f => ({ ...f, month: v }))} type="month" required />
            <div /> {/* spacer */}
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginTop: 16, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #e5e7eb' }}>Earnings</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Field label="Basic Salary" value={form.basic} onChange={v => setForm(f => ({ ...f, basic: v }))} type="number" placeholder="0.00" required />
            <Field label="HRA" value={form.hra} onChange={v => setForm(f => ({ ...f, hra: v }))} type="number" placeholder="0.00" />
            <Field label="DA" value={form.da} onChange={v => setForm(f => ({ ...f, da: v }))} type="number" placeholder="0.00" />
            <Field label="Other Allowances" value={form.other} onChange={v => setForm(f => ({ ...f, other: v }))} type="number" placeholder="0.00" />
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginTop: 16, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #e5e7eb' }}>Deductions</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="PF" value={form.pf} onChange={v => setForm(f => ({ ...f, pf: v }))} type="number" placeholder="0.00" />
            <Field label="Professional Tax" value={form.pt} onChange={v => setForm(f => ({ ...f, pt: v }))} type="number" placeholder="0.00" />
            <Field label="TDS" value={form.tds} onChange={v => setForm(f => ({ ...f, tds: v }))} type="number" placeholder="0.00" />
          </div>

          {/* Calculation summary */}
          <div style={{ marginTop: 16, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
              <div>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Gross Salary: </span>
                <span style={{ fontWeight: 700, color: '#1a1a1a' }}>INR {formatINR(grossSalary)}</span>
              </div>
              <div>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Total Deductions: </span>
                <span style={{ fontWeight: 700, color: '#dc2626' }}>INR {formatINR(totalDeductions)}</span>
              </div>
              <div>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Net Pay: </span>
                <span style={{ fontWeight: 800, color: '#2e7d32', fontSize: 15 }}>INR {formatINR(netSalary)}</span>
              </div>
            </div>
          </div>

          <button type="submit" disabled={saving} style={{ marginTop: 16, padding: '10px 28px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Processing...' : 'Create Payroll'}
          </button>
        </form>
      )}

      {/* Records table */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading payroll records...</div>
      ) : records.length === 0 ? (
        <EmptyState message="No payroll records found for this month." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Employee', 'Month', 'Gross', 'Deductions', 'Net Pay', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #e5e7eb', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(rec => {
                const sc = PAYROLL_STATUS_COLORS[rec.status] || PAYROLL_STATUS_COLORS.pending;
                const nextStatus = rec.status === 'pending' ? 'approved' : rec.status === 'approved' ? 'Paid' : null;
                return (
                  <tr key={rec.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1a1a1a' }}>{employeeMap[rec.employeeId] || rec.employeeId}</td>
                    <td style={{ padding: '10px 12px', color: '#475569' }}>{rec.month}</td>
                    <td style={{ padding: '10px 12px', color: '#475569' }}>INR {formatINR(rec.grossSalary)}</td>
                    <td style={{ padding: '10px 12px', color: '#dc2626' }}>INR {formatINR(rec.totalDeductions)}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: '#2e7d32' }}>INR {formatINR(rec.netSalary)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge text={rec.status} color={sc.color} bg={sc.bg} border={sc.border} />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {nextStatus ? (
                        <button
                          onClick={() => handleStatusChange(rec.id, nextStatus)}
                          style={{
                            padding: '4px 12px',
                            background: nextStatus === 'Paid' ? '#dcfce7' : '#eff6ff',
                            color: nextStatus === 'Paid' ? '#166534' : '#1e40af',
                            border: `1px solid ${nextStatus === 'Paid' ? '#bbf7d0' : '#bfdbfe'}`,
                            borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                          }}
                        >
                          Mark {nextStatus === 'Paid' ? 'Paid' : 'Approved'}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>Completed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination pagination={pagination} onPageChange={p => { setPage(p); loadRecords(p); }} />
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Employees() {
  const [activeTab, setActiveTab] = useState('Employees');
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState(null);

  const loadEmployees = useCallback(async (page = 1, search = '', department = '') => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (search) params.set('search', search);
      if (department) params.set('department', department);
      const res = await api.get(`/employees?${params}`);
      setEmployees(res.data || []);
      setPagination(res.pagination || null);
    } catch (err) {
      setError(err.message || 'Failed to load employees');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  if (loading && employees.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading employees...</div>;
  }

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 24, color: '#1a1a1a', margin: 0 }}>HR & Employees</h2>
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 24 }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 24px',
              fontSize: 13,
              fontWeight: 600,
              color: activeTab === tab ? '#2e7d32' : '#64748b',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #2e7d32' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
              fontFamily: "'Poppins',sans-serif",
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {/* Tab content */}
      {activeTab === 'Employees' && (
        <EmployeesTab
          employees={employees}
          setEmployees={setEmployees}
          loadEmployees={loadEmployees}
          pagination={pagination}
          onPageChange={p => loadEmployees(p)}
        />
      )}
      {activeTab === 'Attendance' && <AttendanceTab employees={employees} />}
      {activeTab === 'Payroll' && <PayrollTab employees={employees} />}
    </div>
  );
}
