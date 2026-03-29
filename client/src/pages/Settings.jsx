import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const SECTIONS = [
  { key: 'company', label: 'Company Profile' },
  { key: 'bankAccounts', label: 'Bank Accounts' },
  { key: 'billProfile', label: 'Bill Profile' },
  { key: 'mail', label: 'Zoho Mail' },
  { key: 'letterhead', label: 'Letterhead & Headers' },
  { key: 'invoice', label: 'Invoice Settings' },
  { key: 'razorpay', label: 'Razorpay' },
];

const defaultCompany = {
  name: 'Akshay Kotish & Co.',
  legalName: 'Akshay Lakshay Kotish Private Limited',
  cin: 'U72900HR2022PTC101170',
  gstin: '06AAWCA4919K1Z3',
  pan: 'AAWCA4919K',
  address: 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027',
  state: 'Haryana',
  stateCode: '06',
  phone: '+91 98967 70369',
  email: 'akshaykotish@gmail.com',
  website: 'www.akshaykotish.com',
};

const defaultMail = {
  email: 'connect@akshaykotish.com',
  host: 'smtp.zoho.in',
  port: '465',
};

const defaultInvoice = {
  prefix: 'ALKPL',
  gstRate: '18',
  paymentTerms: '30',
  financialYear: '',
};

const defaultBankAccount = () => ({
  id: Date.now().toString(),
  bankName: '',
  accountHolder: '',
  accountNumber: '',
  ifscCode: '',
  branch: '',
  accountType: 'current',
  upiId: '',
  isDefault: false,
});

const DEFAULT_BILL_SECTIONS = [
  { id: 'companyHeader', label: 'Company Header', visible: true, locked: false },
  { id: 'billTo', label: 'Bill To & Supply Details', visible: true, locked: false },
  { id: 'lineItems', label: 'Line Items Table', visible: true, locked: true },
  { id: 'summary', label: 'Amount Summary', visible: true, locked: true },
  { id: 'amountWords', label: 'Amount in Words', visible: true, locked: false },
  { id: 'bankDetails', label: 'Bank Account Details', visible: true, locked: false },
  { id: 'termsConditions', label: 'Terms & Conditions', visible: true, locked: false },
  { id: 'customTexts', label: 'Custom Text Blocks', visible: false, locked: false },
  { id: 'stamp', label: 'Official Stamp & Signature', visible: true, locked: false },
  { id: 'footer', label: 'Footer', visible: true, locked: false },
];

const FOOTER_TEMPLATES = [
  {
    id: 'standard',
    name: 'Standard',
    content: 'Thank you for your business.\nThis is a computer-generated invoice.',
  },
  {
    id: 'professional',
    name: 'Professional',
    content: 'Thank you for choosing {companyName}.\nPayment is due within the specified terms. Late payments may be subject to interest charges.\nFor queries, contact us at {email}.',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    content: '{companyName} | {email} | {phone}',
  },
  {
    id: 'detailed',
    name: 'Detailed',
    content: 'Thank you for your business with {companyName}.\nPlease make payment to the bank account details mentioned above within the due date.\nFor any discrepancies, please notify us within 7 days of receipt.\nThis is a computer-generated invoice and does not require physical signature.\nContact: {email} | {phone} | {website}',
  },
  {
    id: 'custom',
    name: 'Custom Footer',
    content: '',
  },
];

const STAMP_OPTIONS = [
  { id: 'stamp_border', label: 'Official Stamp (with border)', src: '/images/stamp1x_withborder.png' },
  { id: 'stamp_noborder', label: 'Official Stamp (no border)', src: '/images/stamp_nobroder_1x.png' },
  { id: 'none', label: 'No Stamp', src: '' },
];

const defaultBillProfile = {
  sections: DEFAULT_BILL_SECTIONS,
  termsAndConditions: '1. Payment is due within the specified period from the date of invoice.\n2. Please include the invoice number as reference when making payment.\n3. Goods once sold will not be taken back or exchanged.\n4. Interest @ 18% p.a. will be charged on overdue payments.\n5. Subject to local jurisdiction.',
  stampImage: '/images/stamp1x_withborder.png',
  footerTemplate: 'standard',
  customFooterText: '',
  customTexts: [],
};

