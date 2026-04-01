import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import DragPreview from '../components/DragPreview';

const TEMPLATE_TABS = [
  { key: 'doc_header', label: 'Doc Header' },
  { key: 'doc_footer', label: 'Doc Footer' },
  { key: 'inv_header', label: 'Inv Header' },
  { key: 'inv_footer', label: 'Inv Footer' },
];

const PAGE_SIZES = {
  A4: { w: 595, h: 842, label: 'A4', css: 'A4' },
  Letter: { w: 612, h: 792, label: 'Letter', css: 'letter' },
  Legal: { w: 612, h: 1008, label: 'Legal', css: 'legal' },
  A5: { w: 420, h: 595, label: 'A5', css: 'A5' },
};

const SAMPLE_BODY = `<div style="text-align:right;margin-bottom:16px;font-family:'Poppins',sans-serif;">
<div style="font-size:11px;color:#64748b;">Ref: SAMPLE/2026-03/001</div>
<div style="font-size:11px;font-weight:500;color:#1a1a1a;">Date: ##DATE##</div>
</div>
<p style="font-family:'Poppins',sans-serif;font-size:11px;margin-bottom:8px;"><strong>To,</strong></p>
<p style="font-family:'Poppins',sans-serif;font-size:11px;margin-bottom:14px;">The Manager<br>Sample Company Pvt. Ltd.<br>New Delhi, India</p>
<p style="font-family:'Poppins',sans-serif;font-size:12px;font-weight:700;text-decoration:underline;margin:14px 0;">Subject: Sample Document</p>
<p style="font-family:'Poppins',sans-serif;font-size:11px;line-height:1.7;margin-bottom:8px;">Dear Sir/Madam,</p>
<p style="font-family:'Poppins',sans-serif;font-size:11px;line-height:1.7;margin-bottom:8px;">This is a sample document to preview how your header and footer will appear on printed documents.</p>
<p style="font-family:'Poppins',sans-serif;font-size:11px;line-height:1.7;margin-bottom:8px;">Kindly acknowledge receipt and confirm at your earliest convenience.</p>
<div style="margin-top:36px;font-family:'Poppins',sans-serif;">
<p style="font-weight:600;font-size:11px;">Authorized Signatory</p>
</div>`;

const PROFILE_FIELDS = [
  { key: 'name', label: 'Company Name', required: true },
  { key: 'legalName', label: 'Legal Name', placeholder: 'e.g. XYZ Private Limited' },
  { key: 'legalLine', label: 'Legal Line', placeholder: 'e.g. A Brand of XYZ Pvt Ltd' },
  { key: 'tagline', label: 'Tagline', placeholder: 'e.g. Chartered Accountants' },
  { key: 'gstin', label: 'GSTIN' }, { key: 'cin', label: 'CIN' }, { key: 'pan', label: 'PAN' },
  { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'website', label: 'Website' },
  { key: 'state', label: 'State' }, { key: 'stateCode', label: 'State Code' },
  { key: 'address', label: 'Address', full: true },
];

const PREMADE_STAMPS = [
  { key: 'round_seal', label: 'Company Seal', color: '#1a3a6b', icon: '⊙' },
  { key: 'common_seal', label: 'Common Seal', color: '#1a3a6b', icon: '◎' },
  { key: 'approved', label: 'Approved', color: '#2e7d32', icon: '✓' },
  { key: 'paid', label: 'Paid', color: '#2e7d32', icon: '₹' },
  { key: 'received', label: 'Received', color: '#6366f1', icon: '↓' },
  { key: 'certified', label: 'Certified Copy', color: '#0d47a1', icon: '✦' },
  { key: 'original', label: 'Original', color: '#2e7d32', icon: '◆' },
  { key: 'duplicate', label: 'Duplicate', color: '#c0392b', icon: '◇' },
  { key: 'confidential', label: 'Confidential', color: '#c0392b', icon: '⊘' },
  { key: 'draft', label: 'Draft', color: '#94a3b8', icon: '◻' },
  { key: 'revenue', label: 'Revenue Stamp', color: '#8B4513', icon: '₹' },
];

