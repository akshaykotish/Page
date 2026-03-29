import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  query,
  orderBy,
  Timestamp
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';
import { formatCurrency, formatDate, getStatusColor, toInputDate } from '../utils/formatters';
import { calculateGST, GST_RATES, STATES, numberToWords, isValidGSTIN } from '../utils/gst';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const FALLBACK_COMPANY = {
  name: 'Akshay Kotish & Co.',
  legalName: 'Akshay Lakshay Kotish Private Limited',
  cin: 'U72900HR2022PTC101170',
  gstin: '06AAWCA4919K1Z3',
  pan: 'AAWCA4919K',
  state: 'Haryana',
  stateCode: '06',
  address: 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027',
  email: 'akshaykotish@gmail.com',
  phone: '+91 98967 70369',
  website: 'www.akshaykotish.com',
};

const FOOTER_TEMPLATES = {
  standard: 'Thank you for your business.\nThis is a computer-generated invoice.',
  professional: 'Thank you for choosing {companyName}.\nPayment is due within the specified terms. Late payments may be subject to interest charges.\nFor queries, contact us at {email}.',
  minimal: '{companyName} | {email} | {phone}',
  detailed: 'Thank you for your business with {companyName}.\nPlease make payment to the bank account details mentioned above within the due date.\nFor any discrepancies, please notify us within 7 days of receipt.\nThis is a computer-generated invoice and does not require physical signature.\nContact: {email} | {phone} | {website}',
  custom: '',
};

const STATUS_TABS = ['all', 'draft', 'sent', 'paid', 'overdue'];

const emptyLineItem = () => ({
  id: Date.now(),
  description: '',
  qty: 1,
  rate: 0,
  gstRate: 18
});

const emptyForm = () => ({
  customerName: '',
  customerEmail: '',
  customerGstin: '',
  customerAddress: '',
  customerState: '',
  items: [emptyLineItem()],
  notes: '',
  dueDate: '',
  showBankDetails: true,
  showTerms: true,
  showStamp: true,
});

// ──────────────────────────────────────────────
//  Styles
// ──────────────────────────────────────────────

