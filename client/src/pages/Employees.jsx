import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, where } from 'firebase/firestore';
import { formatCurrency, formatDate, getStatusColor, getCurrentMonth } from '../utils/formatters';
import { api } from '../utils/api';

const DEPARTMENTS = ['Engineering', 'Design', 'Marketing', 'Operations', 'HR', 'Finance'];

const EMPTY_FORM = {
  name: '',
  email: '',
  phone: '',
  department: '',
  role: '',
  joinDate: '',
  address: '',
  pan: '',
  bankDetails: {
    accountName: '',
    accountNumber: '',
    ifsc: ''
  },
  salary: {
    basic: '',
    hra: '',
    da: '',
    other: ''
  },
  uan: '',
  ppfAccountNumber: '',
  ppfContribution: 12,
  esiNumber: '',
  insurance: {
    provider: '',
    policyNumber: '',
    sumAssured: '',
    premium: '',
    validTill: ''
  },
  emailAlias: '',
  status: 'active'
};

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');

  // Validation errors state
  const [validationErrors, setValidationErrors] = useState({});

  // Mailbox creation state
  const [showMailboxCreate, setShowMailboxCreate] = useState(false);
  const [mailboxPassword, setMailboxPassword] = useState('');
  const [creatingMailbox, setCreatingMailbox] = useState(false);
  const [mailboxMsg, setMailboxMsg] = useState({ text: '', type: '' });

  useEffect(() => {
    fetchEmployees();
  }, []);

  async function fetchEmployees() {
    setLoading(true);
    try {
      const q = query(collection(db, 'employees'), orderBy('name'));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setEmployees(data);
    } catch (err) {
      console.error('Error fetching employees:', err);
    } finally {
      setLoading(false);
    }
  }

  // Clear mailbox message after 5 seconds
  useEffect(() => {
    if (mailboxMsg.text) {
      const t = setTimeout(() => setMailboxMsg({ text: '', type: '' }), 5000);
      return () => clearTimeout(t);
    }
  }, [mailboxMsg]);

  async function handleGenerateMailboxPassword() {
    try {
      const data = await api.post('/poste/generate-password');
      setMailboxPassword(data.password);
    } catch (err) {
      const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
      let pw = '';
      for (let i = 0; i < 16; i++) pw += charset[Math.floor(Math.random() * charset.length)];
      setMailboxPassword(pw);
    }
  }

  async function handleCreateMailbox() {
    if (!mailboxPassword.trim()) {
      setMailboxMsg({ text: 'Please enter or generate a password.', type: 'error' });
      return;
    }
    setCreatingMailbox(true);
    setMailboxMsg({ text: '', type: '' });
    try {
      await api.post('/poste/mailboxes', {
        email: form.emailAlias.trim(),
        name: form.name.trim() || form.emailAlias.trim(),
        password: mailboxPassword.trim(),
        employeeId: editingId || undefined,
      });
      setMailboxMsg({ text: `Mailbox ${form.emailAlias} created successfully!`, type: 'success' });
      setShowMailboxCreate(false);
      setMailboxPassword('');
    } catch (err) {
      setMailboxMsg({ text: err.message || 'Failed to create mailbox', type: 'error' });
    } finally {
      setCreatingMailbox(false);
    }
  }

  function validateField(name, value) {
    const errors = { ...validationErrors };
    const trimmed = (value || '').trim();

    if (name === 'pan') {
      if (trimmed && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(trimmed.toUpperCase())) {
        errors.pan = 'Invalid PAN format. Must be like ABCDE1234F (5 letters, 4 digits, 1 letter).';
      } else {
        delete errors.pan;
      }
    }

    if (name === 'bank_ifsc') {
      if (trimmed && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(trimmed.toUpperCase())) {
        errors.bank_ifsc = 'Invalid IFSC format. Must be like SBIN0001234 (4 letters, 0, then 6 alphanumeric).';
      } else {
        delete errors.bank_ifsc;
      }
    }

    if (name === 'phone') {
      const digits = trimmed.replace(/[\s\-+]/g, '');
      // Allow empty, but if provided must end with 10 digits
      if (trimmed && !/^\+?\d{10,12}$/.test(digits)) {
        errors.phone = 'Phone must be 10 digits (with optional country code).';
      } else {
        delete errors.phone;
      }
    }

    if (name === 'email') {
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        errors.email = 'Invalid email format.';
      } else {
        delete errors.email;
      }
    }

    setValidationErrors(errors);
  }

  function handleChange(e) {
    const { name, value } = e.target;
    if (name.startsWith('bank_')) {
      const field = name.replace('bank_', '');
      setForm(prev => ({ ...prev, bankDetails: { ...prev.bankDetails, [field]: value } }));
    } else if (name.startsWith('salary_')) {
      const field = name.replace('salary_', '');
      setForm(prev => ({ ...prev, salary: { ...prev.salary, [field]: value } }));
    } else if (name.startsWith('insurance_')) {
      const field = name.replace('insurance_', '');
      setForm(prev => ({ ...prev, insurance: { ...prev.insurance, [field]: value } }));
    } else {
      setForm(prev => ({ ...prev, [name]: value }));
    }

    // Run inline validation for relevant fields
    validateField(name, value);
  }

  function handleEdit(emp) {
    setEditingId(emp.id);
    setForm({
      name: emp.name || '',
      email: emp.email || '',
      phone: emp.phone || '',
      department: emp.department || '',
      role: emp.role || '',
      joinDate: emp.joinDate || '',
      address: emp.address || '',
      pan: emp.pan || '',
      bankDetails: {
        accountName: emp.bankDetails?.accountName || '',
        accountNumber: emp.bankDetails?.accountNumber || '',
        ifsc: emp.bankDetails?.ifsc || ''
      },
      salary: {
        basic: emp.salary?.basic || '',
        hra: emp.salary?.hra || '',
        da: emp.salary?.da || '',
        other: emp.salary?.other || ''
      },
      uan: emp.uan || '',
      ppfAccountNumber: emp.ppfAccountNumber || '',
      ppfContribution: emp.ppfContribution != null ? emp.ppfContribution : 12,
      esiNumber: emp.esiNumber || '',
      insurance: {
        provider: emp.insurance?.provider || '',
        policyNumber: emp.insurance?.policyNumber || '',
        sumAssured: emp.insurance?.sumAssured || '',
        premium: emp.insurance?.premium || '',
        validTill: emp.insurance?.validTill || ''
      },
      emailAlias: emp.emailAlias || '',
      status: emp.status || 'active'
    });
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setValidationErrors({});
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;

    // Run validation on all relevant fields before submit
    validateField('pan', form.pan);
    validateField('bank_ifsc', form.bankDetails.ifsc);
    validateField('phone', form.phone);
    validateField('email', form.email);

    // Recompute errors synchronously to check
    const submitErrors = {};
    const panTrimmed = form.pan.trim().toUpperCase();
    if (panTrimmed && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panTrimmed)) {
      submitErrors.pan = 'Invalid PAN format.';
    }
    const ifscTrimmed = form.bankDetails.ifsc.trim().toUpperCase();
    if (ifscTrimmed && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscTrimmed)) {
      submitErrors.bank_ifsc = 'Invalid IFSC format.';
    }
    const phoneDigits = form.phone.trim().replace(/[\s\-+]/g, '');
    if (form.phone.trim() && !/^\+?\d{10,12}$/.test(phoneDigits)) {
      submitErrors.phone = 'Phone must be 10 digits.';
    }
    const emailTrimmed = form.email.trim();
    if (emailTrimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      submitErrors.email = 'Invalid email format.';
    }

    if (Object.keys(submitErrors).length > 0) {
      setValidationErrors(submitErrors);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        department: form.department,
        role: form.role.trim(),
        joinDate: form.joinDate,
        address: form.address.trim(),
        pan: form.pan.trim(),
        bankDetails: {
          accountName: form.bankDetails.accountName.trim(),
          accountNumber: form.bankDetails.accountNumber.trim(),
          ifsc: form.bankDetails.ifsc.trim()
        },
        salary: {
          basic: Number(form.salary.basic) || 0,
          hra: Number(form.salary.hra) || 0,
          da: Number(form.salary.da) || 0,
          other: Number(form.salary.other) || 0
        },
        uan: form.uan.trim(),
        ppfAccountNumber: form.ppfAccountNumber.trim(),
        ppfContribution: Number(form.ppfContribution) || 12,
        esiNumber: form.esiNumber.trim(),
        insurance: {
          provider: form.insurance.provider.trim(),
          policyNumber: form.insurance.policyNumber.trim(),
          sumAssured: Number(form.insurance.sumAssured) || 0,
          premium: Number(form.insurance.premium) || 0,
          validTill: form.insurance.validTill
        },
        emailAlias: form.emailAlias.trim(),
        status: form.status,
        updatedAt: new Date().toISOString()
      };

      if (editingId) {
        await updateDoc(doc(db, 'employees', editingId), payload);
      } else {
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'employees'), payload);
      }

      handleCancel();
      await fetchEmployees();
    } catch (err) {
      console.error('Error saving employee:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(emp) {
    try {
      const newStatus = emp.status === 'active' ? 'inactive' : 'active';
      await updateDoc(doc(db, 'employees', emp.id), {
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
      await fetchEmployees();
    } catch (err) {
      console.error('Error toggling status:', err);
    }
  }

  async function handleDelete(emp) {
    if (!window.confirm(`Delete employee "${emp.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'employees', emp.id));
      await fetchEmployees();
    } catch (err) {
      console.error('Error deleting employee:', err);
    }
  }

  const filtered = employees.filter(emp => {
    const matchesSearch = !search ||
      emp.name?.toLowerCase().includes(search.toLowerCase()) ||
      emp.email?.toLowerCase().includes(search.toLowerCase()) ||
      emp.role?.toLowerCase().includes(search.toLowerCase());
    const matchesDept = !filterDept || emp.department === filterDept;
    return matchesSearch && matchesDept;
  });

  return (
    <div className="page-employees">
      {/* Header Actions */}
      <div className="page-actions" style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search employees..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: '1', minWidth: '200px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
        />
        <select
          value={filterDept}
          onChange={e => setFilterDept(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
        >
          <option value="">All Departments</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button
          className="btn btn-primary"
          onClick={() => { handleCancel(); setShowForm(true); }}
          style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}
        >
          + Add Employee
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#2563eb' }}>{employees.length}</div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>Total Employees</div>
        </div>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#22c55e' }}>{employees.filter(e => e.status === 'active').length}</div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>Active</div>
        </div>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#6b7280' }}>{employees.filter(e => e.status === 'inactive').length}</div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>Inactive</div>
        </div>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#a78bfa' }}>{new Set(employees.map(e => e.department).filter(Boolean)).size}</div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>Departments</div>
        </div>
      </div>

      {/* Add/Edit Employee Form */}
      {showForm && (
        <div className="card" style={{ padding: '24px', marginBottom: '24px' }}>
          <div className="card-header" style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
              {editingId ? 'Edit Employee' : 'Add New Employee'}
            </h3>
          </div>
          <form onSubmit={handleSubmit}>
            {/* Personal Info */}
            <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Personal Information
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
              <div className="form-group">
                <label>Full Name *</label>
                <input type="text" name="name" value={form.name} onChange={handleChange} required placeholder="Employee name" />
              </div>
              <div className="form-group">
                <label>Email *</label>
                <input type="email" name="email" value={form.email} onChange={handleChange} required placeholder="email@example.com" style={validationErrors.email ? { borderColor: '#ef4444' } : {}} />
                {validationErrors.email && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{validationErrors.email}</div>}
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="+91 XXXXX XXXXX" style={validationErrors.phone ? { borderColor: '#ef4444' } : {}} />
                {validationErrors.phone && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{validationErrors.phone}</div>}
              </div>
              <div className="form-group">
                <label>Department</label>
                <select name="department" value={form.department} onChange={handleChange}>
                  <option value="">Select Department</option>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Role</label>
                <input type="text" name="role" value={form.role} onChange={handleChange} placeholder="e.g. Senior Developer" />
              </div>
              <div className="form-group">
                <label>Join Date</label>
                <input type="date" name="joinDate" value={form.joinDate} onChange={handleChange} />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label>Address</label>
              <textarea name="address" value={form.address} onChange={handleChange} rows="2" placeholder="Full address" style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', resize: 'vertical' }} />
            </div>
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label>PAN Number</label>
              <input type="text" name="pan" value={form.pan} onChange={handleChange} placeholder="ABCDE1234F" style={{ maxWidth: '300px', ...(validationErrors.pan ? { borderColor: '#ef4444' } : {}) }} />
              {validationErrors.pan && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{validationErrors.pan}</div>}
            </div>

            {/* Bank Details */}
            <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Bank Details
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div className="form-group">
                <label>Account Holder Name</label>
                <input type="text" name="bank_accountName" value={form.bankDetails.accountName} onChange={handleChange} placeholder="As per bank records" />
              </div>
              <div className="form-group">
                <label>Account Number</label>
                <input type="text" name="bank_accountNumber" value={form.bankDetails.accountNumber} onChange={handleChange} placeholder="Bank account number" />
              </div>
              <div className="form-group">
                <label>IFSC Code</label>
                <input type="text" name="bank_ifsc" value={form.bankDetails.ifsc} onChange={handleChange} placeholder="e.g. SBIN0001234" style={validationErrors.bank_ifsc ? { borderColor: '#ef4444' } : {}} />
                {validationErrors.bank_ifsc && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{validationErrors.bank_ifsc}</div>}
              </div>
            </div>

            {/* Salary Components */}
            <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Salary Components (Monthly)
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div className="form-group">
                <label>Basic</label>
                <input type="number" name="salary_basic" value={form.salary.basic} onChange={handleChange} placeholder="0" min="0" />
              </div>
              <div className="form-group">
                <label>HRA</label>
                <input type="number" name="salary_hra" value={form.salary.hra} onChange={handleChange} placeholder="0" min="0" />
              </div>
              <div className="form-group">
                <label>DA</label>
                <input type="number" name="salary_da" value={form.salary.da} onChange={handleChange} placeholder="0" min="0" />
              </div>
              <div className="form-group">
                <label>Other Allowances</label>
                <input type="number" name="salary_other" value={form.salary.other} onChange={handleChange} placeholder="0" min="0" />
              </div>
            </div>

            {/* Statutory & Compliance */}
            <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Statutory & Compliance
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div className="form-group">
                <label>UAN (Universal Account Number)</label>
                <input type="text" name="uan" value={form.uan} onChange={handleChange} placeholder="100123456789" />
              </div>
              <div className="form-group">
                <label>PPF Account Number</label>
                <input type="text" name="ppfAccountNumber" value={form.ppfAccountNumber} onChange={handleChange} placeholder="PPF account number" />
              </div>
              <div className="form-group">
                <label>PPF Contribution (%)</label>
                <input type="number" name="ppfContribution" value={form.ppfContribution} onChange={handleChange} placeholder="12" min="0" />
              </div>
              <div className="form-group">
                <label>ESI Number</label>
                <input type="text" name="esiNumber" value={form.esiNumber} onChange={handleChange} placeholder="ESI number (if applicable)" />
              </div>
            </div>

            {/* Insurance */}
            <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Insurance
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div className="form-group">
                <label>Insurance Provider</label>
                <input type="text" name="insurance_provider" value={form.insurance.provider} onChange={handleChange} placeholder="e.g. LIC, HDFC Life" />
              </div>
              <div className="form-group">
                <label>Policy Number</label>
                <input type="text" name="insurance_policyNumber" value={form.insurance.policyNumber} onChange={handleChange} placeholder="Policy number" />
              </div>
              <div className="form-group">
                <label>Sum Assured</label>
                <input type="number" name="insurance_sumAssured" value={form.insurance.sumAssured} onChange={handleChange} placeholder="Sum assured amount" min="0" />
              </div>
              <div className="form-group">
                <label>Monthly Premium</label>
                <input type="number" name="insurance_premium" value={form.insurance.premium} onChange={handleChange} placeholder="Monthly premium" min="0" />
              </div>
              <div className="form-group">
                <label>Valid Till</label>
                <input type="date" name="insurance_validTill" value={form.insurance.validTill} onChange={handleChange} />
              </div>
            </div>

            {/* Email Alias */}
            <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Email Alias
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '12px' }}>
              <div className="form-group">
                <label>Email Alias</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <input type="text" name="emailAlias" value={form.emailAlias} onChange={handleChange} placeholder="name@akshaykotish.com" style={{ flex: 1 }} />
                  {form.emailAlias.trim().endsWith('@akshaykotish.com') && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMailboxCreate(!showMailboxCreate);
                        setMailboxPassword('');
                        setMailboxMsg({ text: '', type: '' });
                      }}
                      style={{
                        padding: '8px 14px',
                        background: showMailboxCreate ? '#f3f4f6' : '#22c55e',
                        color: showMailboxCreate ? '#374151' : '#fff',
                        border: showMailboxCreate ? '1px solid #d1d5db' : 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {showMailboxCreate ? 'Cancel' : 'Create Mailbox'}
                    </button>
                  )}
                </div>
                <small style={{ color: '#6b7280', fontSize: '12px', marginTop: '4px', display: 'block' }}>(Configure alias in Zoho Mail admin or create a Poste.io mailbox)</small>
              </div>
            </div>

            {/* Mailbox creation inline */}
            {showMailboxCreate && form.emailAlias.trim().endsWith('@akshaykotish.com') && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
                <p style={{ fontSize: '13px', fontWeight: '600', color: '#166534', marginBottom: '12px' }}>
                  Create mailbox for: <strong>{form.emailAlias.trim()}</strong>
                </p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                  <input
                    type="text"
                    placeholder="Enter password for mailbox"
                    value={mailboxPassword}
                    onChange={e => setMailboxPassword(e.target.value)}
                    style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                  />
                  <button
                    type="button"
                    onClick={handleGenerateMailboxPassword}
                    style={{
                      padding: '8px 14px',
                      background: '#e0e7ff',
                      color: '#4338ca',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Auto-Generate
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateMailbox}
                    disabled={creatingMailbox}
                    style={{
                      padding: '8px 18px',
                      background: creatingMailbox ? '#86efac' : '#22c55e',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: creatingMailbox ? 'not-allowed' : 'pointer',
                      fontWeight: '600',
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                      opacity: creatingMailbox ? 0.7 : 1,
                    }}
                  >
                    {creatingMailbox ? 'Creating...' : 'Create'}
                  </button>
                </div>
                {mailboxMsg.text && (
                  <div style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '600',
                    background: mailboxMsg.type === 'success' ? '#dcfce7' : '#fef2f2',
                    color: mailboxMsg.type === 'success' ? '#166534' : '#ef4444',
                    border: `1px solid ${mailboxMsg.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
                  }}>
                    {mailboxMsg.text}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={handleCancel} style={{ padding: '8px 20px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ padding: '8px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving...' : (editingId ? 'Update Employee' : 'Add Employee')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Employee Directory Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Name</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Email</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Phone</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Department</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Role</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Join Date</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading employees...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
                    {employees.length === 0 ? 'No employees yet. Add your first employee above.' : 'No employees match your search.'}
                  </td>
                </tr>
              ) : (
                filtered.map(emp => (
                  <tr key={emp.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '12px 16px', fontWeight: '500' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '50%', background: '#e0e7ff', color: '#4338ca',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '600', fontSize: '13px', flexShrink: 0
                        }}>
                          {(emp.name || '?')[0].toUpperCase()}
                        </div>
                        {emp.name}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#6b7280' }}>{emp.email}</td>
                    <td style={{ padding: '12px 16px', color: '#6b7280' }}>{emp.phone || '--'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {emp.department ? (
                        <span style={{ padding: '2px 10px', borderRadius: '12px', background: '#f3f4f6', fontSize: '12px', fontWeight: '500' }}>
                          {emp.department}
                        </span>
                      ) : '--'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#6b7280' }}>{emp.role || '--'}</td>
                    <td style={{ padding: '12px 16px', color: '#6b7280' }}>{formatDate(emp.joinDate)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span
                        onClick={() => handleToggleStatus(emp)}
                        style={{
                          padding: '3px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                          background: emp.status === 'active' ? '#dcfce7' : '#f3f4f6',
                          color: getStatusColor(emp.status || 'inactive')
                        }}
                      >
                        {emp.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleEdit(emp)}
                          title="Edit"
                          style={{ padding: '4px 10px', background: '#eff6ff', color: '#2563eb', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(emp)}
                          title="Delete"
                          style={{ padding: '4px 10px', background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
