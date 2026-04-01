import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../utils/api';
import DragPreview from '../components/DragPreview';

const DOC_TYPES = ['Letter', 'Agreement', 'Notice', 'Certificate', 'General'];

const QUICK_CHIPS = [
  { label: 'Experience Letter', prompt: 'Draft an experience letter for an employee' },
  { label: 'Offer Letter', prompt: 'Draft an offer letter for a new hire' },
  { label: 'Appointment Letter', prompt: 'Draft an appointment letter for a new employee' },
  { label: 'Relieving Letter', prompt: 'Draft a relieving letter for an employee' },
  { label: 'Tax Filing Notice', prompt: 'Draft a tax filing notice' },
  { label: 'GST Notice', prompt: 'Draft a GST compliance notice' },
  { label: 'Payment Reminder', prompt: 'Draft a payment reminder letter' },
  { label: 'Service Agreement', prompt: 'Draft a service agreement' },
  { label: 'NDA', prompt: 'Draft a non-disclosure agreement' },
  { label: 'Engagement Letter', prompt: 'Draft a professional engagement letter' },
];

const PAGE_W = 595;
const PAGE_H = 842;
const BODY_H = 480; // usable body height per page (A4 minus header ~180px, footer ~70px, padding ~112px)

export default function DocumentDrafter() {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [docType, setDocType] = useState('Letter');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [bodyHtml, setBodyHtml] = useState('');
  const [headerHtml, setHeaderHtml] = useState('');
  const [footerHtml, setFooterHtml] = useState('');
  const [msg, setMsg] = useState('');
  const [containerW, setContainerW] = useState(700);
  const containerRef = useRef(null);
  const [dirty, setDirty] = useState(false);
  const [renderKey, setRenderKey] = useState(0);

  // Stamps & Signatures
  const [stamps, setStamps] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [showStampPanel, setShowStampPanel] = useState(false);

  // Click-to-edit
  const [editModal, setEditModal] = useState(null); // { x, y, elementIndex, elementHtml }
  const [editPrompt, setEditPrompt] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const editInputRef = useRef(null);

  // Multi-page
  const [pages, setPages] = useState([]);
  const measureRef = useRef(null);

  const pageScale = Math.min(containerW / PAGE_W, 1);

  useEffect(() => {
    loadCompanies();
    measureContainer();
    window.addEventListener('resize', measureContainer);
    return () => window.removeEventListener('resize', measureContainer);
  }, []);

  useEffect(() => {
    if (companyId) {
      loadTemplates(companyId);
      loadStampsSignatures(companyId);
    }
  }, [companyId]);

  useEffect(() => { measureContainer(); }, [bodyHtml]);

  // Split body into pages whenever bodyHtml changes
  useEffect(() => {
    if (bodyHtml) {
      splitIntoPages(bodyHtml);
    } else {
      setPages([]);
    }
  }, [bodyHtml, renderKey]);

  function measureContainer() {
    if (containerRef.current) setContainerW(containerRef.current.offsetWidth);
  }

  // ─── Split HTML into pages ────────────────────────────────────────────

  function splitIntoPages(html) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `position:fixed;visibility:hidden;top:0;left:0;width:${PAGE_W - 56}px;font-family:'Poppins',Arial,sans-serif;font-size:11px;line-height:1.7;overflow:auto;`;
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);

    // Collect all measurable child elements
    const rawChildren = Array.from(wrapper.childNodes);
    const elements = [];
    rawChildren.forEach(node => {
      if (node.nodeType === 1) {
        elements.push(node);
      } else if (node.nodeType === 3 && node.textContent.trim()) {
        const span = document.createElement('div');
        span.style.display = 'block';
        span.textContent = node.textContent;
        wrapper.replaceChild(span, node);
        elements.push(span);
      }
    });

    if (elements.length === 0) {
      document.body.removeChild(wrapper);
      setPages([html]);
      return;
    }

    // Use cumulative offsetTop to determine page breaks
    const maxH = BODY_H;
    const pageList = [];
    let currentPageHtml = '';
    let currentHeight = 0;

    elements.forEach((child, i) => {
      const rect = child.getBoundingClientRect();
      const h = rect.height + 10; // include margin
      if (currentHeight + h > maxH && currentPageHtml) {
        pageList.push(currentPageHtml);
        currentPageHtml = '';
        currentHeight = 0;
      }
      currentPageHtml += child.outerHTML;
      currentHeight += h;
    });
    if (currentPageHtml) pageList.push(currentPageHtml);

    document.body.removeChild(wrapper);
    setPages(pageList.length > 0 ? pageList : [html]);
  }

  // ─── Data Loading ─────────────────────────────────────────────────────

  async function loadCompanies() {
    try {
      const res = await api.get('/companies');
      const list = Array.isArray(res) ? res : (res?.data || []);
      setCompanies(list);
      if (list.length > 0 && !companyId) setCompanyId(list[0].id);
    } catch { setMsg('Failed to load companies'); }
  }

  async function loadTemplates(cid) {
    try {
      const tmpl = await api.get(`/companies/${cid}/templates`);
      setHeaderHtml(tmpl.doc_header || '');
      setFooterHtml(tmpl.doc_footer || '');
    } catch { /* templates may not exist yet */ }
  }

  async function loadStampsSignatures(cid) {
    try {
      const [st, sg] = await Promise.all([
        api.get(`/stamps-signatures/${cid}/stamps`),
        api.get(`/stamps-signatures/${cid}/signatures`),
      ]);
      setStamps(Array.isArray(st) ? st : []);
      setSignatures(Array.isArray(sg) ? sg : []);
    } catch { /* may not exist */ }
  }

  // ─── Generate ─────────────────────────────────────────────────────────

  async function handleGenerate() {
    if (!prompt.trim()) { setMsg('Please enter a prompt'); setTimeout(() => setMsg(''), 2500); return; }
    if (!companyId) { setMsg('Please select a company'); setTimeout(() => setMsg(''), 2500); return; }
    setGenerating(true); setMsg('');
    try {
      const res = await api.post(`/doc-drafter/${companyId}/draft`, {
        prompt: prompt.trim(),
        type: docType.toLowerCase(),
      });
      const html = res?.content || res?.html || res?.body || '';
      if (html) {
        setBodyHtml(html);
        setRenderKey(k => k + 1);
        setDirty(false);
        setMsg('Document generated!');
      } else {
        setMsg('AI returned empty response. Try a more detailed prompt.');
      }
    } catch (err) {
      setMsg('Generation failed: ' + (err.message || 'Unknown error'));
    }
    setGenerating(false);
    setTimeout(() => setMsg(''), 3000);
  }

  function handleChipClick(chipPrompt) { setPrompt(chipPrompt); }

  function handleCopyHtml() {
    navigator.clipboard.writeText(bodyHtml).then(() => {
      setMsg('HTML copied!'); setTimeout(() => setMsg(''), 2000);
    }).catch(() => {
      setMsg('Copy failed'); setTimeout(() => setMsg(''), 2000);
    });
  }

  function insertStampOrSignature(item) {
    const imgHtml = `<div style="display:inline-block;margin:8px 0;"><img src="${item.data}" alt="${item.name}" style="max-height:100px;max-width:200px;object-fit:contain;" /></div>`;
    const newBody = bodyHtml + imgHtml;
    setBodyHtml(newBody);
    setRenderKey(k => k + 1);
    setDirty(true);
    setMsg(`${item.name} inserted — drag to reposition`);
    setTimeout(() => setMsg(''), 2500);
  }

  function handlePrint() {
    const w = window.open('', '_blank');
    const pagesHtml = pages.map((pageBody, i) => `
<div class="page${i > 0 ? ' page-continuation' : ''}">
  <div class="hdr">${headerHtml}</div>
  <div class="body">${pageBody}</div>
  <div class="ftr">${footerHtml}</div>
  <div class="page-num">Page ${i + 1} of ${pages.length}</div>
</div>`).join('\n');

    w.document.write(`<!DOCTYPE html><html><head><title>Document</title><style>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap');
@page { size: A4; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Poppins', Arial, sans-serif; background: #fff; color: #1a1a1a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; min-height: 297mm; padding: 16mm 18mm 18mm 18mm; display: flex; flex-direction: column; position: relative; page-break-after: always; }
.page:last-child { page-break-after: auto; }
.page-continuation { padding-top: 22mm; }
.page-continuation .hdr { margin-bottom: 16px; padding-top: 4mm; }
.hdr { flex-shrink: 0; margin-bottom: 12px; }
.body { flex: 1; font-size: 11pt; line-height: 1.8; }
.ftr { flex-shrink: 0; margin-top: auto; padding-top: 8px; }
.page-num { position: absolute; bottom: 10mm; right: 18mm; font-size: 8px; color: #94a3b8; }
@media print { .page { width: 100%; } }
</style></head><body>
${pagesHtml}
<script>document.fonts.ready.then(()=>setTimeout(()=>window.print(),300))<\/script>
</body></html>`);
    w.document.close();
  }

  // ─── Click-to-Edit ────────────────────────────────────────────────────

  function handleBodyClick(e, pageIndex) {
    // Find the nearest block-level element
    let target = e.target;
    const container = e.currentTarget;
    if (target === container) return;

    // Walk up to find a direct child of the body container
    while (target.parentElement && target.parentElement !== container) {
      target = target.parentElement;
    }
    if (target === container) return;

    // Get position relative to the page container
    const rect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Find this element's index in the full bodyHtml
    const elementHtml = target.outerHTML;

    setEditModal({
      x: Math.min(rect.left - containerRect.left + 10, PAGE_W - 320),
      y: rect.bottom - containerRect.top + 4,
      pageIndex,
      elementHtml,
      targetEl: target,
    });
    setEditPrompt('');
    setTimeout(() => editInputRef.current?.focus(), 50);
  }

  async function submitEdit() {
    if (!editPrompt.trim() || !editModal) return;
    setEditLoading(true);
    try {
      const res = await api.post(`/doc-drafter/${companyId}/edit-section`, {
        sectionHtml: editModal.elementHtml,
        prompt: editPrompt.trim(),
        fullDocumentHtml: bodyHtml.substring(0, 3000),
      });
      const newHtml = res?.html;
      if (newHtml) {
        // Replace the specific section in bodyHtml
        const updatedBody = bodyHtml.replace(editModal.elementHtml, newHtml);
        setBodyHtml(updatedBody);
        setRenderKey(k => k + 1);
        setDirty(true);
        setMsg('Section updated!');
      } else {
        setMsg('AI returned empty response');
      }
    } catch (err) {
      setMsg('Edit failed: ' + (err.message || ''));
    }
    setEditLoading(false);
    setEditModal(null);
    setEditPrompt('');
    setTimeout(() => setMsg(''), 2500);
  }

  function closeEditModal() {
    setEditModal(null);
    setEditPrompt('');
  }

  const selectedCompany = companies.find(c => c.id === companyId);
  const hasStampsOrSigs = stamps.length > 0 || signatures.length > 0;

  return (
    <div style={{ padding: '0 20px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 22, color: '#1a1a1a', margin: '0 0 16px' }}>
        Document Drafter
      </h2>

      {msg && (
        <div style={{
          padding: '7px 14px',
          background: msg.includes('ail') || msg.includes('empty') ? '#fef2f2' : '#f0fdf4',
          color: msg.includes('ail') || msg.includes('empty') ? '#dc2626' : '#16a34a',
          borderRadius: 6, marginBottom: 10, fontSize: 12, fontWeight: 500,
        }}>{msg}</div>
      )}

      {/* Controls row */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14,
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16,
      }}>
        <div style={{ flex: '1 1 200px', minWidth: 160 }}>
          <label style={labelStyle}>Company</label>
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={selectStyle}>
            <option value="">Select company...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 1 160px', minWidth: 120 }}>
          <label style={labelStyle}>Document Type</label>
          <select value={docType} onChange={e => setDocType(e.target.value)} style={selectStyle}>
            {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={handleGenerate} disabled={generating || !companyId}
          style={{ padding: '9px 24px', background: generating ? '#94a3b8' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', alignSelf: 'flex-end' }}>
          {generating ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {/* Prompt */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 14 }}>
        <label style={labelStyle}>Prompt</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
          placeholder="Describe the document... Mention website URLs for automatic data fetching (e.g. 'Draft NDA for https://petscare.club code and development')"
          rows={4}
          style={{ width: '100%', padding: '10px 14px', border: '2px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.6 }}
          onFocus={e => e.target.style.borderColor = '#2e7d32'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
          Cmd/Ctrl+Enter to generate &bull; Include URLs and we'll fetch their content automatically
        </div>
      </div>

      {/* Quick chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {QUICK_CHIPS.map(chip => (
          <button key={chip.label} onClick={() => handleChipClick(chip.prompt)}
            style={{ padding: '5px 12px', background: prompt === chip.prompt ? '#e8f5e9' : '#f8fafc', border: prompt === chip.prompt ? '1px solid #2e7d32' : '1px solid #e5e7eb', borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: 'pointer', color: prompt === chip.prompt ? '#2e7d32' : '#475569', fontFamily: 'inherit', transition: 'all 0.15s' }}>
            {chip.label}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      {bodyHtml && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Btn label="Print" bg="#475569" onClick={handlePrint} />
          <Btn label="Save as PDF" bg="#475569" onClick={handlePrint} />
          <Btn label="Regenerate" bg="#6366f1" onClick={handleGenerate} disabled={generating} />
          <Btn label="Copy HTML" bg="#2e7d32" onClick={handleCopyHtml} />
          <Btn label={showStampPanel ? 'Hide Stamps & Signs' : 'Stamps & Signatures'} bg={showStampPanel ? '#475569' : '#7c3aed'} onClick={() => setShowStampPanel(!showStampPanel)} />
          {pages.length > 1 && (
            <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 600, marginLeft: 8 }}>{pages.length} pages</span>
          )}
        </div>
      )}

      {/* Stamps & Signatures Panel */}
      {bodyHtml && showStampPanel && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 12 }}>Click to insert into document</div>
          {stamps.length > 0 && (
            <>
              <div style={{ ...labelStyle, marginBottom: 8 }}>Stamps ({stamps.length})</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: signatures.length > 0 ? 16 : 0 }}>
                {stamps.map(s => (
                  <button key={s.id} onClick={() => insertStampOrSignature(s)}
                    style={{ background: '#fafafa', border: '1.5px solid #e5e7eb', borderRadius: 8, padding: 8, cursor: 'pointer', textAlign: 'center', width: 100, transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.background = '#f5f3ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#fafafa'; }}>
                    <img src={s.data} alt={s.name} style={{ maxWidth: 80, maxHeight: 60, objectFit: 'contain', display: 'block', margin: '0 auto 4px' }} />
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                  </button>
                ))}
              </div>
            </>
          )}
          {signatures.length > 0 && (
            <>
              <div style={{ ...labelStyle, marginBottom: 8 }}>Signatures ({signatures.length})</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {signatures.map(s => (
                  <button key={s.id} onClick={() => insertStampOrSignature(s)}
                    style={{ background: '#fafafa', border: '1.5px solid #e5e7eb', borderRadius: 8, padding: 8, cursor: 'pointer', textAlign: 'center', width: 120, transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#2e7d32'; e.currentTarget.style.background = '#f0fdf4'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#fafafa'; }}>
                    <img src={s.data} alt={s.name} style={{ maxWidth: 100, maxHeight: 50, objectFit: 'contain', display: 'block', margin: '0 auto 4px' }} />
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                  </button>
                ))}
              </div>
            </>
          )}
          {stamps.length === 0 && signatures.length === 0 && (
            <div style={{ textAlign: 'center', padding: 16, color: '#94a3b8', fontSize: 12 }}>
              No stamps or signatures saved yet. Go to <strong style={{ color: '#6366f1' }}>Companies → {selectedCompany?.name || 'Company'} → Stamps & Signatures</strong> to create them first.
            </div>
          )}
        </div>
      )}

      {/* Hint */}
      {bodyHtml && (
        <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 8, padding: '4px 8px', background: '#f8fafc', borderRadius: 4, display: 'inline-block' }}>
          Click any paragraph to edit with AI &bull; Drag elements to reposition &bull; Double-click to edit text
        </div>
      )}

      {/* ═══ MULTI-PAGE A4 PREVIEW ═══ */}
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        {pages.length > 0 ? pages.map((pageBody, pageIdx) => (
          <div key={pageIdx + '-' + renderKey} style={{ background: '#e5e7eb', padding: 16, borderRadius: 8, width: '100%', display: 'flex', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
            {/* Page number badge */}
            <div style={{ position: 'absolute', top: 8, right: 16, fontSize: 10, fontWeight: 700, color: '#6366f1', background: '#eef2ff', padding: '2px 10px', borderRadius: 10 }}>
              Page {pageIdx + 1} / {pages.length}
            </div>
            <div style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${pageScale})`, transformOrigin: 'top center', flexShrink: 0 }}>
              <div style={{ width: PAGE_W, height: PAGE_H, background: '#fff', boxShadow: '0 2px 20px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>

                {/* Header */}
                <div style={{ flexShrink: 0, padding: '20px 28px 8px', pointerEvents: 'none' }}>
                  <div dangerouslySetInnerHTML={{ __html: headerHtml }} />
                </div>
                {headerHtml && <div style={{ margin: '0 28px', borderBottom: '1.5px solid #e5e7eb' }} />}

                {/* Body — clickable for AI edit */}
                <div
                  style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
                  onClick={e => handleBodyClick(e, pageIdx)}
                >
                  <div
                    style={{ padding: '12px 28px', minHeight: 200, fontSize: 11, lineHeight: 1.7, fontFamily: "'Poppins', Arial, sans-serif" }}
                    dangerouslySetInnerHTML={{ __html: pageBody }}
                  />
                  <div style={{ position: 'absolute', inset: 0, border: '2px dashed #2e7d32', pointerEvents: 'none', background: 'rgba(46,125,50,0.02)', zIndex: 10 }} />

                  {/* Edit modal (floating near clicked element) */}
                  {editModal && editModal.pageIndex === pageIdx && (
                    <div
                      style={{
                        position: 'absolute',
                        left: Math.max(0, Math.min(editModal.x, PAGE_W - 310)),
                        top: editModal.y,
                        zIndex: 100,
                        background: '#fff',
                        border: '2px solid #6366f1',
                        borderRadius: 10,
                        boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
                        padding: 12,
                        width: 300,
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>AI Edit Section</div>
                      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 8, maxHeight: 40, overflow: 'hidden', textOverflow: 'ellipsis', border: '1px solid #e5e7eb', borderRadius: 4, padding: '4px 6px', background: '#f8fafc' }}>
                        {editModal.elementHtml.replace(/<[^>]+>/g, '').substring(0, 80)}...
                      </div>
                      <input
                        ref={editInputRef}
                        value={editPrompt}
                        onChange={e => setEditPrompt(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitEdit(); if (e.key === 'Escape') closeEditModal(); }}
                        placeholder="e.g. make more formal, add penalty clause..."
                        style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #d1d5db', borderRadius: 6, fontSize: 11, outline: 'none', fontFamily: 'inherit', marginBottom: 8 }}
                        onFocus={e => e.target.style.borderColor = '#6366f1'}
                        onBlur={e => e.target.style.borderColor = '#d1d5db'}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={submitEdit} disabled={editLoading || !editPrompt.trim()}
                          style={{ flex: 1, padding: '5px 0', background: editLoading ? '#94a3b8' : '#6366f1', color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: editLoading ? 'wait' : 'pointer' }}>
                          {editLoading ? 'Updating...' : 'Apply'}
                        </button>
                        <button onClick={closeEditModal}
                          style={{ padding: '5px 12px', background: '#f1f5f9', color: '#475569', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                {footerHtml && <div style={{ margin: '0 28px', borderBottom: '1.5px solid #e5e7eb' }} />}
                <div style={{ flexShrink: 0, marginTop: 'auto', padding: '4px 28px 14px', pointerEvents: 'none' }}>
                  <div dangerouslySetInnerHTML={{ __html: footerHtml }} />
                </div>
              </div>
            </div>
          </div>
        )) : (
          /* Empty state — single blank page */
          <div style={{ background: '#e5e7eb', padding: 16, borderRadius: 8, width: '100%', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
            <div style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${pageScale})`, transformOrigin: 'top center', flexShrink: 0 }}>
              <div style={{ width: PAGE_W, height: PAGE_H, background: '#fff', boxShadow: '0 2px 20px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                <div style={{ flexShrink: 0, padding: '20px 28px 8px', pointerEvents: 'none' }}>
                  <div dangerouslySetInnerHTML={{ __html: headerHtml }} />
                </div>
                {headerHtml && <div style={{ margin: '0 28px', borderBottom: '1.5px solid #e5e7eb' }} />}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13, fontStyle: 'italic', padding: 28 }}>
                  {generating ? 'Generating document...' : 'Select a company, enter a prompt, and click Generate'}
                </div>
                {footerHtml && <div style={{ margin: '0 28px', borderBottom: '1.5px solid #e5e7eb' }} />}
                <div style={{ flexShrink: 0, marginTop: 'auto', padding: '4px 28px 14px', pointerEvents: 'none' }}>
                  <div dangerouslySetInnerHTML={{ __html: footerHtml }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Size indicator */}
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: -10 }}>
          A4 &mdash; {PAGE_W}&times;{PAGE_H}pt
          {selectedCompany && <> &mdash; <strong style={{ color: '#2e7d32' }}>{selectedCompany.name}</strong></>}
          {pages.length > 1 && <> &mdash; <strong style={{ color: '#6366f1' }}>{pages.length} pages</strong></>}
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#475569',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
};

const selectStyle = {
  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit',
  background: '#fff', cursor: 'pointer',
};

function Btn({ label, bg, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: '5px 12px', background: bg, color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );
}