const s = {
  page: { display: 'flex', flexDirection: 'column', gap: '24px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' },
  tabs: { display: 'flex', gap: '4px', background: '#f1f5f9', borderRadius: '8px', padding: '4px' },
  tab: (active) => ({
    padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer',
    fontWeight: 500, fontSize: '13px', textTransform: 'capitalize',
    background: active ? '#fff' : 'transparent', color: active ? '#1e293b' : '#64748b',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.2s'
  }),
  btnPrimary: {
    padding: '10px 20px', background: '#1e293b', color: '#fff', border: 'none',
    borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '6px'
  },
  btnSecondary: {
    padding: '8px 16px', background: '#f1f5f9', color: '#475569',
    border: '1px solid #e2e8f0', borderRadius: '8px', fontWeight: 500, fontSize: '13px', cursor: 'pointer'
  },
  btnDanger: {
    padding: '6px 12px', background: '#fef2f2', color: '#dc2626',
    border: '1px solid #fecaca', borderRadius: '6px', fontWeight: 500, fontSize: '12px', cursor: 'pointer'
  },
  btnSuccess: {
    padding: '6px 12px', background: '#f0fdf4', color: '#16a34a',
    border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: 500, fontSize: '12px', cursor: 'pointer'
  },
  btnSmall: {
    padding: '6px 12px', background: '#f8fafc', color: '#475569',
    border: '1px solid #e2e8f0', borderRadius: '6px', fontWeight: 500, fontSize: '12px', cursor: 'pointer'
  },
  card: { background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' },
  cardHeader: {
    padding: '20px 24px', borderBottom: '1px solid #f1f5f9',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  cardTitle: { fontSize: '16px', fontWeight: 600, color: '#1e293b', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '1px solid #f1f5f9', background: '#f8fafc'
  },
  td: { padding: '14px 16px', fontSize: '14px', color: '#334155', borderBottom: '1px solid #f1f5f9' },
  badge: (color) => ({
    display: 'inline-block', padding: '4px 10px', borderRadius: '20px',
    fontSize: '12px', fontWeight: 600, color: color, background: color + '18', textTransform: 'capitalize'
  }),
  actions: { display: 'flex', gap: '6px', alignItems: 'center' },
  formSection: { padding: '24px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' },
  formTitle: { fontSize: '18px', fontWeight: 700, color: '#1e293b', marginBottom: '20px', margin: 0 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '13px', fontWeight: 600, color: '#475569' },
  input: {
    padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '8px',
    fontSize: '14px', color: '#1e293b', outline: 'none', transition: 'border 0.2s', fontFamily: 'inherit'
  },
  select: {
    padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '8px',
    fontSize: '14px', color: '#1e293b', outline: 'none', background: '#fff', fontFamily: 'inherit'
  },
  textarea: {
    padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '8px',
    fontSize: '14px', color: '#1e293b', outline: 'none', fontFamily: 'inherit',
    minHeight: '80px', resize: 'vertical'
  },
  lineItemRow: {
    display: 'grid', gridTemplateColumns: '2fr 80px 120px 100px 120px 40px',
    gap: '8px', alignItems: 'center', marginBottom: '8px'
  },
  lineItemHeader: {
    display: 'grid', gridTemplateColumns: '2fr 80px 120px 100px 120px 40px',
    gap: '8px', marginBottom: '8px'
  },
  lineLabel: { fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  summaryBox: {
    marginTop: '20px', padding: '20px', background: '#f8fafc',
    borderRadius: '8px', display: 'flex', justifyContent: 'flex-end'
  },
  summaryTable: { minWidth: '280px' },
  summaryRow: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '14px', color: '#475569' },
  summaryTotal: {
    display: 'flex', justifyContent: 'space-between', padding: '10px 0 0',
    fontSize: '16px', fontWeight: 700, color: '#1e293b',
    borderTop: '2px solid #e2e8f0', marginTop: '6px'
  },
  formActions: {
    display: 'flex', justifyContent: 'flex-end', gap: '12px',
    marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #f1f5f9'
  },
  empty: { padding: '60px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' },
  removeBtn: {
    width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid #fecaca', borderRadius: '6px', background: '#fef2f2',
    color: '#dc2626', cursor: 'pointer', fontSize: '16px', fontWeight: 700, lineHeight: 1
  },
  interstateBanner: { padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, marginBottom: '12px' },
  toggleRow: {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0'
  },
  toggleSwitch: (on) => ({
    width: 38, height: 20, borderRadius: 10, border: 'none',
    background: on ? '#16a34a' : '#d1d5db', cursor: 'pointer',
    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
  }),
  toggleKnob: (on) => ({
    position: 'absolute', top: 2, left: on ? 20 : 2,
    width: 16, height: 16, borderRadius: '50%', background: '#fff',
    transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
  }),
  errorMessage: {
    padding: '12px 16px', background: '#fef2f2', color: '#dc2626',
    border: '1px solid #fecaca', borderRadius: '8px', fontSize: '14px', marginBottom: '12px'
  }
};

// ──────────────────────────────────────────────
//  Print Preview Styles
// ──────────────────────────────────────────────

const printStyles = `
@media print {
  @page { size: A4; margin: 15mm 20mm; }
  body * { visibility: hidden; }
  #invoice-print-area, #invoice-print-area * { visibility: visible; }
  #invoice-print-area {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 0;
    background: #fff;
  }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export default function Billing() {
  const { user } = useAuth();
  const printRef = useRef(null);

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const [actionLoading, setActionLoading] = useState({});

  // Company & bill profile settings
  const [companyProfile, setCompanyProfile] = useState(FALLBACK_COMPANY);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [billProfile, setBillProfile] = useState(null);

  // ── Load invoices & settings ──
  useEffect(() => {
    const abortController = new AbortController();
    loadInvoices();
    loadCompanySettings();
    return () => abortController.abort();
  }, []);

  async function loadCompanySettings() {
    try {
      const [companySnap, bankSnap, profileSnap] = await Promise.all([
        getDoc(doc(db, 'settings', 'company')),
        getDoc(doc(db, 'settings', 'bank_accounts')),
        getDoc(doc(db, 'settings', 'bill_profile')),
      ]);
      if (companySnap.exists()) setCompanyProfile({ ...FALLBACK_COMPANY, ...companySnap.data() });
      if (bankSnap.exists()) setBankAccounts(bankSnap.data().accounts || []);
      if (profileSnap.exists()) setBillProfile(profileSnap.data());
    } catch (err) {
      console.error('Error loading company settings:', err);
    }
  }

  async function loadInvoices() {
    setLoading(true);
    setLoadError(null);
    try {
      const q = query(collection(db, 'invoices'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate?.() || new Date(),
        dueDate: d.data().dueDate?.toDate?.() || null
      }));
      setInvoices(list);
    } catch (err) {
      console.error('Error loading invoices:', err);
      setLoadError('Failed to load invoices. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Filter ──
  const filtered = activeTab === 'all'
    ? invoices
    : invoices.filter(inv => inv.status === activeTab);

  // ── GST calculations for form ──
  const isInterstate = form.customerState && form.customerState !== companyProfile.state;
  const gstResult = calculateGST(form.items, isInterstate);

  // ── Form handlers ──
  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    setFormError(null);
  }

  function updateLineItem(index, field, value) {
    setForm(prev => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: field === 'description' ? value : Number(value) || 0 };
      return { ...prev, items };
    });
  }

  function addLineItem() {
    setForm(prev => ({ ...prev, items: [...prev.items, emptyLineItem()] }));
  }

  function removeLineItem(index) {
    if (form.items.length <= 1) return;
    setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  }

  // ── Generate invoice number ──
  function generateInvoiceNumber() {
    const now = new Date();
    const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const seq = String(invoices.length + 1).padStart(4, '0');
    return `ALKPL/${fy}-${fy + 1}/${seq}`;
  }

  // ── Validate invoice form ──
  function validateInvoiceForm() {
    if (!form.customerName.trim()) {
      setFormError('Customer name is required.');
      return false;
    }
    if (!form.customerState) {
      setFormError('Customer state is required.');
      return false;
    }
    if (form.items.some(it => !it.description.trim())) {
      setFormError('All line items must have a description.');
      return false;
    }
    if (form.items.some(it => it.qty <= 0)) {
      setFormError('Quantity must be greater than zero.');
      return false;
    }
    if (form.items.some(it => it.rate <= 0)) {
      setFormError('Rate must be greater than zero.');
      return false;
    }
    return true;
  }

  // ── Save invoice ──
  async function handleSave(e) {
    e.preventDefault();
    if (!validateInvoiceForm()) return;

    setSaving(true);
    setFormError(null);
    try {
      const invoiceNumber = generateInvoiceNumber();
      const gst = calculateGST(form.items, isInterstate);

      const invoiceData = {
        invoiceNumber,
        customer: {
          name: form.customerName.trim(),
          email: form.customerEmail.trim(),
          gstin: form.customerGstin.trim(),
          address: form.customerAddress.trim(),
          state: form.customerState
        },
        items: gst.items,
        subtotal: gst.subtotal,
        cgst: gst.cgst,
        sgst: gst.sgst,
        igst: gst.igst,
        totalTax: gst.totalTax,
        total: gst.total,
        isInterstate,
        notes: form.notes.trim(),
        showBankDetails: form.showBankDetails,
        showTerms: form.showTerms,
        showStamp: form.showStamp,
        status: 'draft',
        dueDate: form.dueDate ? Timestamp.fromDate(new Date(form.dueDate)) : null,
        createdAt: Timestamp.now(),
        createdBy: user?.email || 'unknown'
      };

      await addDoc(collection(db, 'invoices'), invoiceData);
      setForm(emptyForm());
      setShowForm(false);
      setFormError(null);
      await loadInvoices();
    } catch (err) {
      console.error('Error saving invoice:', err);
      setFormError('Failed to save invoice. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function markAsPaid(id) {
    setActionLoading(prev => ({ ...prev, [id]: 'paid' }));
    try {
      await updateDoc(doc(db, 'invoices', id), { status: 'paid', paidAt: Timestamp.now() });
      await loadInvoices();
    } catch (err) {
      console.error('Error updating invoice:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }));
    }
  }

  async function markAsSent(id) {
    setActionLoading(prev => ({ ...prev, [id]: 'sent' }));
    try {
      await updateDoc(doc(db, 'invoices', id), { status: 'sent' });
      await loadInvoices();
    } catch (err) {
      console.error('Error updating invoice:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }));
    }
  }

  async function emailInvoice(id) {
    setActionLoading(prev => ({ ...prev, [id]: 'email' }));
    try {
      const result = await api.post(`/billing/invoices/${id}/send-email`, {});
      alert(result.message || 'Invoice emailed successfully');
    } catch (err) {
      alert('Failed to email: ' + (err.message || 'Unknown error'));
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }));
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Are you sure you want to delete this invoice?')) return;
    setActionLoading(prev => ({ ...prev, [id]: 'delete' }));
    try {
      await deleteDoc(doc(db, 'invoices', id));
      await loadInvoices();
    } catch (err) {
      console.error('Error deleting invoice:', err);
      alert('Failed to delete invoice. Please try again.');
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }));
    }
  }

  function handlePrint(invoice) {
    setPreviewInvoice(invoice);
    setTimeout(() => window.print(), 300);
  }

  async function exportPDF(invoice) {
    setPreviewInvoice(invoice);
    await new Promise(r => setTimeout(r, 500));

    const element = document.getElementById('invoice-print-area');
    if (!element) return;

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 794,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * pageW) / canvas.width;

    if (imgH <= pageH) {
      pdf.addImage(imgData, 'JPEG', 0, 0, imgW, imgH);
    } else {
      let yOffset = 0;
      while (yOffset < imgH) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -yOffset, imgW, imgH);
        yOffset += pageH;
      }
    }

    const fileName = `${(invoice.invoiceNumber || 'Invoice').replace(/\//g, '-')}.pdf`;
    pdf.save(fileName);
    return { blob: pdf.output('blob'), fileName };
  }

  async function emailPDF(invoice) {
    if (!invoice.customer?.email) {
      alert('No customer email found');
      return;
    }

    setActionLoading(prev => ({ ...prev, [invoice.id]: 'emailPDF' }));
    try {
      setPreviewInvoice(invoice);
      await new Promise(r => setTimeout(r, 500));

      const element = document.getElementById('invoice-print-area');
      if (!element) {
        throw new Error('Invoice preview not found');
      }

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: 794,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * pageW) / canvas.width;

      if (imgH <= pageH) {
        pdf.addImage(imgData, 'JPEG', 0, 0, imgW, imgH);
      } else {
        let yOffset = 0;
        while (yOffset < imgH) {
          if (yOffset > 0) pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 0, -yOffset, imgW, imgH);
          yOffset += pageH;
        }
      }

      const pdfBase64 = pdf.output('datauristring').split(',')[1];

      await api.post('/billing/invoices/' + invoice.id + '/send-email', {
        reason: invoice.status === 'paid' ? 'payment_received' : 'invoice_sent',
        pdfBase64,
        fileName: `${(invoice.invoiceNumber || 'Invoice').replace(/\//g, '-')}.pdf`,
      });
      alert('Invoice PDF emailed to ' + invoice.customer.email);
    } catch (err) {
      console.error('Error emailing PDF:', err);
      alert('Failed to email: ' + (err.message || 'Unknown error'));
    } finally {
      setActionLoading(prev => ({ ...prev, [invoice.id]: null }));
    }
  }

  // ──────────────────────────────────────────────
  //  Render
  // ──────────────────────────────────────────────

  return (
    <div style={s.page}>
      <style>{printStyles}</style>

      {/* Top Bar */}
      <div style={s.topBar}>
        <div style={s.tabs}>
          {STATUS_TABS.map(tab => (
            <button key={tab} style={s.tab(activeTab === tab)} onClick={() => setActiveTab(tab)}>
              {tab}
              {tab !== 'all' && (
                <span style={{ marginLeft: '6px', opacity: 0.6 }}>
                  ({invoices.filter(i => tab === 'all' ? true : i.status === tab).length})
                </span>
              )}
            </button>
          ))}
        </div>
        <button style={s.btnPrimary} onClick={() => { setShowForm(!showForm); setPreviewInvoice(null); }}>
          {showForm ? 'Cancel' : '+ New Invoice'}
        </button>
      </div>

      {/* ── Invoice Form ── */}
      {showForm && (
        <div style={s.formSection}>
          <h3 style={{ ...s.formTitle, marginBottom: '20px' }}>Create New Invoice</h3>
          {formError && <div style={s.errorMessage}>{formError}</div>}
          <form onSubmit={handleSave}>
            {/* Customer Details */}
            <div style={{ marginBottom: '8px' }}>
              <span style={{ ...s.label, fontSize: '14px', color: '#1e293b' }}>Customer Details</span>
            </div>
            <div style={s.formGrid}>
              <div style={s.formGroup}>
                <label style={s.label}>Customer Name *</label>
                <input style={s.input} value={form.customerName} onChange={e => updateForm('customerName', e.target.value)} placeholder="Business / Individual name" required />
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Email</label>
                <input style={s.input} type="email" value={form.customerEmail} onChange={e => updateForm('customerEmail', e.target.value)} placeholder="customer@example.com" />
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>GSTIN</label>
                <input
                  style={{ ...s.input, borderColor: form.customerGstin && !isValidGSTIN(form.customerGstin) ? '#ef4444' : '#e2e8f0' }}
                  value={form.customerGstin}
                  onChange={e => updateForm('customerGstin', e.target.value.toUpperCase())}
                  placeholder="22AAAAA0000A1Z5" maxLength={15}
                />
                {form.customerGstin && !isValidGSTIN(form.customerGstin) && (
                  <span style={{ fontSize: '11px', color: '#ef4444' }}>Invalid GSTIN format</span>
                )}
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>State *</label>
                <select style={s.select} value={form.customerState} onChange={e => updateForm('customerState', e.target.value)} required>
                  <option value="">Select State</option>
                  {STATES.map(st => <option key={st.code} value={st.name}>{st.name}</option>)}
                </select>
              </div>
              <div style={{ ...s.formGroup, gridColumn: 'span 2' }}>
                <label style={s.label}>Address</label>
                <input style={s.input} value={form.customerAddress} onChange={e => updateForm('customerAddress', e.target.value)} placeholder="Full billing address" />
              </div>
            </div>

            {/* Interstate Banner */}
            {form.customerState && (
              <div style={{
                ...s.interstateBanner,
                background: isInterstate ? '#fef3c7' : '#ecfdf5',
                color: isInterstate ? '#92400e' : '#065f46',
                border: `1px solid ${isInterstate ? '#fde68a' : '#a7f3d0'}`
              }}>
                {isInterstate
                  ? `Interstate supply: IGST will be charged (${form.customerState} -> ${companyProfile.state})`
                  : `Intrastate supply: CGST + SGST will be charged (${companyProfile.state})`
                }
              </div>
            )}

            {/* Line Items */}
            <div style={{ marginBottom: '8px', marginTop: '20px' }}>
              <span style={{ ...s.label, fontSize: '14px', color: '#1e293b' }}>Line Items</span>
            </div>
            <div style={s.lineItemHeader}>
              <span style={s.lineLabel}>Description</span>
              <span style={s.lineLabel}>Qty</span>
              <span style={s.lineLabel}>Rate</span>
              <span style={s.lineLabel}>GST %</span>
              <span style={s.lineLabel}>Amount</span>
              <span></span>
            </div>
            {form.items.map((item, idx) => (
              <div key={item.id} style={s.lineItemRow}>
                <input style={s.input} value={item.description} onChange={e => updateLineItem(idx, 'description', e.target.value)} placeholder="Item description" required />
                <input style={{ ...s.input, textAlign: 'center' }} type="number" min="1" value={item.qty} onChange={e => updateLineItem(idx, 'qty', e.target.value)} />
                <input style={{ ...s.input, textAlign: 'right' }} type="number" min="0" step="0.01" value={item.rate} onChange={e => updateLineItem(idx, 'rate', e.target.value)} />
                <select style={s.select} value={item.gstRate} onChange={e => updateLineItem(idx, 'gstRate', e.target.value)}>
                  {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                </select>
                <div style={{ padding: '10px 12px', fontWeight: 600, color: '#1e293b', textAlign: 'right' }}>
                  {formatCurrency(item.qty * item.rate)}
                </div>
                <button type="button" style={s.removeBtn} onClick={() => removeLineItem(idx)} title="Remove item">&times;</button>
              </div>
            ))}
            <button type="button" style={{ ...s.btnSecondary, marginTop: '8px' }} onClick={addLineItem}>
              + Add Line Item
            </button>

            {/* Summary */}
            <div style={s.summaryBox}>
              <div style={s.summaryTable}>
                <div style={s.summaryRow}>
                  <span>Subtotal</span>
                  <span style={{ fontWeight: 600 }}>{formatCurrency(gstResult.subtotal)}</span>
                </div>
                {isInterstate ? (
                  <div style={s.summaryRow}>
                    <span>IGST</span>
                    <span style={{ fontWeight: 600 }}>{formatCurrency(gstResult.igst)}</span>
                  </div>
                ) : (
                  <>
                    <div style={s.summaryRow}>
                      <span>CGST</span>
                      <span style={{ fontWeight: 600 }}>{formatCurrency(gstResult.cgst)}</span>
                    </div>
                    <div style={s.summaryRow}>
                      <span>SGST</span>
                      <span style={{ fontWeight: 600 }}>{formatCurrency(gstResult.sgst)}</span>
                    </div>
                  </>
                )}
                <div style={s.summaryTotal}>
                  <span>Total</span>
                  <span>{formatCurrency(gstResult.total)}</span>
                </div>
              </div>
            </div>

            {/* Notes & Due Date */}
            <div style={{ ...s.formGrid, gridTemplateColumns: '2fr 1fr', marginTop: '20px' }}>
              <div style={s.formGroup}>
                <label style={s.label}>Notes</label>
                <textarea style={s.textarea} value={form.notes} onChange={e => updateForm('notes', e.target.value)} placeholder="Payment terms, bank details, etc." />
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Due Date</label>
                <input style={s.input} type="date" value={form.dueDate} onChange={e => updateForm('dueDate', e.target.value)} />
              </div>
            </div>

            {/* Invoice Options - Toggle sections */}
            <div style={{ marginTop: '20px', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <span style={{ ...s.label, fontSize: '14px', color: '#1e293b', marginBottom: '12px', display: 'block' }}>Invoice Sections</span>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <div style={s.toggleRow}>
                  <button type="button" style={s.toggleSwitch(form.showBankDetails)} onClick={() => updateForm('showBankDetails', !form.showBankDetails)}>
                    <span style={s.toggleKnob(form.showBankDetails)} />
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Bank Details</span>
                </div>
                <div style={s.toggleRow}>
                  <button type="button" style={s.toggleSwitch(form.showTerms)} onClick={() => updateForm('showTerms', !form.showTerms)}>
                    <span style={s.toggleKnob(form.showTerms)} />
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Terms & Conditions</span>
                </div>
                <div style={s.toggleRow}>
                  <button type="button" style={s.toggleSwitch(form.showStamp)} onClick={() => updateForm('showStamp', !form.showStamp)}>
                    <span style={s.toggleKnob(form.showStamp)} />
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Official Stamp</span>
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div style={s.formActions}>
              <button type="button" style={s.btnSecondary} onClick={() => { setShowForm(false); setForm(emptyForm()); }} disabled={saving}>Cancel</button>
              <button type="submit" style={s.btnPrimary} disabled={saving}>{saving ? 'Saving...' : 'Save Invoice'}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Invoice Table ── */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h3 style={s.cardTitle}>
            Invoices
            <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: '8px' }}>({filtered.length})</span>
          </h3>
        </div>
        {loadError && <div style={s.errorMessage}>{loadError}</div>}
        {loading ? (
          <div style={s.empty}>Loading invoices...</div>
        ) : filtered.length === 0 ? (
          <div style={s.empty}>
            No {activeTab !== 'all' ? activeTab : ''} invoices found. Create your first invoice above.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Invoice #</th>
                  <th style={s.th}>Customer</th>
                  <th style={s.th}>Date</th>
                  <th style={s.th}>Amount</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const statusColor = getStatusColor(inv.status);
                  return (
                    <tr key={inv.id} style={{ transition: 'background 0.15s' }}>
                      <td style={{ ...s.td, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", fontSize: '13px' }}>
                        {inv.invoiceNumber || '---'}
                      </td>
                      <td style={s.td}>
                        <div style={{ fontWeight: 500 }}>{inv.customer?.name || '---'}</div>
                        {inv.customer?.email && <div style={{ fontSize: '12px', color: '#94a3b8' }}>{inv.customer.email}</div>}
                      </td>
                      <td style={s.td}>{formatDate(inv.createdAt)}</td>
                      <td style={{ ...s.td, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatCurrency(inv.total)}
                      </td>
                      <td style={s.td}><span style={s.badge(statusColor)}>{inv.status}</span></td>
                      <td style={s.td}>
                        <div style={s.actions}>
                          <button style={s.btnSmall} onClick={() => { setPreviewInvoice(inv); setShowForm(false); }} title="Preview">Preview</button>
                          {inv.status === 'draft' && <button style={s.btnSuccess} onClick={() => markAsSent(inv.id)} disabled={actionLoading[inv.id]} title="Mark as Sent">{actionLoading[inv.id] === 'sent' ? 'Sending...' : 'Send'}</button>}
                          {(inv.status === 'draft' || inv.status === 'sent' || inv.status === 'overdue') && (
                            <button style={s.btnSuccess} onClick={() => markAsPaid(inv.id)} disabled={actionLoading[inv.id]} title="Mark as Paid">{actionLoading[inv.id] === 'paid' ? 'Updating...' : 'Paid'}</button>
                          )}
                          {inv.customer?.email && (
                            <button style={{ ...s.btnSmall, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }} onClick={() => emailInvoice(inv.id)} disabled={actionLoading[inv.id]} title="Email Invoice">{actionLoading[inv.id] === 'email' ? 'Sending...' : 'Email'}</button>
                          )}
                          <button style={{ ...s.btnSmall, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }} onClick={() => exportPDF(inv)} title="Export PDF">Export PDF</button>
                          <button style={s.btnDanger} onClick={() => handleDelete(inv.id)} disabled={actionLoading[inv.id]} title="Delete">{actionLoading[inv.id] === 'delete' ? 'Deleting...' : 'Delete'}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Invoice Preview ── */}
      {previewInvoice && (
        <div style={s.card}>
          <div style={s.cardHeader}>
            <h3 style={s.cardTitle}>Invoice Preview</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={s.btnPrimary} onClick={() => handlePrint(previewInvoice)}>Print Invoice</button>
              <button style={{ ...s.btnPrimary, background: '#2563eb' }} onClick={() => exportPDF(previewInvoice)}>Export PDF</button>
              <button style={{ ...s.btnPrimary, background: '#16a34a' }} onClick={() => emailPDF(previewInvoice)} disabled={actionLoading[previewInvoice.id]}>{actionLoading[previewInvoice.id] === 'emailPDF' ? 'Sending...' : 'Email PDF'}</button>
              <button style={s.btnSecondary} onClick={() => setPreviewInvoice(null)}>Close</button>
            </div>
          </div>
          <div id="invoice-print-area" ref={printRef} style={{ padding: '24px' }}>
            <InvoiceTemplate
              invoice={previewInvoice}
              company={companyProfile}
              bankAccounts={bankAccounts}
              billProfile={billProfile}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
//  Invoice Template for Print / Preview
// ──────────────────────────────────────────────

function InvoiceTemplate({ invoice, company, bankAccounts, billProfile }) {
  const COMPANY = company || FALLBACK_COMPANY;
  const profile = billProfile || {};
  const sections = profile.sections || [];
  const showBankDetails = invoice.showBankDetails !== false;
  const showTerms = invoice.showTerms !== false;
  const showStamp = invoice.showStamp !== false;

  function isSectionVisible(sectionId) {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return true;
    return section.visible;
  }

  function getFooterText() {
    const templateId = profile.footerTemplate || 'standard';
    let text = FOOTER_TEMPLATES[templateId] || FOOTER_TEMPLATES.standard;
    if (templateId === 'custom') text = profile.customFooterText || '';
    return text
      .replace(/{companyName}/g, COMPANY.name || '')
      .replace(/{email}/g, COMPANY.email || '')
      .replace(/{phone}/g, COMPANY.phone || '')
      .replace(/{website}/g, COMPANY.website || '');
  }

  // Build ordered sections
  const orderedSections = sections.length > 0
    ? sections.filter(sec => sec.visible)
    : [
        { id: 'companyHeader' }, { id: 'billTo' }, { id: 'lineItems' },
        { id: 'summary' }, { id: 'amountWords' }, { id: 'bankDetails' },
        { id: 'termsConditions' }, { id: 'customTexts' }, { id: 'stamp' }, { id: 'footer' },
      ];

  const t = {
    container: { fontFamily: "'Inter', sans-serif", color: '#1e293b', maxWidth: '800px', margin: '0 auto', lineHeight: 1.5, fontSize: '12px' },
    header: {
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      marginBottom: '16px', paddingBottom: '12px', borderBottom: '3px solid #1e293b'
    },
    companyName: { fontSize: '20px', fontWeight: 800, fontFamily: "'Playfair Display', serif", color: '#1e293b', margin: 0 },
    companyDetails: { fontSize: '10px', color: '#64748b', marginTop: '2px', lineHeight: 1.6 },
    invoiceTitle: { fontSize: '26px', fontWeight: 800, color: '#1e293b', textAlign: 'right', fontFamily: "'Playfair Display', serif" },
    invoiceMeta: { fontSize: '11px', color: '#64748b', textAlign: 'right', marginTop: '2px' },
    section: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '14px' },
    sectionLabel: { fontSize: '9px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' },
    table: { width: '100%', borderCollapse: 'collapse', marginBottom: '10px' },
    th: { padding: '6px 10px', textAlign: 'left', fontSize: '9px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' },
    thRight: { padding: '6px 10px', textAlign: 'right', fontSize: '9px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' },
    td: { padding: '6px 10px', fontSize: '11px', color: '#334155', borderBottom: '1px solid #f1f5f9' },
    tdRight: { padding: '6px 10px', fontSize: '11px', color: '#334155', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" },
    summaryContainer: { display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' },
    summaryBlock: { minWidth: '240px' },
    summaryRow: { display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '11px', color: '#64748b' },
    totalRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', fontSize: '15px', fontWeight: 800, color: '#1e293b', borderTop: '2px solid #1e293b', marginTop: '4px' },
    amountWords: { fontSize: '10px', color: '#64748b', fontStyle: 'italic', marginBottom: '10px', padding: '8px 12px', background: '#f8fafc', borderRadius: '4px' },
    bankSection: { marginBottom: '10px', padding: '10px 14px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' },
    termsSection: { marginBottom: '10px', padding: '10px 14px', background: '#fffbeb', borderRadius: '6px', border: '1px solid #fde68a' },
    stampSection: { display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: '20px', marginBottom: '10px', pageBreakInside: 'avoid' },
    footer: { marginTop: '16px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '10px', color: '#94a3b8', lineHeight: 1.6 },
  };

  const items = invoice.items || [];
  const customer = invoice.customer || {};
  const defaultBank = (bankAccounts || []).find(a => a.isDefault) || (bankAccounts || [])[0];

  // Render a section by ID
  function renderSection(sectionId) {
    switch (sectionId) {
      case 'companyHeader':
        return (
          <div key="companyHeader" style={t.header}>
            <div>
              <h1 style={t.companyName}>{COMPANY.name}</h1>
              {COMPANY.legalName && <div style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic', marginTop: '2px' }}>{COMPANY.legalName}</div>}
              <div style={t.companyDetails}>
                GSTIN: {COMPANY.gstin}<br />
                {COMPANY.cin && <>CIN: {COMPANY.cin}<br /></>}
                {COMPANY.pan && <>PAN: {COMPANY.pan}<br /></>}
                {COMPANY.address}<br />
                {COMPANY.email}
                {COMPANY.phone && <> | {COMPANY.phone}</>}
                {COMPANY.website && <><br />{COMPANY.website}</>}
              </div>
            </div>
            <div>
              <div style={t.invoiceTitle}>INVOICE</div>
              <div style={t.invoiceMeta}>
                <strong>{invoice.invoiceNumber}</strong><br />
                Date: {formatDate(invoice.createdAt)}<br />
                {invoice.dueDate && <>Due: {formatDate(invoice.dueDate)}<br /></>}
                Status: <span style={{ textTransform: 'capitalize', fontWeight: 600, color: getStatusColor(invoice.status) }}>
                  {invoice.status}
                </span>
              </div>
            </div>
          </div>
        );

      case 'billTo':
        return (
          <div key="billTo" style={t.section}>
            <div>
              <div style={t.sectionLabel}>Bill To</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>{customer.name || '---'}</div>
              {customer.gstin && <div style={{ fontSize: '12px', color: '#64748b' }}>GSTIN: {customer.gstin}</div>}
              {customer.address && <div style={{ fontSize: '13px', color: '#475569' }}>{customer.address}</div>}
              {customer.state && <div style={{ fontSize: '13px', color: '#475569' }}>{customer.state}</div>}
              {customer.email && <div style={{ fontSize: '12px', color: '#94a3b8' }}>{customer.email}</div>}
            </div>
            <div>
              <div style={t.sectionLabel}>Supply Type</div>
              <div style={{ fontSize: '13px', color: '#475569' }}>
                {invoice.isInterstate ? 'Interstate (IGST)' : 'Intrastate (CGST + SGST)'}
              </div>
              <div style={{ ...t.sectionLabel, marginTop: '16px' }}>Place of Supply</div>
              <div style={{ fontSize: '13px', color: '#475569' }}>{customer.state || COMPANY.state}</div>
            </div>
          </div>
        );

      case 'lineItems':
        return (
          <table key="lineItems" style={t.table}>
            <thead>
              <tr>
                <th style={{ ...t.th, width: '30px' }}>#</th>
                <th style={t.th}>Description</th>
                <th style={t.thRight}>Qty</th>
                <th style={t.thRight}>Rate</th>
                <th style={t.thRight}>GST %</th>
                {invoice.isInterstate ? (
                  <th style={t.thRight}>IGST</th>
                ) : (
                  <>
                    <th style={t.thRight}>CGST</th>
                    <th style={t.thRight}>SGST</th>
                  </>
                )}
                <th style={t.thRight}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const lineAmount = (item.qty || 0) * (item.rate || 0);
                const lineGstRate = item.gstRate || 18;
                const lineGstAmount = lineAmount * (lineGstRate / 100);
                const lineCgst = item.cgst || (invoice.isInterstate ? 0 : lineGstAmount / 2);
                const lineSgst = item.sgst || (invoice.isInterstate ? 0 : lineGstAmount / 2);
                const lineIgst = item.igst || (invoice.isInterstate ? lineGstAmount : 0);
                const lineTotal = lineAmount + (invoice.isInterstate ? lineIgst : lineCgst + lineSgst);

                return (
                  <tr key={idx}>
                    <td style={t.td}>{idx + 1}</td>
                    <td style={t.td}>{item.description}</td>
                    <td style={t.tdRight}>{item.qty}</td>
                    <td style={t.tdRight}>{formatCurrency(item.rate)}</td>
                    <td style={t.tdRight}>{lineGstRate}%</td>
                    {invoice.isInterstate ? (
                      <td style={t.tdRight}>{formatCurrency(lineIgst)}</td>
                    ) : (
                      <>
                        <td style={t.tdRight}>{formatCurrency(lineCgst)}</td>
                        <td style={t.tdRight}>{formatCurrency(lineSgst)}</td>
                      </>
                    )}
                    <td style={{ ...t.tdRight, fontWeight: 600 }}>{formatCurrency(lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );

      case 'summary': {
        const invSubtotal = invoice.subtotal || items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
        const invTotalTax = invoice.totalTax || invSubtotal * 0.18;
        const invCgst = invoice.cgst || (invoice.isInterstate ? 0 : invTotalTax / 2);
        const invSgst = invoice.sgst || (invoice.isInterstate ? 0 : invTotalTax / 2);
        const invIgst = invoice.igst || (invoice.isInterstate ? invTotalTax : 0);
        const invTotal = invoice.total || (invSubtotal + invCgst + invSgst + invIgst);

        return (
          <div key="summary" style={t.summaryContainer}>
            <div style={t.summaryBlock}>
              <div style={t.summaryRow}>
                <span>Subtotal</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(invSubtotal)}</span>
              </div>
              {invoice.isInterstate ? (
                <div style={t.summaryRow}>
                  <span>IGST</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(invIgst)}</span>
                </div>
              ) : (
                <>
                  <div style={t.summaryRow}>
                    <span>CGST</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(invCgst)}</span>
                  </div>
                  <div style={t.summaryRow}>
                    <span>SGST</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(invSgst)}</span>
                  </div>
                </>
              )}
              <div style={t.totalRow}>
                <span>Total</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(invTotal)}</span>
              </div>
            </div>
          </div>
        );
      }

      case 'amountWords':
        return (
          <div key="amountWords" style={t.amountWords}>
            <strong>Amount in words:</strong> {numberToWords(invoice.total || 0)}
          </div>
        );

      case 'bankDetails':
        if (!showBankDetails || !defaultBank) return null;
        return (
          <div key="bankDetails" style={t.bankSection}>
            <div style={{ ...t.sectionLabel, marginBottom: '10px', color: '#1e293b', fontSize: '12px', fontWeight: 800 }}>
              Bank Account Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
              <div><span style={{ color: '#64748b' }}>Bank Name:</span> <strong>{defaultBank.bankName}</strong></div>
              <div><span style={{ color: '#64748b' }}>Account Holder:</span> <strong>{defaultBank.accountHolder}</strong></div>
              <div><span style={{ color: '#64748b' }}>Account Number:</span> <strong style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px' }}>{defaultBank.accountNumber}</strong></div>
              <div><span style={{ color: '#64748b' }}>IFSC Code:</span> <strong style={{ fontFamily: "'JetBrains Mono', monospace" }}>{defaultBank.ifscCode}</strong></div>
              {defaultBank.branch && <div><span style={{ color: '#64748b' }}>Branch:</span> <strong>{defaultBank.branch}</strong></div>}
              {defaultBank.accountType && <div><span style={{ color: '#64748b' }}>Account Type:</span> <strong style={{ textTransform: 'capitalize' }}>{defaultBank.accountType}</strong></div>}
              {defaultBank.upiId && <div><span style={{ color: '#64748b' }}>UPI ID:</span> <strong>{defaultBank.upiId}</strong></div>}
            </div>
          </div>
        );

      case 'termsConditions':
        if (!showTerms) return null;
        const termsText = profile.termsAndConditions || 'Payment is due within the specified period.';
        return (
          <div key="termsConditions" style={t.termsSection}>
            <div style={{ ...t.sectionLabel, marginBottom: '8px', color: '#92400e', fontSize: '12px', fontWeight: 800 }}>
              Terms & Conditions
            </div>
            <div style={{ fontSize: '12px', color: '#78350f', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {termsText}
            </div>
          </div>
        );

      case 'customTexts':
        const customTexts = profile.customTexts || [];
        if (customTexts.length === 0) return null;
        return (
          <div key="customTexts">
            {customTexts.map((text, idx) => (
              <div key={text.id || idx} style={{ marginBottom: '16px' }}>
                {text.title && (
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.05em' }}>
                    {text.title}
                  </div>
                )}
                <div style={{ fontSize: '13px', color: '#475569', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {text.content}
                </div>
              </div>
            ))}
          </div>
        );

      case 'stamp':
        if (!showStamp) return null;
        const stampSrc = profile.stampImage || '/images/stamp1x_withborder.png';
        if (!stampSrc) return null;
        return (
          <div key="stamp" style={t.stampSection}>
            <div style={{ flex: 1 }}></div>
            <div style={{ textAlign: 'center' }}>
              <img
                src={stampSrc}
                alt="Official Stamp"
                style={{ width: '140px', height: '140px', objectFit: 'contain', marginBottom: '6px' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
              <div style={{
                marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #cbd5e1',
                fontSize: '12px', color: '#64748b', textAlign: 'center', minWidth: '240px'
              }}>
                Authorized Signatory<br />
                <strong style={{ color: '#1e293b' }}>{COMPANY.name}</strong>
              </div>
            </div>
          </div>
        );

      case 'footer':
        const footerText = getFooterText();
        return (
          <div key="footer" style={t.footer}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{footerText}</div>
          </div>
        );

      default:
        return null;
    }
  }

  // Notes (always rendered if present, right before ordered sections end)
  const notesSection = invoice.notes ? (
    <div key="notes" style={{ marginBottom: '24px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Notes</div>
      <div style={{ fontSize: '13px', color: '#475569', whiteSpace: 'pre-wrap' }}>{invoice.notes}</div>
    </div>
  ) : null;

  return (
    <div style={t.container}>
      {orderedSections.map(section => renderSection(section.id))}
      {notesSection}
    </div>
  );
}
