import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../utils/api';

const TABS = [
  { key: 'doc_header', label: 'Document Header' },
  { key: 'doc_footer', label: 'Document Footer' },
  { key: 'inv_header', label: 'Invoice Header' },
  { key: 'inv_footer', label: 'Invoice Footer' },
];

// A4 at 72dpi baseline
const PAGE_SIZES = {
  A4:     { w: 595, h: 842, label: 'A4 (210 × 297 mm)', css: 'A4' },
  Letter: { w: 612, h: 792, label: 'US Letter', css: 'letter' },
  Legal:  { w: 612, h: 1008, label: 'US Legal', css: 'legal' },
  A3:     { w: 842, h: 1191, label: 'A3', css: 'A3' },
  A5:     { w: 420, h: 595, label: 'A5', css: 'A5' },
};

const SAMPLE_BODY = `<div style="text-align:right;margin-bottom:16px;font-family:'Poppins',sans-serif;">
<div style="font-size:11px;color:#64748b;">Ref: AK&Co/SAMPLE/2026-03/001</div>
<div style="font-size:11px;font-weight:500;color:#1a1a1a;">Date: ##DATE##</div>
</div>
<p style="font-family:'Poppins',sans-serif;font-size:11px;margin-bottom:8px;color:#1a1a1a;"><strong>To,</strong></p>
<p style="font-family:'Poppins',sans-serif;font-size:11px;margin-bottom:14px;color:#1a1a1a;">The Manager<br>Sample Company Pvt. Ltd.<br>New Delhi, India</p>
<p style="font-family:'Poppins',sans-serif;font-size:12px;font-weight:700;text-decoration:underline;margin:14px 0;color:#1a1a1a;">Subject: Sample Document for Preview</p>
<p style="font-family:'Poppins',sans-serif;font-size:11px;line-height:1.7;margin-bottom:8px;color:#1a1a1a;">Dear Sir/Madam,</p>
<p style="font-family:'Poppins',sans-serif;font-size:11px;line-height:1.7;margin-bottom:8px;color:#1a1a1a;">This is a sample document to preview how your header and footer will appear on printed documents. The content between the header and footer represents typical document body text.</p>
<p style="font-family:'Poppins',sans-serif;font-size:11px;line-height:1.7;margin-bottom:8px;color:#1a1a1a;">We are pleased to inform you that the services requested have been completed as per the agreed terms. The detailed breakdown is enclosed for your reference.</p>
<p style="font-family:'Poppins',sans-serif;font-size:11px;line-height:1.7;margin-bottom:8px;color:#1a1a1a;">Kindly acknowledge receipt and confirm at your earliest convenience. Should you require any clarification, please contact our office.</p>
<div style="margin-top:36px;font-family:'Poppins',sans-serif;">
<p style="font-weight:600;font-size:11px;color:#1a1a1a;">For Akshay Kotish &amp; Co.</p>
<p style="margin:32px 0 3px;color:#94a3b8;font-size:11px;">________________________</p>
<p style="font-weight:600;font-size:11px;color:#1a1a1a;">Authorized Signatory</p>
</div>`;