export default function Settings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('company');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  const [company, setCompany] = useState({ ...defaultCompany });
  const [mail, setMail] = useState({ ...defaultMail });
  const [invoice, setInvoice] = useState({ ...defaultInvoice });
  const [bankAccounts, setBankAccounts] = useState([]);
  const [billProfile, setBillProfile] = useState({ ...defaultBillProfile });
  const [testingEmail, setTestingEmail] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const [companySnap, invoiceSnap, mailSnap, bankSnap, profileSnap] = await Promise.all([
        getDoc(doc(db, 'settings', 'company')),
        getDoc(doc(db, 'settings', 'invoice_settings')),
        getDoc(doc(db, 'settings', 'mail')),
        getDoc(doc(db, 'settings', 'bank_accounts')),
        getDoc(doc(db, 'settings', 'bill_profile')),
      ]);

      if (companySnap.exists()) setCompany({ ...defaultCompany, ...companySnap.data() });
      if (invoiceSnap.exists()) setInvoice({ ...defaultInvoice, ...invoiceSnap.data() });
      if (mailSnap.exists()) setMail({ ...defaultMail, ...mailSnap.data() });
      if (bankSnap.exists()) setBankAccounts(bankSnap.data().accounts || []);
      if (profileSnap.exists()) {
        const data = profileSnap.data();
        setBillProfile({
          ...defaultBillProfile,
          ...data,
          sections: data.sections || DEFAULT_BILL_SECTIONS,
        });
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
    setLoading(false);
  }

  function showMessage(text, type = 'success') {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 3000);
  }

  async function saveCompany(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'company'), { ...company, updatedAt: new Date().toISOString() });
      showMessage('Company profile saved successfully.');
    } catch (err) {
      showMessage('Failed to save company profile.', 'error');
    }
    setSaving(false);
  }

  async function saveBankAccounts(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'bank_accounts'), { accounts: bankAccounts, updatedAt: new Date().toISOString() });
      showMessage('Bank accounts saved successfully.');
    } catch (err) {
      showMessage('Failed to save bank accounts.', 'error');
    }
    setSaving(false);
  }

  async function saveBillProfile(e) {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'bill_profile'), { ...billProfile, updatedAt: new Date().toISOString() });
      showMessage('Bill profile saved successfully.');
    } catch (err) {
      showMessage('Failed to save bill profile.', 'error');
    }
    setSaving(false);
  }

  async function saveMail(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'mail'), { ...mail, updatedAt: new Date().toISOString() });
      showMessage('Mail settings saved.');
    } catch (err) {
      showMessage('Failed to save mail settings.', 'error');
    }
    setSaving(false);
  }

  async function handleTestEmail() {
    setTestingEmail(true);
    try {
      await api.post('/mail/send', {
        to: user?.email || company.email || 'akshaykotish@gmail.com',
        subject: 'Test Email — Akshay Kotish & Co. ERP',
        html: `<div style="font-family:Arial,sans-serif;padding:20px;">
          <h2 style="color:#2e7d32;">Akshay Kotish & Co.</h2>
          <p>This is a test email from your ERP system.</p>
          <p><strong>Sent via:</strong> Zoho SMTP (${mail.email})</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
          <hr style="border:1px solid #2e7d32;"/>
          <p style="color:#888;font-size:12px;">Sent from AK & Co. Dashboard</p>
        </div>`,
      });
      showMessage('Test email sent successfully! Check your inbox.');
    } catch (err) {
      showMessage('Failed to send test email: ' + (err.message || 'Unknown error'), 'error');
    }
    setTestingEmail(false);
  }

  async function saveInvoice(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'invoice_settings'), { ...invoice, updatedAt: new Date().toISOString() });
      showMessage('Invoice settings saved successfully.');
    } catch (err) {
      showMessage('Failed to save invoice settings.', 'error');
    }
    setSaving(false);
  }

  function getFinancialYear() {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${year + 1}`;
  }

  // ── Bank account helpers ──
  function addBankAccount() {
    setBankAccounts(prev => [...prev, defaultBankAccount()]);
  }

  function updateBankAccount(index, field, value) {
    setBankAccounts(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'isDefault' && value) {
        updated.forEach((acc, i) => { if (i !== index) acc.isDefault = false; });
      }
      return updated;
    });
  }

  function removeBankAccount(index) {
    setBankAccounts(prev => prev.filter((_, i) => i !== index));
  }

  // ── Drag and drop helpers ──
  function handleDragStart(index) {
    setDragIndex(index);
  }

  function handleDragOver(e, index) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function handleDrop(index) {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    setBillProfile(prev => {
      const sections = [...prev.sections];
      const [moved] = sections.splice(dragIndex, 1);
      sections.splice(index, 0, moved);
      return { ...prev, sections };
    });
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function toggleSectionVisibility(index) {
    setBillProfile(prev => {
      const sections = [...prev.sections];
      if (sections[index].locked) return prev;
      sections[index] = { ...sections[index], visible: !sections[index].visible };
      return { ...prev, sections };
    });
  }

  // ── Custom text helpers ──
  function addCustomText() {
    setBillProfile(prev => ({
      ...prev,
      customTexts: [...(prev.customTexts || []), { id: Date.now().toString(), title: '', content: '' }],
    }));
  }

  function updateCustomText(index, field, value) {
    setBillProfile(prev => {
      const texts = [...(prev.customTexts || [])];
      texts[index] = { ...texts[index], [field]: value };
      return { ...prev, customTexts: texts };
    });
  }

  function removeCustomText(index) {
    setBillProfile(prev => ({
      ...prev,
      customTexts: (prev.customTexts || []).filter((_, i) => i !== index),
    }));
  }

  function getFooterPreview(templateId) {
    const template = FOOTER_TEMPLATES.find(t => t.id === templateId);
    if (!template) return '';
    if (templateId === 'custom') return billProfile.customFooterText || 'Enter your custom footer text...';
    return template.content
      .replace(/{companyName}/g, company.name || 'Company Name')
      .replace(/{email}/g, company.email || 'email@company.com')
      .replace(/{phone}/g, company.phone || '+91 XXXXX XXXXX')
      .replace(/{website}/g, company.website || 'www.company.com');
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="loader"></div></div>;
  }

  const s = {
    card: { background: '#fff', border: '3px solid #1a1a1a', borderRadius: 12, padding: 24, boxShadow: '4px 4px 0 #1a1a1a', marginBottom: 20 },
    title: { fontFamily: 'Playfair Display, serif', fontSize: 18, fontWeight: 900, margin: '0 0 16px', color: '#1a1a1a' },
    label: { fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: '#888', marginBottom: 4, display: 'block' },
    input: { width: '100%', padding: '8px 12px', border: '2px solid #ddd', borderRadius: 6, fontSize: 13, fontWeight: 600, outline: 'none', boxSizing: 'border-box' },
    textarea: { width: '100%', padding: '8px 12px', border: '2px solid #ddd', borderRadius: 6, fontSize: 13, fontWeight: 600, outline: 'none', resize: 'vertical', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' },
    btn: { padding: '10px 20px', border: '3px solid #1a1a1a', borderRadius: 8, background: '#2e7d32', color: '#fff', fontWeight: 900, fontSize: 13, cursor: 'pointer', boxShadow: '3px 3px 0 #1a1a1a', textTransform: 'uppercase', letterSpacing: 0.5 },
    btnSecondary: { padding: '8px 16px', border: '2px solid #1a1a1a', borderRadius: 6, background: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' },
    btnDanger: { padding: '8px 16px', border: '2px solid #c62828', borderRadius: 6, background: '#ffebee', color: '#c62828', fontWeight: 800, fontSize: 12, cursor: 'pointer' },
    tab: (active) => ({
      padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
      borderBottom: active ? '3px solid #2e7d32' : '3px solid transparent',
      marginBottom: -2, fontWeight: active ? 900 : 600, fontSize: 13,
      color: active ? '#2e7d32' : '#888', letterSpacing: 0.3, whiteSpace: 'nowrap',
    }),
    statusBadge: (ok) => ({
      display: 'inline-block', padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 800,
      background: ok ? '#e8f5e9' : '#ffebee', color: ok ? '#2e7d32' : '#c62828',
      border: `2px solid ${ok ? '#2e7d32' : '#c62828'}`,
    }),
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 },
    field: { marginBottom: 12 },
    infoBox: { background: '#f5f5f5', border: '2px solid #e0e0e0', borderRadius: 8, padding: 14, fontSize: 12, lineHeight: 1.6, marginTop: 16 },
  };

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #eee', overflowX: 'auto' }}>
        {SECTIONS.map(sec => (
          <button key={sec.key} onClick={() => setActiveSection(sec.key)} style={s.tab(activeSection === sec.key)}>
            {sec.label}
          </button>
        ))}
      </div>

      {/* Message toast */}
      {message.text && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 700,
          background: message.type === 'error' ? '#ffebee' : '#e8f5e9',
          color: message.type === 'error' ? '#c62828' : '#2e7d32',
          border: `2px solid ${message.type === 'error' ? '#c62828' : '#2e7d32'}`,
        }}>
          {message.text}
        </div>
      )}

      {/* ===== COMPANY PROFILE ===== */}
      {activeSection === 'company' && (
        <div style={s.card}>
          <h3 style={s.title}>Company Profile</h3>
          <form onSubmit={saveCompany}>
            <div style={s.grid}>
              {[
                { key: 'name', label: 'Company Name', type: 'text' },
                { key: 'gstin', label: 'GSTIN', type: 'text', placeholder: '06AAWCA4919K1Z3' },
                { key: 'legalName', label: 'Legal Name', type: 'text', placeholder: 'Akshay Lakshay Kotish Private Limited' },
                { key: 'cin', label: 'CIN', type: 'text', placeholder: 'U72900HR2022PTC101170' },
                { key: 'pan', label: 'PAN', type: 'text', placeholder: 'AAWCA4919K' },
                { key: 'state', label: 'State', type: 'text' },
                { key: 'stateCode', label: 'State Code', type: 'text', placeholder: '06' },
                { key: 'phone', label: 'Phone', type: 'text', placeholder: '+91 XXXXX XXXXX' },
                { key: 'email', label: 'Email', type: 'email', placeholder: 'connect@akshaykotish.com' },
                { key: 'website', label: 'Website', type: 'text', placeholder: 'www.akshaykotish.com' },
              ].map(f => (
                <div key={f.key} style={s.field}>
                  <span style={s.label}>{f.label}</span>
                  <input type={f.type} value={company[f.key] || ''} onChange={e => setCompany({ ...company, [f.key]: e.target.value })} placeholder={f.placeholder || ''} style={s.input} />
                </div>
              ))}
            </div>
            <div style={s.field}>
              <span style={s.label}>Address</span>
              <textarea rows={3} value={company.address || ''} onChange={e => setCompany({ ...company, address: e.target.value })} placeholder="Full company address" style={s.textarea} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="submit" style={s.btn} disabled={saving}>{saving ? 'Saving...' : 'Save Company Profile'}</button>
            </div>
          </form>
        </div>
      )}

      {/* ===== BANK ACCOUNTS ===== */}
      {activeSection === 'bankAccounts' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ ...s.title, marginBottom: 4 }}>Bank Accounts</h3>
              <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Add your company bank accounts to display on invoices and bills.</p>
            </div>
            <button type="button" style={s.btn} onClick={addBankAccount}>+ Add Bank Account</button>
          </div>

          {bankAccounts.length === 0 && (
            <div style={{ ...s.card, textAlign: 'center', padding: 40, color: '#888' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>No bank accounts added yet.</div>
              <p style={{ fontSize: 13, marginBottom: 16 }}>Add your company bank account details to display them on your invoices.</p>
              <button type="button" style={s.btn} onClick={addBankAccount}>+ Add Your First Bank Account</button>
            </div>
          )}

          <form onSubmit={saveBankAccounts}>
            {bankAccounts.map((account, idx) => (
              <div key={account.id} style={{ ...s.card, position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ ...s.title, fontSize: 15, marginBottom: 0 }}>
                    {account.bankName || `Bank Account ${idx + 1}`}
                    {account.isDefault && (
                      <span style={{ ...s.statusBadge(true), marginLeft: 8, fontSize: 10 }}>Default</span>
                    )}
                  </h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={account.isDefault || false}
                        onChange={e => updateBankAccount(idx, 'isDefault', e.target.checked)}
                      />
                      Default
                    </label>
                    <button type="button" style={s.btnDanger} onClick={() => removeBankAccount(idx)}>Remove</button>
                  </div>
                </div>
                <div style={s.grid}>
                  {[
                    { key: 'bankName', label: 'Bank Name', placeholder: 'e.g. State Bank of India' },
                    { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'e.g. Akshay Kotish & Co.' },
                    { key: 'accountNumber', label: 'Account Number', placeholder: 'e.g. 1234567890' },
                    { key: 'ifscCode', label: 'IFSC Code', placeholder: 'e.g. SBIN0001234' },
                    { key: 'branch', label: 'Branch', placeholder: 'e.g. Main Branch, New Delhi' },
                    { key: 'upiId', label: 'UPI ID (optional)', placeholder: 'e.g. company@upi' },
                  ].map(f => (
                    <div key={f.key} style={s.field}>
                      <span style={s.label}>{f.label}</span>
                      <input
                        type="text"
                        value={account[f.key] || ''}
                        onChange={e => updateBankAccount(idx, f.key, e.target.value)}
                        placeholder={f.placeholder}
                        style={s.input}
                      />
                    </div>
                  ))}
                  <div style={s.field}>
                    <span style={s.label}>Account Type</span>
                    <select
                      value={account.accountType || 'current'}
                      onChange={e => updateBankAccount(idx, 'accountType', e.target.value)}
                      style={{ ...s.input, cursor: 'pointer' }}
                    >
                      <option value="current">Current Account</option>
                      <option value="savings">Savings Account</option>
                      <option value="overdraft">Overdraft Account</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}

            {bankAccounts.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" style={s.btnSecondary} onClick={addBankAccount}>+ Add Another Account</button>
                <button type="submit" style={s.btn} disabled={saving}>{saving ? 'Saving...' : 'Save Bank Accounts'}</button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* ===== BILL PROFILE (Drag & Drop Layout) ===== */}
      {activeSection === 'billProfile' && (
        <div>
          {/* Section Layout */}
          <div style={s.card}>
            <h3 style={s.title}>Bill Layout Builder</h3>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 16px', lineHeight: 1.6 }}>
              Drag and drop sections to reorder how they appear on your invoices. Toggle visibility to show or hide sections.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              {/* Draggable Sections */}
              <div>
                <span style={{ ...s.label, marginBottom: 12, display: 'block' }}>Section Order</span>
                {billProfile.sections.map((section, idx) => (
                  <div
                    key={section.id}
                    draggable={!section.locked}
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={() => handleDrop(idx)}
                    onDragEnd={handleDragEnd}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      marginBottom: 6,
                      background: dragOverIndex === idx ? '#e8f5e9' : (dragIndex === idx ? '#f5f5f5' : '#fff'),
                      border: `2px solid ${dragOverIndex === idx ? '#2e7d32' : (section.visible ? '#ddd' : '#f0f0f0')}`,
                      borderRadius: 8,
                      cursor: section.locked ? 'default' : 'grab',
                      opacity: section.visible ? 1 : 0.5,
                      transition: 'all 0.15s',
                      userSelect: 'none',
                    }}
                  >
                    {/* Drag handle */}
                    <span style={{ fontSize: 16, color: section.locked ? '#ddd' : '#aaa', cursor: section.locked ? 'default' : 'grab', flexShrink: 0 }}>
                      {section.locked ? '\u26BF' : '\u2630'}
                    </span>

                    {/* Section label */}
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: section.visible ? '#1a1a1a' : '#aaa' }}>
                      {section.label}
                      {section.locked && <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>(required)</span>}
                    </span>

                    {/* Toggle */}
                    {!section.locked && (
                      <button
                        type="button"
                        onClick={() => toggleSectionVisibility(idx)}
                        style={{
                          width: 44, height: 24, borderRadius: 12, border: 'none',
                          background: section.visible ? '#2e7d32' : '#ddd',
                          cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                          flexShrink: 0,
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 3, left: section.visible ? 23 : 3,
                          width: 18, height: 18, borderRadius: '50%', background: '#fff',
                          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Live Preview */}
              <div>
                <span style={{ ...s.label, marginBottom: 12, display: 'block' }}>Preview Order</span>
                <div style={{ border: '2px solid #eee', borderRadius: 8, padding: 16, background: '#fafafa', minHeight: 300 }}>
                  {billProfile.sections.filter(sec => sec.visible).map((section, idx) => (
                    <div key={section.id} style={{
                      padding: '8px 12px', marginBottom: 4, background: '#fff', borderRadius: 6,
                      border: '1px solid #e8e8e8', fontSize: 12, fontWeight: 600, color: '#555',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ width: 20, height: 20, borderRadius: 4, background: '#2e7d32', color: '#fff', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {idx + 1}
                      </span>
                      {section.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Terms & Conditions */}
          <div style={s.card}>
            <h3 style={s.title}>Terms & Conditions</h3>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
              These terms will appear on all your invoices and bills.
            </p>
            <textarea
              rows={6}
              value={billProfile.termsAndConditions || ''}
              onChange={e => setBillProfile(prev => ({ ...prev, termsAndConditions: e.target.value }))}
              placeholder="Enter your terms and conditions..."
              style={s.textarea}
            />
          </div>

          {/* Official Stamp */}
          <div style={s.card}>
            <h3 style={s.title}>Official Stamp</h3>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 16px' }}>
              Select the official company stamp to display on invoices.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {STAMP_OPTIONS.map(stamp => (
                <div
                  key={stamp.id}
                  onClick={() => setBillProfile(prev => ({ ...prev, stampImage: stamp.src }))}
                  style={{
                    padding: 16,
                    border: `3px solid ${billProfile.stampImage === stamp.src ? '#2e7d32' : '#ddd'}`,
                    borderRadius: 10,
                    cursor: 'pointer',
                    textAlign: 'center',
                    background: billProfile.stampImage === stamp.src ? '#e8f5e9' : '#fff',
                    transition: 'all 0.2s',
                  }}
                >
                  {stamp.src ? (
                    <img
                      src={stamp.src}
                      alt={stamp.label}
                      style={{ maxWidth: 120, maxHeight: 120, marginBottom: 8, objectFit: 'contain' }}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{ width: 120, height: 120, margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', borderRadius: 8, color: '#aaa', fontSize: 13 }}>
                      No Stamp
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 700, color: billProfile.stampImage === stamp.src ? '#2e7d32' : '#666' }}>
                    {stamp.label}
                  </div>
                  {billProfile.stampImage === stamp.src && (
                    <span style={{ ...s.statusBadge(true), marginTop: 8, fontSize: 10 }}>Selected</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer Templates */}
          <div style={s.card}>
            <h3 style={s.title}>Footer Template</h3>
            <p style={{ fontSize: 12, color: '#888', margin: '0 0 16px' }}>
              Choose a footer template for your invoices or create a custom one.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
              {FOOTER_TEMPLATES.map(template => (
                <div
                  key={template.id}
                  onClick={() => setBillProfile(prev => ({ ...prev, footerTemplate: template.id }))}
                  style={{
                    padding: 16,
                    border: `3px solid ${billProfile.footerTemplate === template.id ? '#2e7d32' : '#ddd'}`,
                    borderRadius: 10,
                    cursor: 'pointer',
                    background: billProfile.footerTemplate === template.id ? '#e8f5e9' : '#fff',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8, color: billProfile.footerTemplate === template.id ? '#2e7d32' : '#1a1a1a' }}>
                    {template.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>
                    {template.id === 'custom' ? (billProfile.customFooterText || 'Write your own...') : template.content.substring(0, 80) + (template.content.length > 80 ? '...' : '')}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer preview */}
            <div style={{ ...s.infoBox, background: '#e8f5e9', borderColor: '#2e7d32' }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#888', marginBottom: 6 }}>Footer Preview</div>
              <div style={{ fontSize: 12, color: '#1a1a1a', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {getFooterPreview(billProfile.footerTemplate)}
              </div>
            </div>

            {/* Custom footer text */}
            {billProfile.footerTemplate === 'custom' && (
              <div style={{ marginTop: 16 }}>
                <span style={s.label}>Custom Footer Text</span>
                <textarea
                  rows={4}
                  value={billProfile.customFooterText || ''}
                  onChange={e => setBillProfile(prev => ({ ...prev, customFooterText: e.target.value }))}
                  placeholder="Enter your custom footer text. Use {companyName}, {email}, {phone}, {website} as placeholders."
                  style={s.textarea}
                />
              </div>
            )}
          </div>

          {/* Custom Text Blocks */}
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ ...s.title, marginBottom: 4 }}>Custom Text Blocks</h3>
                <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
                  Add custom text sections to your invoices (e.g., special notes, disclaimers, offers).
                </p>
              </div>
              <button type="button" style={s.btnSecondary} onClick={addCustomText}>+ Add Text Block</button>
            </div>

            {(billProfile.customTexts || []).length === 0 && (
              <div style={{ textAlign: 'center', padding: 24, color: '#aaa', fontSize: 13 }}>
                No custom text blocks. Click "Add Text Block" to create one.
              </div>
            )}

            {(billProfile.customTexts || []).map((text, idx) => (
              <div key={text.id} style={{ padding: 16, border: '2px solid #eee', borderRadius: 8, marginBottom: 12, background: '#fafafa' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ ...s.label, marginBottom: 0 }}>Text Block {idx + 1}</span>
                  <button type="button" style={{ ...s.btnDanger, padding: '4px 10px', fontSize: 11 }} onClick={() => removeCustomText(idx)}>Remove</button>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <input
                    type="text"
                    value={text.title || ''}
                    onChange={e => updateCustomText(idx, 'title', e.target.value)}
                    placeholder="Section title (optional)"
                    style={{ ...s.input, fontWeight: 800 }}
                  />
                </div>
                <textarea
                  rows={3}
                  value={text.content || ''}
                  onChange={e => updateCustomText(idx, 'content', e.target.value)}
                  placeholder="Enter text content..."
                  style={s.textarea}
                />
              </div>
            ))}
          </div>

          {/* Save Bill Profile */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" style={s.btn} onClick={saveBillProfile} disabled={saving}>
              {saving ? 'Saving...' : 'Save Bill Profile'}
            </button>
          </div>
        </div>
      )}

      {/* ===== ZOHO MAIL ===== */}
      {activeSection === 'mail' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ ...s.title, marginBottom: 4 }}>Zoho Mail SMTP</h3>
              <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Email sending via Zoho SMTP is configured and active.</p>
            </div>
            <span style={s.statusBadge(true)}>Connected</span>
          </div>

          <div style={{ ...s.infoBox, background: '#e8f5e9', borderColor: '#2e7d32' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div><strong>From Email:</strong> connect@akshaykotish.com</div>
              <div><strong>SMTP Host:</strong> smtp.zoho.in</div>
              <div><strong>Port:</strong> 465 (SSL)</div>
              <div><strong>Status:</strong> Authenticated & Active</div>
            </div>
          </div>

          <form onSubmit={saveMail} style={{ marginTop: 20 }}>
            <div style={s.grid}>
              <div style={s.field}>
                <span style={s.label}>Display Email</span>
                <input type="email" value={mail.email} onChange={e => setMail({ ...mail, email: e.target.value })} style={s.input} />
              </div>
              <div style={s.field}>
                <span style={s.label}>SMTP Host</span>
                <input type="text" value={mail.host} onChange={e => setMail({ ...mail, host: e.target.value })} style={s.input} />
              </div>
              <div style={s.field}>
                <span style={s.label}>Port</span>
                <input type="text" value={mail.port} onChange={e => setMail({ ...mail, port: e.target.value })} style={s.input} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" style={s.btnSecondary} onClick={handleTestEmail} disabled={testingEmail}>
                {testingEmail ? 'Sending...' : 'Send Test Email'}
              </button>
              <button type="submit" style={s.btn} disabled={saving}>{saving ? 'Saving...' : 'Save Mail Settings'}</button>
            </div>
          </form>
        </div>
      )}

      {/* ===== LETTERHEAD & HEADERS ===== */}
      {activeSection === 'letterhead' && (
        <div>
          <div style={s.card}>
            <h3 style={s.title}>Letterhead & Bill Header Designer</h3>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 20, lineHeight: 1.6 }}>
              Use the visual Template Builder to design your letterheads and bill headers with drag & drop.
              Add logos, images, text, shapes — customize everything visually.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/dashboard/templates')} style={s.btn}>
                Open Template Builder
              </button>
              <button onClick={() => navigate('/dashboard/templates')} style={s.btnSecondary}>
                Manage Saved Templates
              </button>
            </div>
          </div>

          <div style={{ ...s.card, background: '#fafafa' }}>
            <h3 style={{ ...s.title, fontSize: 14 }}>What you can design:</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
              <div style={{ padding: 16, background: '#fff', border: '2px solid #e0e0e0', borderRadius: 8 }}>
                <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6, color: '#2e7d32' }}>Letterhead Headers</div>
                <p style={{ fontSize: 12, color: '#666', margin: 0, lineHeight: 1.5 }}>
                  794 x 250px — Company logo, name, address, contact info, decorative elements. Used for formal letters and documents.
                </p>
              </div>
              <div style={{ padding: 16, background: '#fff', border: '2px solid #e0e0e0', borderRadius: 8 }}>
                <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6, color: '#e65100' }}>Bill Headers</div>
                <p style={{ fontSize: 12, color: '#666', margin: 0, lineHeight: 1.5 }}>
                  794 x 200px — Invoice/bill header with company branding, GSTIN, contact details. Used on all invoices and bills.
                </p>
              </div>
            </div>
            <div style={{ ...s.infoBox, marginTop: 16 }}>
              <strong>Features:</strong> Drag & drop placement, image upload, text styling, shapes & lines, grid snap, undo/redo, zoom, alignment tools, keyboard shortcuts, set default template per type.
            </div>
          </div>
        </div>
      )}

      {/* ===== INVOICE SETTINGS ===== */}
      {activeSection === 'invoice' && (
        <div style={s.card}>
          <h3 style={s.title}>Invoice Settings</h3>
          <form onSubmit={saveInvoice}>
            <div style={s.grid}>
              <div style={s.field}>
                <span style={s.label}>Invoice Prefix</span>
                <input type="text" value={invoice.prefix} onChange={e => setInvoice({ ...invoice, prefix: e.target.value })} placeholder="INV" style={s.input} />
                <span style={{ fontSize: 11, color: '#888' }}>e.g. {invoice.prefix || 'INV'}-2026-0001</span>
              </div>
              <div style={s.field}>
                <span style={s.label}>Default GST Rate (%)</span>
                <input type="number" step="0.01" min="0" max="100" value={invoice.gstRate} onChange={e => setInvoice({ ...invoice, gstRate: e.target.value })} style={s.input} />
              </div>
              <div style={s.field}>
                <span style={s.label}>Payment Terms (days)</span>
                <input type="number" min="0" value={invoice.paymentTerms} onChange={e => setInvoice({ ...invoice, paymentTerms: e.target.value })} style={s.input} />
                <span style={{ fontSize: 11, color: '#888' }}>Net {invoice.paymentTerms || 30} days</span>
              </div>
              <div style={s.field}>
                <span style={s.label}>Financial Year</span>
                <input type="text" value={invoice.financialYear || getFinancialYear()} onChange={e => setInvoice({ ...invoice, financialYear: e.target.value })} style={s.input} />
              </div>
            </div>

            <div style={{ ...s.infoBox, background: '#e8f5e9', borderColor: '#2e7d32' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Preview</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>
                {invoice.prefix || 'INV'}-{new Date().getFullYear()}-0001
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 12 }}>
                <span>GST: <strong>{invoice.gstRate || 18}%</strong></span>
                <span>Terms: <strong>Net {invoice.paymentTerms || 30} days</strong></span>
                <span>FY: <strong>{invoice.financialYear || getFinancialYear()}</strong></span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="submit" style={s.btn} disabled={saving}>{saving ? 'Saving...' : 'Save Invoice Settings'}</button>
            </div>
          </form>
        </div>
      )}

      {/* ===== RAZORPAY ===== */}
      {activeSection === 'razorpay' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ ...s.title, marginBottom: 4 }}>Razorpay Payment Gateway</h3>
              <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Live payment gateway for collecting payments via UPI, cards, net banking, and wallets.</p>
            </div>
            <span style={s.statusBadge(true)}>Live Mode</span>
          </div>

          <div style={{ ...s.infoBox, background: '#e3f2fd', borderColor: '#1565c0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div><strong>Key ID:</strong> rzp_live_SRg...jPy</div>
              <div><strong>Mode:</strong> Live</div>
              <div><strong>Webhook:</strong> /api/razorpay/webhook</div>
              <div><strong>Payment Links:</strong> Enabled</div>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <h4 style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: '#555' }}>Capabilities</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {[
                { title: 'Payment Orders', desc: 'Create Razorpay checkout orders from dashboard or via API' },
                { title: 'Payment Links', desc: 'Generate shareable payment links sent via email' },
                { title: 'Invoice + Pay', desc: 'Create invoice and send with Razorpay payment link in one step' },
                { title: 'Webhook Auto-Sync', desc: 'Automatic payment status updates and invoice marking' },
                { title: 'API Access', desc: 'Subsidiaries and tools can create orders via API key auth' },
                { title: 'AI Assistant', desc: 'Send bills with payment links using voice/text commands' },
              ].map(c => (
                <div key={c.title} style={{ padding: 12, background: '#f5f5f5', borderRadius: 8, border: '2px solid #e0e0e0' }}>
                  <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 4 }}>{c.title}</div>
                  <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...s.infoBox, marginTop: 20 }}>
            <strong>Webhook Setup:</strong> Configure <code>https://akshaykotish.com/api/razorpay/webhook</code> in your Razorpay Dashboard &rarr; Settings &rarr; Webhooks. Select events: <code>payment.captured</code>, <code>payment_link.paid</code>.
          </div>
        </div>
      )}
    </div>
  );
}