const SIG_FONTS = [
  { name: 'Dancing Script', css: "'Dancing Script', cursive" },
  { name: 'Great Vibes', css: "'Great Vibes', cursive" },
  { name: 'Pacifico', css: "'Pacifico', cursive" },
  { name: 'Sacramento', css: "'Sacramento', cursive" },
  { name: 'Satisfy', css: "'Satisfy', cursive" },
  { name: 'Caveat', css: "'Caveat', cursive" },
];

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('profile');
  const [company, setCompany] = useState(null);
  const [form, setForm] = useState({});
  const [templates, setTemplates] = useState({});
  const [activeTemplate, setActiveTemplate] = useState('doc_header');
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [pageSize, setPageSize] = useState('A4');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(600);
  const saveTimerRef = useRef(null);
  const headerDragRef = useRef(null);
  const footerDragRef = useRef(null);
  const [dirty, setDirty] = useState(false);
  const [renderKey, setRenderKey] = useState(0);

  // Stamps & Signatures state
  const [stamps, setStamps] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [stampLoading, setStampLoading] = useState(false);
  const [sigMode, setSigMode] = useState('draw'); // draw | type | upload | dsc
  const [sigName, setSigName] = useState('');
  const [sigFont, setSigFont] = useState(SIG_FONTS[0].name);
  const [dscName, setDscName] = useState('');
  const [dscSerial, setDscSerial] = useState('');
  const [dscIssuer, setDscIssuer] = useState('eMudhra');
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const ps = PAGE_SIZES[pageSize];
  const pageScale = Math.min((showCode ? Math.min(containerW, 520) : Math.min(containerW, 660)) / ps.w, 1);
  const isFooter = activeTemplate.includes('footer');

  useEffect(() => { loadCompany(); measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, [id]);
  useEffect(() => { setCode(templates[activeTemplate] || ''); setShowCode(false); }, [activeTemplate, templates]);
  useEffect(() => { measure(); }, [showCode, tab]);
  useEffect(() => { if (tab === 'stamps' && company) loadStampsAndSignatures(); }, [tab, company]);

  function measure() { if (containerRef.current) setContainerW(containerRef.current.offsetWidth); }

  async function loadCompany() {
    setLoading(true);
    try {
      const [comp, tmpl] = await Promise.all([api.get(`/companies/${id}`), api.get(`/companies/${id}/templates`)]);
      setCompany(comp); setForm(comp); setTemplates(tmpl);
    } catch { setMsg('Failed to load company'); }
    setLoading(false);
  }

  async function loadStampsAndSignatures() {
    try {
      const [st, sg] = await Promise.all([
        api.get(`/stamps-signatures/${id}/stamps`),
        api.get(`/stamps-signatures/${id}/signatures`),
      ]);
      setStamps(Array.isArray(st) ? st : []);
      setSignatures(Array.isArray(sg) ? sg : []);
    } catch { /* may not exist yet */ }
  }

  async function saveProfile(e) {
    e.preventDefault(); setSaving(true); setMsg('');
    try {
      const res = await api.put(`/companies/${id}`, form);
      setCompany(res); setMsg('Profile saved!'); setTimeout(() => setMsg(''), 2500);
    } catch { setMsg('Failed to save profile'); }
    setSaving(false);
  }

  async function regenerateTemplates() {
    if (!confirm('Regenerate all templates from current profile? Custom edits will be lost.')) return;
    setSaving(true);
    try {
      const res = await api.post(`/companies/${id}/templates/regenerate`);
      setTemplates(res); setCode(res[activeTemplate]); setRenderKey(k => k + 1);
      setMsg('Templates regenerated!'); setTimeout(() => setMsg(''), 2500);
    } catch { setMsg('Failed to regenerate'); }
    setSaving(false);
  }

  async function saveTemplate(htmlOverride) {
    let htmlToSave = htmlOverride || code;
    if (!htmlOverride) {
      const dragRef = activeTemplate.includes('header') ? headerDragRef : footerDragRef;
      if (dragRef.current) htmlToSave = dragRef.current.getHtml();
    }
    if (!htmlToSave || htmlToSave.trim().length < 10) {
      setMsg('Nothing to save'); return;
    }
    setSaving(true); setMsg('');
    try {
      await api.put(`/companies/${id}/templates/${activeTemplate}`, { html: htmlToSave });
      setCode(htmlToSave);
      setTemplates(prev => ({ ...prev, [activeTemplate]: htmlToSave }));
      setDirty(false);
      setMsg('Saved!'); setTimeout(() => setMsg(''), 2000);
    } catch (err) { setMsg('Failed to save: ' + (err.message || '')); }
    setSaving(false);
  }

  async function resetTemplate() {
    if (!confirm('Reset this template to default?')) return;
    setSaving(true);
    try {
      const res = await api.post(`/companies/${id}/templates/${activeTemplate}/reset`);
      setCode(res.html); setTemplates(prev => ({ ...prev, [activeTemplate]: res.html }));
      setRenderKey(k => k + 1);
      setMsg('Reset!'); setTimeout(() => setMsg(''), 2500);
    } catch { setMsg('Failed to reset'); }
    setSaving(false);
  }

  async function aiGenerate() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true); setMsg('');
    try {
      const res = await api.post(`/companies/${id}/templates/ai-generate`, {
        templateKey: activeTemplate,
        prompt: aiPrompt,
      });
      const h = res?.html || '';
      if (h.includes('<') && h.length > 50 && (h.includes('table') || h.includes('div'))) {
        setCode(h);
        setTemplates(prev => ({ ...prev, [activeTemplate]: h }));
        setRenderKey(k => k + 1);
        setMsg('AI generated! Click Save to keep it.');
      } else {
        setMsg('AI response invalid. Try a different description.');
      }
    } catch (err) { setMsg('AI failed: ' + (err.message || '')); }
    setAiLoading(false); setTimeout(() => setMsg(''), 3000);
  }

  function printPreview() {
    const hdr = activeTemplate.includes('header') ? code : (templates[activeTemplate.replace('footer', 'header')] || '');
    const ftr = activeTemplate.includes('footer') ? code : (templates[activeTemplate.replace('header', 'footer')] || '');
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>Document</title><style>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap');
@page{size:${ps.css};margin:0}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Poppins',Arial,sans-serif;background:#fff;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:16mm 18mm 22mm 18mm}.ft{position:fixed;bottom:0;left:0;right:0;background:#fff;padding:0 18mm 10mm}
</style></head><body><div class="ft">${ftr}</div>${hdr}<div style="font-size:11pt;line-height:1.8;padding:16px 0 40px">${SAMPLE_BODY.replace('##DATE##', today)}</div>
<script>document.fonts.ready.then(()=>setTimeout(()=>window.print(),250))<\/script></body></html>`);
    w.document.close();
  }

  // ─── Stamps & Signatures Functions ─────────────────────────────────────

  async function addPremadeStamp(key, color) {
    setStampLoading(true); setMsg('');
    try {
      const res = await api.post(`/stamps-signatures/${id}/stamps/premade`, { key, color });
      setStamps(prev => [...prev, res]);
      setMsg('Stamp added!'); setTimeout(() => setMsg(''), 2000);
    } catch (err) { setMsg('Failed: ' + (err.message || '')); }
    setStampLoading(false);
  }

  async function uploadCustomStamp(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setStampLoading(true);
      try {
        const res = await api.post(`/stamps-signatures/${id}/stamps`, {
          name: file.name.replace(/\.[^.]+$/, ''),
          type: 'custom',
          data: reader.result,
        });
        setStamps(prev => [...prev, res]);
        setMsg('Custom stamp uploaded!'); setTimeout(() => setMsg(''), 2000);
      } catch (err) { setMsg('Upload failed: ' + (err.message || '')); }
      setStampLoading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function deleteStamp(stampId) {
    if (!confirm('Delete this stamp?')) return;
    try {
      await api.delete(`/stamps-signatures/${id}/stamps/${stampId}`);
      setStamps(prev => prev.filter(s => s.id !== stampId));
      setMsg('Stamp deleted'); setTimeout(() => setMsg(''), 2000);
    } catch { setMsg('Delete failed'); }
  }

  // Canvas drawing
  function initCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function startDraw(e) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
    ctx.beginPath();
    ctx.moveTo(x * (canvas.width / rect.width), y * (canvas.height / rect.height));
    setIsDrawing(true);
  }

  function draw(e) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
    ctx.lineTo(x * (canvas.width / rect.width), y * (canvas.height / rect.height));
    ctx.stroke();
    setHasDrawn(true);
  }

  function stopDraw() { setIsDrawing(false); }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function saveDrawnSignature() {
    if (!sigName.trim()) { setMsg('Enter a name for the signature'); setTimeout(() => setMsg(''), 2000); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL('image/png');
    setStampLoading(true);
    try {
      const res = await api.post(`/stamps-signatures/${id}/signatures`, {
        name: sigName.trim(),
        type: 'drawn',
        data,
      });
      setSignatures(prev => [...prev, res]);
      clearCanvas(); setSigName('');
      setMsg('Signature saved!'); setTimeout(() => setMsg(''), 2000);
    } catch (err) { setMsg('Failed: ' + (err.message || '')); }
    setStampLoading(false);
  }

  async function saveTypedSignature() {
    if (!sigName.trim()) { setMsg('Enter a name'); setTimeout(() => setMsg(''), 2000); return; }
    // Render typed signature to canvas
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 400, 120);
    const fontObj = SIG_FONTS.find(f => f.name === sigFont) || SIG_FONTS[0];
    ctx.font = `48px ${fontObj.css}`;
    ctx.fillStyle = '#1a1a1a';
    ctx.textBaseline = 'middle';
    ctx.fillText(sigName.trim(), 20, 60);
    const data = canvas.toDataURL('image/png');
    setStampLoading(true);
    try {
      const res = await api.post(`/stamps-signatures/${id}/signatures`, {
        name: sigName.trim(),
        type: 'typed',
        data,
        font: sigFont,
      });
      setSignatures(prev => [...prev, res]);
      setSigName('');
      setMsg('Typed signature saved!'); setTimeout(() => setMsg(''), 2000);
    } catch (err) { setMsg('Failed: ' + (err.message || '')); }
    setStampLoading(false);
  }

  async function uploadSignature(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const name = prompt('Name for this signature:', file.name.replace(/\.[^.]+$/, ''));
      if (!name) return;
      setStampLoading(true);
      try {
        const res = await api.post(`/stamps-signatures/${id}/signatures`, {
          name,
          type: 'uploaded',
          data: reader.result,
        });
        setSignatures(prev => [...prev, res]);
        setMsg('Signature uploaded!'); setTimeout(() => setMsg(''), 2000);
      } catch (err) { setMsg('Upload failed: ' + (err.message || '')); }
      setStampLoading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function saveDscSignature() {
    if (!dscName.trim()) { setMsg('Enter signer name'); setTimeout(() => setMsg(''), 2000); return; }
    setStampLoading(true);
    try {
      const res = await api.post(`/stamps-signatures/${id}/signatures/dsc`, {
        signerName: dscName.trim(),
        serialNumber: dscSerial.trim() || undefined,
        issuer: dscIssuer.trim() || 'eMudhra',
      });
      setSignatures(prev => [...prev, res]);
      setDscName(''); setDscSerial('');
      setMsg('DSC signature created!'); setTimeout(() => setMsg(''), 2000);
    } catch (err) { setMsg('Failed: ' + (err.message || '')); }
    setStampLoading(false);
  }

  async function deleteSignature(sigId) {
    if (!confirm('Delete this signature?')) return;
    try {
      await api.delete(`/stamps-signatures/${id}/signatures/${sigId}`);
      setSignatures(prev => prev.filter(s => s.id !== sigId));
      setMsg('Signature deleted'); setTimeout(() => setMsg(''), 2000);
    } catch { setMsg('Delete failed'); }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const currentHeader = activeTemplate.includes('header') ? code : (templates[activeTemplate.replace('footer', 'header')] || '');
  const currentFooter = activeTemplate.includes('footer') ? code : (templates[activeTemplate.replace('header', 'footer')] || '');

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#666' }}>Loading...</div>;
  if (!company) return <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>Company not found</div>;

  return (
    <div style={{ padding: '0 20px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => navigate('/companies')} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#475569' }}>← Back</button>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 22, color: '#1a1a1a', margin: 0 }}>{company.name}</h2>
      </div>

      {msg && <div style={{ padding: '7px 14px', background: msg.includes('ail') || msg.includes('invalid') ? '#fef2f2' : '#f0fdf4', color: msg.includes('ail') || msg.includes('invalid') ? '#dc2626' : '#16a34a', borderRadius: 6, marginBottom: 10, fontSize: 12, fontWeight: 500 }}>{msg}</div>}

      <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: 16 }}>
        {['profile', 'templates', 'stamps'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 24px', border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', fontWeight: tab === t ? 700 : 500, borderBottom: tab === t ? '3px solid #2e7d32' : '3px solid transparent', background: tab === t ? '#f0fdf4' : 'transparent', color: tab === t ? '#2e7d32' : '#64748b', marginBottom: -2, textTransform: 'capitalize' }}>
            {t === 'templates' ? 'Header & Footer' : t === 'stamps' ? 'Stamps & Signatures' : t}
          </button>
        ))}
      </div>

      {/* ═══ PROFILE ═══ */}
      {tab === 'profile' && (
        <form onSubmit={saveProfile} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24, maxWidth: 800 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {PROFILE_FIELDS.map(f => (
              <div key={f.key} style={{ gridColumn: f.full ? '1 / -1' : undefined }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>{f.label}{f.required ? ' *' : ''}</label>
                <input value={form[f.key] || ''} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder || ''} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button type="submit" disabled={saving} style={{ padding: '10px 28px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{saving ? 'Saving...' : 'Save Profile'}</button>
            <button type="button" onClick={regenerateTemplates} style={{ padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Regenerate Templates</button>
          </div>
        </form>
      )}

      {/* ═══ TEMPLATES ═══ */}
      {tab === 'templates' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb' }}>
              {TEMPLATE_TABS.map(t => <button key={t.key} onClick={() => setActiveTemplate(t.key)} style={{ padding: '7px 14px', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: activeTemplate === t.key ? 700 : 500, borderBottom: activeTemplate === t.key ? '3px solid #6366f1' : '3px solid transparent', background: activeTemplate === t.key ? '#eef2ff' : 'transparent', color: activeTemplate === t.key ? '#6366f1' : '#64748b', marginBottom: -2 }}>{t.label}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={pageSize} onChange={e => setPageSize(e.target.value)} style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 11, background: '#fff' }}>{Object.entries(PAGE_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              <Btn label={showCode ? 'Hide HTML' : 'Edit HTML'} bg={showCode ? '#475569' : '#6366f1'} onClick={() => setShowCode(!showCode)} />
              <Btn label="Print" bg="#475569" onClick={printPreview} />
              <Btn label="Reset" bg="#dc2626" onClick={resetTemplate} />
              <Btn label={saving ? '...' : dirty ? 'Save *' : 'Save'} bg={dirty ? '#dc6e09' : '#2e7d32'} onClick={() => saveTemplate()} disabled={saving} />
            </div>
          </div>

          {/* AI bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') aiGenerate(); }}
              placeholder={`Describe the ${isFooter ? 'footer' : 'header'} style...`}
              style={{ flex: 1, padding: '9px 14px', border: '2px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
              onFocus={e => e.target.style.borderColor = '#6366f1'} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
            <button onClick={aiGenerate} disabled={aiLoading || !aiPrompt.trim()} style={{ padding: '0 18px', background: aiLoading ? '#94a3b8' : '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: aiLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
              {aiLoading ? 'Generating...' : 'AI Generate'}
            </button>
          </div>

          {/* Drag hint */}
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 8, padding: '4px 8px', background: '#f8fafc', borderRadius: 4, display: 'inline-block' }}>
            Drag elements to reposition &bull; Double-click to edit text &bull; Auto-saves on changes
          </div>

          {/* Preview + Code */}
          <div ref={containerRef} style={{ display: 'grid', gridTemplateColumns: showCode ? '1fr 1fr' : '1fr', gap: 16 }}>
            {/* Interactive A4 Preview */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ ...labelStyle, alignSelf: 'flex-start' }}>{pageSize} Preview — drag to edit</div>
              <div style={{ background: '#e5e7eb', padding: 16, borderRadius: 8, width: '100%', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
                <div style={{ width: ps.w, height: ps.h, transform: `scale(${pageScale})`, transformOrigin: 'top center', flexShrink: 0 }}>
                  <div style={{ width: ps.w, height: ps.h, background: '#fff', boxShadow: '0 2px 20px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                    {/* Header — drag & drop */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <DragPreview
                        key={'h-' + renderKey + '-' + activeTemplate}
                        ref={headerDragRef}
                        html={currentHeader}
                        onDirty={() => setDirty(true)}
                        scale={pageScale}
                        active={!isFooter}
                        style={{ padding: '20px 28px 8px', minHeight: 100 }}
                      />
                      {!isFooter && <div style={{ position: 'absolute', inset: 0, border: '2px dashed #6366f1', pointerEvents: 'none', background: 'rgba(99,102,241,0.03)', zIndex: 10 }} />}
                    </div>

                    {/* Body (non-interactive) */}
                    <div style={{ flex: 1, padding: '12px 28px', overflow: 'hidden', pointerEvents: 'none', opacity: 0.5 }}>
                      <div dangerouslySetInnerHTML={{ __html: SAMPLE_BODY.replace('##DATE##', today) }} />
                    </div>

                    {/* Footer — drag & drop */}
                    <div style={{ position: 'relative', flexShrink: 0, marginTop: 'auto' }}>
                      <DragPreview
                        key={'f-' + renderKey + '-' + activeTemplate}
                        ref={footerDragRef}
                        html={currentFooter}
                        onDirty={() => setDirty(true)}
                        scale={pageScale}
                        active={isFooter}
                        style={{ padding: '4px 28px 14px', minHeight: 40 }}
                      />
                      {isFooter && <div style={{ position: 'absolute', inset: 0, border: '2px dashed #6366f1', pointerEvents: 'none', background: 'rgba(99,102,241,0.03)', zIndex: 10 }} />}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>{ps.w}×{ps.h}pt — Editing: <strong style={{ color: '#6366f1' }}>{TEMPLATE_TABS.find(t => t.key === activeTemplate)?.label}</strong></div>
            </div>

            {/* HTML Code Editor (side panel when toggled) */}
            {showCode && (
              <div>
                <div style={labelStyle}>HTML Code</div>
                <textarea value={code} onChange={e => { setCode(e.target.value); setTemplates(prev => ({ ...prev, [activeTemplate]: e.target.value })); setDirty(true); }} spellCheck={false}
                  style={{ width: '100%', height: ps.h * pageScale + 20, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, lineHeight: 1.5, padding: 14, border: '2px solid #334155', borderRadius: 8, background: '#0f172a', color: '#e2e8f0', resize: 'vertical', outline: 'none' }}
                  onKeyDown={e => {
                    if (e.key === 'Tab') { e.preventDefault(); const s = e.target.selectionStart; const v = code.substring(0, s) + '  ' + code.substring(e.target.selectionEnd); setCode(v); setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = s + 2; }, 0); }
                    if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveTemplate(); }
                  }} />
              </div>
            )}
          </div>

          {/* Always-visible HTML editor below preview */}
          {!showCode && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={labelStyle}>HTML Code — {TEMPLATE_TABS.find(t => t.key === activeTemplate)?.label}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Cmd/Ctrl+S to save</div>
              </div>
              <textarea
                value={code}
                onChange={e => { setCode(e.target.value); setTemplates(prev => ({ ...prev, [activeTemplate]: e.target.value })); setDirty(true); setRenderKey(k => k + 1); }}
                spellCheck={false}
                style={{
                  width: '100%', height: 220, fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 11, lineHeight: 1.5, padding: 14,
                  border: '2px solid #334155', borderRadius: 8,
                  background: '#0f172a', color: '#e2e8f0',
                  resize: 'vertical', outline: 'none',
                }}
                onKeyDown={e => {
                  if (e.key === 'Tab') { e.preventDefault(); const s = e.target.selectionStart; const v = code.substring(0, s) + '  ' + code.substring(e.target.selectionEnd); setCode(v); setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = s + 2; }, 0); }
                  if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveTemplate(); }
                }}
              />
            </div>
          )}
        </>
      )}

      {/* ═══ STAMPS & SIGNATURES ═══ */}
      {tab === 'stamps' && (
        <div style={{ maxWidth: 1000 }}>
          {/* Google Fonts for signature styles */}
          <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;700&family=Great+Vibes&family=Pacifico&family=Sacramento&family=Satisfy&family=Caveat:wght@400;700&display=swap" rel="stylesheet" />

          {/* ── STAMPS SECTION ── */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Digital Stamps</h3>
              <label style={{ padding: '5px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                Upload Custom
                <input type="file" accept="image/*" onChange={uploadCustomStamp} style={{ display: 'none' }} />
              </label>
            </div>

            {/* Pre-made stamp gallery */}
            <div style={{ ...labelStyle, marginBottom: 10 }}>Pre-made Stamps — click to add</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, marginBottom: 16 }}>
              {PREMADE_STAMPS.map(s => (
                <button
                  key={s.key}
                  onClick={() => addPremadeStamp(s.key, s.color)}
                  disabled={stampLoading}
                  style={{
                    padding: '12px 8px', background: '#fafafa', border: '1.5px solid #e5e7eb',
                    borderRadius: 8, cursor: stampLoading ? 'wait' : 'pointer', textAlign: 'center',
                    transition: 'all 0.15s', fontSize: 11, fontWeight: 600, color: s.color,
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { e.target.style.borderColor = s.color; e.target.style.background = '#f0f7ff'; }}
                  onMouseLeave={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.background = '#fafafa'; }}
                >
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{s.icon}</div>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Saved stamps grid */}
            {stamps.length > 0 && (
              <>
                <div style={{ ...labelStyle, marginBottom: 10 }}>Saved Stamps ({stamps.length})</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
                  {stamps.map(s => (
                    <div key={s.id} style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, textAlign: 'center', position: 'relative' }}>
                      <img src={s.data} alt={s.name} style={{ maxWidth: '100%', maxHeight: 100, objectFit: 'contain', marginBottom: 6 }} />
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#475569', marginBottom: 4 }}>{s.name}</div>
                      <div style={{ fontSize: 9, color: '#94a3b8' }}>{s.type}</div>
                      <button
                        onClick={() => deleteStamp(s.id)}
                        style={{ position: 'absolute', top: 4, right: 4, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, padding: '2px 6px', fontSize: 10, color: '#dc2626', cursor: 'pointer' }}
                      >×</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {stamps.length === 0 && (
              <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}>
                No stamps yet. Click a pre-made stamp above or upload your own.
              </div>
            )}
          </div>

          {/* ── SIGNATURES SECTION ── */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', margin: '0 0 14px' }}>E-Signatures</h3>

            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid #e5e7eb' }}>
              {[
                { key: 'draw', label: 'Draw' },
                { key: 'type', label: 'Type' },
                { key: 'upload', label: 'Upload' },
                { key: 'dsc', label: 'DSC (e-Mudhra)' },
              ].map(m => (
                <button
                  key={m.key}
                  onClick={() => setSigMode(m.key)}
                  style={{
                    padding: '8px 18px', border: 'none', cursor: 'pointer', fontSize: 12,
                    fontFamily: 'inherit', fontWeight: sigMode === m.key ? 700 : 500,
                    borderBottom: sigMode === m.key ? '3px solid #2e7d32' : '3px solid transparent',
                    background: sigMode === m.key ? '#f0fdf4' : 'transparent',
                    color: sigMode === m.key ? '#2e7d32' : '#64748b', marginBottom: -2,
                  }}
                >{m.label}</button>
              ))}
            </div>

            {/* ── DRAW MODE ── */}
            {sigMode === 'draw' && (
              <div>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Signatory Name</label>
                  <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder="e.g. Rajesh Kumar" style={inputStyle} />
                </div>
                <div style={{ ...labelStyle, marginBottom: 6 }}>Draw your signature below</div>
                <canvas
                  ref={el => { canvasRef.current = el; if (el) initCanvas(); }}
                  width={500} height={150}
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={e => { e.preventDefault(); startDraw(e); }} onTouchMove={e => { e.preventDefault(); draw(e); }} onTouchEnd={stopDraw}
                  style={{ width: '100%', maxWidth: 500, height: 150, border: '2px dashed #d1d5db', borderRadius: 8, cursor: 'crosshair', background: '#fff', display: 'block', touchAction: 'none' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <Btn label="Clear" bg="#94a3b8" onClick={clearCanvas} />
                  <Btn label={stampLoading ? 'Saving...' : 'Save Signature'} bg="#2e7d32" onClick={saveDrawnSignature} disabled={!hasDrawn || !sigName.trim() || stampLoading} />
                </div>
              </div>
            )}

            {/* ── TYPE MODE ── */}
            {sigMode === 'type' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={labelStyle}>Signatory Name</label>
                    <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder="e.g. Rajesh Kumar" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Font Style</label>
                    <select value={sigFont} onChange={e => setSigFont(e.target.value)} style={inputStyle}>
                      {SIG_FONTS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                    </select>
                  </div>
                </div>
                {/* Preview */}
                {sigName && (
                  <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px 24px', marginBottom: 14, textAlign: 'center' }}>
                    <div style={{ fontFamily: SIG_FONTS.find(f => f.name === sigFont)?.css || SIG_FONTS[0].css, fontSize: 42, color: '#1a1a1a', lineHeight: 1.4 }}>
                      {sigName}
                    </div>
                  </div>
                )}
                {/* All font previews */}
                <div style={{ ...labelStyle, marginBottom: 8 }}>Font Preview</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 14 }}>
                  {SIG_FONTS.map(f => (
                    <button
                      key={f.name}
                      onClick={() => setSigFont(f.name)}
                      style={{
                        padding: '10px 12px', background: sigFont === f.name ? '#f0fdf4' : '#fafafa',
                        border: sigFont === f.name ? '2px solid #2e7d32' : '1px solid #e5e7eb',
                        borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                      }}
                    >
                      <div style={{ fontFamily: f.css, fontSize: 24, color: '#1a1a1a', lineHeight: 1.3 }}>{sigName || 'Signature'}</div>
                      <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4 }}>{f.name}</div>
                    </button>
                  ))}
                </div>
                <Btn label={stampLoading ? 'Saving...' : 'Save Typed Signature'} bg="#2e7d32" onClick={saveTypedSignature} disabled={!sigName.trim() || stampLoading} />
              </div>
            )}

            {/* ── UPLOAD MODE ── */}
            {sigMode === 'upload' && (
              <div>
                <div style={{ background: '#fafafa', border: '2px dashed #d1d5db', borderRadius: 12, padding: 40, textAlign: 'center' }}>
                  <div style={{ fontSize: 36, marginBottom: 8, color: '#94a3b8' }}>&#128394;</div>
                  <div style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>Upload a scanned signature image</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>PNG, JPG, or SVG — transparent background recommended</div>
                  <label style={{ padding: '10px 28px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-block' }}>
                    Choose File
                    <input type="file" accept="image/*" onChange={uploadSignature} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>
            )}

            {/* ── DSC MODE ── */}
            {sigMode === 'dsc' && (
              <div>
                <div style={{ background: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0d47a1', marginBottom: 6 }}>e-Mudhra Digital Signature Certificate (DSC)</div>
                  <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
                    Create a verified digital signature stamp based on your DSC details.
                    This generates a visual DSC stamp for document signing.
                    For full cryptographic DSC signing, integrate with the eMudhra API using your organization's credentials.
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={labelStyle}>Signer Name *</label>
                    <input value={dscName} onChange={e => setDscName(e.target.value)} placeholder="e.g. Rajesh Kumar" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Certificate Serial (optional)</label>
                    <input value={dscSerial} onChange={e => setDscSerial(e.target.value)} placeholder="Auto-generated if empty" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Issuer</label>
                    <select value={dscIssuer} onChange={e => setDscIssuer(e.target.value)} style={inputStyle}>
                      <option value="eMudhra">eMudhra</option>
                      <option value="Sify">Sify</option>
                      <option value="NSDL">NSDL e-Gov</option>
                      <option value="CDAC">C-DAC</option>
                      <option value="Capricorn">Capricorn</option>
                      <option value="IDRBT">IDRBT</option>
                    </select>
                  </div>
                </div>
                {/* DSC Preview */}
                {dscName && (
                  <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 14 }}>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>Preview</div>
                    <div style={{ background: '#f0f7ff', border: '2px solid #0d47a1', borderRadius: 6, padding: 12, maxWidth: 300, fontFamily: "'Courier New', monospace", fontSize: 10, lineHeight: 1.8, color: '#333' }}>
                      <div style={{ fontWeight: 700, color: '#0d47a1', fontSize: 9, marginBottom: 4 }}>DIGITALLY SIGNED</div>
                      <div>Signer: <strong>{dscName}</strong></div>
                      <div>Date: {new Date().toISOString().split('T')[0]}</div>
                      <div>Serial: {dscSerial || 'Auto-generated'}</div>
                      <div>Issuer: {dscIssuer} Sub-CA | Class 3</div>
                      <div style={{ textAlign: 'right', color: '#0d47a1', fontSize: 8 }}>Verified ✓</div>
                    </div>
                  </div>
                )}
                <Btn label={stampLoading ? 'Creating...' : 'Create DSC Signature'} bg="#0d47a1" onClick={saveDscSignature} disabled={!dscName.trim() || stampLoading} />
              </div>
            )}

            {/* Saved signatures grid */}
            {signatures.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ ...labelStyle, marginBottom: 10 }}>Saved Signatures ({signatures.length})</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                  {signatures.map(s => (
                    <div key={s.id} style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, textAlign: 'center', position: 'relative' }}>
                      <img src={s.data} alt={s.name} style={{ maxWidth: '100%', maxHeight: 80, objectFit: 'contain', marginBottom: 6 }} />
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#475569' }}>{s.name}</div>
                      <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>
                        {s.type === 'dsc' ? 'DSC' : s.type === 'drawn' ? 'Hand-drawn' : s.type === 'typed' ? `Typed (${s.font || ''})` : 'Uploaded'}
                      </div>
                      <button
                        onClick={() => deleteSignature(s.id)}
                        style={{ position: 'absolute', top: 4, right: 4, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, padding: '2px 6px', fontSize: 10, color: '#dc2626', cursor: 'pointer' }}
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {signatures.length === 0 && (
              <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12, fontStyle: 'italic', marginTop: 16 }}>
                No signatures yet. Draw, type, upload, or create a DSC signature above.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 };
const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit', background: '#fff' };
function Btn({ label, bg, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ padding: '5px 12px', background: bg, color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap' }}>{label}</button>;
}