export default function HeaderFooterEditor() {
  const [active, setActive] = useState('doc_header');
  const [templates, setTemplates] = useState({});
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState('A4');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [containerW, setContainerW] = useState(600);
  const containerRef = useRef(null);

  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const ps = PAGE_SIZES[pageSize];

  // Measure container to compute scale
  const measureContainer = useCallback(() => {
    if (containerRef.current) {
      setContainerW(containerRef.current.offsetWidth);
    }
  }, []);

  useEffect(() => { loadTemplates(); measureContainer(); window.addEventListener('resize', measureContainer); return () => window.removeEventListener('resize', measureContainer); }, []);
  useEffect(() => { setCode(templates[active] || ''); setShowCode(false); }, [active, templates]);
  useEffect(() => { measureContainer(); }, [showCode]);

  async function loadTemplates() {
    setLoading(true);
    try { setTemplates(await api.get('/header-footer')); } catch (err) { setMsg('Failed to load templates'); }
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true); setMsg('');
    try {
      await api.put(`/header-footer/${active}`, { html: code });
      setTemplates(prev => ({ ...prev, [active]: code }));
      setMsg('Saved!'); setTimeout(() => setMsg(''), 2500);
    } catch { setMsg('Failed to save'); }
    setSaving(false);
  }

  async function handleReset() {
    if (!confirm('Reset to default template?')) return;
    setSaving(true);
    try {
      const res = await api.post(`/header-footer/${active}/reset`);
      setCode(res.html); setTemplates(prev => ({ ...prev, [active]: res.html }));
      setMsg('Reset to default'); setTimeout(() => setMsg(''), 2500);
    } catch { setMsg('Failed to reset'); }
    setSaving(false);
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true); setMsg('');
    const isHdr = active.includes('header');
    const isInv = active.includes('inv');
    try {
      const res = await api.post('/ai/command', {
        prompt: `Generate HTML for a print-ready ${isHdr ? 'header' : 'footer'} for ${isInv ? 'invoices' : 'documents/letterhead'}.

User wants: "${aiPrompt}"

RULES:
- Return ONLY raw HTML. No JSON, no code fences, no explanation.
- All inline CSS. Font: 'Poppins', Arial, sans-serif.
- Use <table> layout for two-column positioning.
- Company: AKSHAY KOTISH & CO., A Brand of Akshay Lakshay Kotish Private Limited, Chartered Accountants & Business Consultants
- GSTIN: 06AAWCA4919K1Z3, CIN: U72900HR2022PTC101170, PAN: AAWCA4919K
- Phone: +91 98967 70369, Email: connect@akshaykotish.com, Website: www.akshaykotish.com
- Address: H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027, India
${isHdr ? '- Header: company name (22px bold) left, contact info right. Green (#2e7d32) accent line. Address bar below.' : '- Footer: compact 1-2 lines, centered, all details on one line. Green top border.'}
${isInv ? '- Include "TAX INVOICE" on the right side (26px bold green).' : ''}
- Font sizes: company name 22px, subtitle 9px, tagline 10px, statutory 8px, contact 9px.
- White background only. Output raw HTML.`
      });
      let html = res?.data?.body || res?.message || '';
      html = html.replace(/```html?\s*/gi, '').replace(/```\s*/g, '').trim();
      if (html.startsWith('{')) { try { const p = JSON.parse(html); html = p.data?.body || p.content || p.html || html; } catch {} }
      if (html.includes('<')) { setCode(html); setMsg('AI generated — review and save.'); setTimeout(() => setMsg(''), 3000); }
      else setMsg('AI response was not valid HTML. Try rephrasing.');
    } catch (err) { setMsg('AI failed: ' + (err.message || '')); }
    setAiLoading(false);
  }

  function handlePrint() {
    const hdr = active.includes('header') ? code : (templates[active.replace('footer', 'header')] || '');
    const ftr = active.includes('footer') ? code : (templates[active.replace('header', 'footer')] || '');
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>Document</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap');
@page { size: ${ps.css}; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Poppins',Arial,sans-serif; background:#fff; color:#1a1a1a; -webkit-print-color-adjust:exact; print-color-adjust:exact; padding:16mm 18mm 22mm 18mm; }
.ft { position:fixed; bottom:0; left:0; right:0; background:#fff; padding:0 18mm 10mm; }
</style></head><body>
<div class="ft">${ftr}</div>
${hdr}
<div style="font-size:11pt;line-height:1.8;padding:16px 0 40px;">${SAMPLE_BODY.replace('##DATE##', today)}</div>
<script>document.fonts.ready.then(()=>setTimeout(()=>window.print(),250));<\/script>
</body></html>`);
    w.document.close();
  }

  const isFooter = active.includes('footer');
  const pairKey = active.replace('header', 'footer').replace('footer', 'header');
  const currentHeader = active.includes('header') ? code : (templates[active.replace('footer', 'header')] || '');
  const currentFooter = active.includes('footer') ? code : (templates[active.replace('header', 'footer')] || '');

  // Scale: fit the A4 page (595px) into the available container
  const availW = showCode ? Math.min(containerW, 560) : Math.min(containerW, 700);
  const pageScale = Math.min(availW / ps.w, 1);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#666' }}>Loading...</div>;

  return (
    <div style={{ padding: '0 20px 40px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 22, color: '#1a1a1a', margin: 0 }}>Header & Footer Templates</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={pageSize} onChange={e => setPageSize(e.target.value)} style={selectStyle}>{Object.entries(PAGE_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <Btn label={showCode ? 'Hide HTML' : 'Edit HTML'} bg={showCode ? '#475569' : '#6366f1'} onClick={() => setShowCode(!showCode)} />
          <Btn label="Print" bg="#475569" onClick={handlePrint} />
          <Btn label="Reset" bg="#dc2626" onClick={handleReset} />
          <Btn label={saving ? 'Saving...' : 'Save'} bg="#2e7d32" onClick={handleSave} disabled={saving} />
        </div>
      </div>

      {msg && <div style={{ padding: '7px 14px', background: msg.includes('ail') ? '#fef2f2' : '#f0fdf4', color: msg.includes('ail') ? '#dc2626' : '#16a34a', borderRadius: 6, marginBottom: 10, fontSize: 12, fontWeight: 500 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: 14 }}>
        {TABS.map(t => <button key={t.key} onClick={() => setActive(t.key)} style={{ padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', borderBottom: active === t.key ? '3px solid #2e7d32' : '3px solid transparent', background: active === t.key ? '#f0fdf4' : 'transparent', color: active === t.key ? '#2e7d32' : '#64748b', fontWeight: active === t.key ? 700 : 500, marginBottom: -2 }}>{t.label}</button>)}
      </div>

      {/* AI bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !aiLoading) handleAiGenerate(); }}
          placeholder={`Describe how the ${isFooter ? 'footer' : 'header'} should look...`}
          style={{ flex: 1, padding: '10px 14px', border: '2px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
          onFocus={e => e.target.style.borderColor = '#6366f1'} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        <button onClick={handleAiGenerate} disabled={aiLoading || !aiPrompt.trim()} style={{ padding: '0 20px', background: aiLoading ? '#94a3b8' : '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: aiLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
          {aiLoading ? 'Generating...' : 'AI Generate'}
        </button>
      </div>

      {/* Main: code + preview */}
      <div ref={containerRef} style={{ display: 'grid', gridTemplateColumns: showCode ? '1fr 1fr' : '1fr', gap: 20 }}>
        {showCode && (
          <div>
            <div style={labelStyle}>HTML Code</div>
            <textarea value={code} onChange={e => setCode(e.target.value)} spellCheck={false}
              style={{ width: '100%', height: ps.h * pageScale + 20, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, lineHeight: 1.5, padding: 14, border: '2px solid #334155', borderRadius: 8, background: '#0f172a', color: '#e2e8f0', resize: 'vertical', outline: 'none' }}
              onKeyDown={e => {
                if (e.key === 'Tab') { e.preventDefault(); const s = e.target.selectionStart; setCode(code.substring(0, s) + '  ' + code.substring(e.target.selectionEnd)); setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = s + 2; }, 0); }
                if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave(); }
              }} />
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>Ctrl/Cmd+S to save</div>
          </div>
        )}

        {/* A4 preview */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ ...labelStyle, alignSelf: 'flex-start' }}>{pageSize} Preview</div>
          <div style={{ background: '#e5e7eb', padding: 20, borderRadius: 8, width: '100%', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
            {/* Scaled A4 page */}
            <div style={{ width: ps.w, height: ps.h, transform: `scale(${pageScale})`, transformOrigin: 'top center', flexShrink: 0 }}>
              <div style={{
                width: ps.w, height: ps.h,
                background: '#fff',
                boxShadow: '0 2px 20px rgba(0,0,0,0.15)',
                display: 'flex', flexDirection: 'column',
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Header */}
                <div style={{ padding: '20px 28px 0', flexShrink: 0, position: 'relative' }}>
                  <div dangerouslySetInnerHTML={{ __html: currentHeader }} />
                  {!isFooter && <div style={{ position: 'absolute', inset: 0, border: '2px dashed #6366f1', borderRadius: 2, pointerEvents: 'none', background: 'rgba(99,102,241,0.04)' }} />}
                </div>

                {/* Body */}
                <div style={{ flex: 1, padding: '12px 28px', overflow: 'hidden' }}>
                  <div dangerouslySetInnerHTML={{ __html: SAMPLE_BODY.replace('##DATE##', today) }} />
                </div>

                {/* Footer */}
                <div style={{ padding: '0 28px 14px', flexShrink: 0, marginTop: 'auto', position: 'relative' }}>
                  <div dangerouslySetInnerHTML={{ __html: currentFooter }} />
                  {isFooter && <div style={{ position: 'absolute', inset: 0, border: '2px dashed #6366f1', borderRadius: 2, pointerEvents: 'none', background: 'rgba(99,102,241,0.04)' }} />}
                </div>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, textAlign: 'center' }}>
            {ps.w}×{ps.h}pt &mdash; Editing: <strong style={{ color: '#6366f1' }}>{TABS.find(t => t.key === active)?.label}</strong> (dashed border)
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 };
const selectStyle = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11, background: '#fff', cursor: 'pointer' };
function Btn({ label, bg, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ padding: '6px 14px', background: bg, color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap' }}>{label}</button>;
}
