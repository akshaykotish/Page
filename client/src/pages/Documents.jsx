import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { formatDate } from '../utils/formatters';
import { api, ApiError } from '../utils/api';

const DOC_TYPES = ['Letter', 'Invoice', 'Notice', 'Agreement', 'General'];

const FROM_ALIASES = [
  { email: 'letter@akshaykotish.com', label: 'Letter', forTypes: ['Letter'] },
  { email: 'bills@akshaykotish.com', label: 'Bills', forTypes: ['Invoice'] },
  { email: 'legal@akshaykotish.com', label: 'Legal', forTypes: ['Notice', 'Agreement'] },
  { email: 'documents@akshaykotish.com', label: 'Documents', forTypes: ['General'] },
  { email: 'accounts@akshaykotish.com', label: 'Accounts', forTypes: [] },
  { email: 'payments@akshaykotish.com', label: 'Payments', forTypes: [] },
  { email: 'admin@akshaykotish.com', label: 'Admin', forTypes: [] },
  { email: 'mail@akshaykotish.com', label: 'General Mail', forTypes: [] },
];

function getDefaultAlias(docType) {
  const match = FROM_ALIASES.find(a => a.forTypes.includes(docType));
  return match ? match.email : 'documents@akshaykotish.com';
}

const QUICK_PROMPTS = [
  { label: 'Engagement Letter', prompt: 'Draft a professional engagement letter for audit services' },
  { label: 'Service Agreement', prompt: 'Draft a service agreement for consulting services for 12 months' },
  { label: 'Payment Reminder', prompt: 'Draft a formal notice for overdue payment of invoice' },
  { label: 'NDA', prompt: 'Draft a non-disclosure agreement for business collaboration' },
  { label: 'Experience Letter', prompt: 'Draft an experience letter for an employee' },
  { label: 'NOC', prompt: 'Draft a no objection certificate' }
];

const COMPANY = {
  name: 'Akshay Kotish & Co.',
  legalName: 'Akshay Lakshay Kotish Private Limited',
  tagline: 'Chartered Accountants & Business Consultants',
  address: 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027, India',
  gstin: '06AAWCA4919K1Z3',
  cin: 'U72900HR2022PTC101170',
  pan: 'AAWCA4919K',
  phone: '+91 98967 70369',
  email: 'connect@akshaykotish.com',
  website: 'www.akshaykotish.com',
};

export default function Documents() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDoc, setActiveDoc] = useState(null);
  const [showList, setShowList] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [titleEdit, setTitleEdit] = useState('');
  const [typeEdit, setTypeEdit] = useState('General');
  const [error, setError] = useState('');
  const editorRef = useRef(null);
  const saveTimerRef = useRef(null);
  const abortControllerRef = useRef(null);

  // AI Document Drafter state
  const [showAIDrafter, setShowAIDrafter] = useState(false);
  const [aiDocPrompt, setAiDocPrompt] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiDocResult, setAiDocResult] = useState(null);
  const [aiError, setAiError] = useState('');

  // Send Email state
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendSubject, setSendSubject] = useState('');
  const [sendCoverMessage, setSendCoverMessage] = useState('');
  const [sendFromAlias, setSendFromAlias] = useState('');
  const [sendPdfFile, setSendPdfFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState('');
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    fetchDocuments();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  async function fetchDocuments() {
    setLoading(true);
    setError('');
    try {
      const q = query(collection(db, 'documents'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setDocuments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      const message = err?.message || 'Failed to fetch documents';
      setError(message);
      console.error('Error fetching documents:', err);
    }
    setLoading(false);
  }

  async function handleNewDocument() {
    const data = {
      title: 'Untitled Document',
      content: '<p>Start typing here...</p>',
      type: 'General',
      author: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      setError('');
      const ref = await addDoc(collection(db, 'documents'), data);
      const newDoc = { id: ref.id, ...data };
      setDocuments(prev => [newDoc, ...prev]);
      openDocument(newDoc);
    } catch (err) {
      const message = err?.message || 'Failed to create document';
      setError(message);
      console.error('Error creating document:', err);
    }
  }

  function openDocument(docItem) {
    setActiveDoc(docItem);
    setTitleEdit(docItem.title);
    setTypeEdit(docItem.type || 'General');
    setShowList(false);
    setShowPreview(false);
    setError('');
    // Set content after render
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = docItem.content || '';
      }
    }, 0);
  }

  function backToList() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveNow();
    }
    setActiveDoc(null);
    setShowList(true);
    setShowPreview(false);
    setError('');
    fetchDocuments();
  }

  const saveNow = useCallback(async () => {
    if (!activeDoc || !editorRef.current) return;
    const content = editorRef.current.innerHTML;
    try {
      await updateDoc(doc(db, 'documents', activeDoc.id), {
        title: titleEdit,
        content,
        type: typeEdit,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error saving document:', err);
    }
  }, [activeDoc, titleEdit, typeEdit]);

  function debouncedSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveNow, 2000);
  }

  function handleContentChange() {
    debouncedSave();
  }

  function handleTitleChange(e) {
    setTitleEdit(e.target.value);
    debouncedSave();
  }

  function handleTypeChange(e) {
    setTypeEdit(e.target.value);
    debouncedSave();
  }

  async function handleDeleteDoc(id) {
    if (!window.confirm('Delete this document permanently?')) return;
    try {
      setError('');
      await deleteDoc(doc(db, 'documents', id));
      if (activeDoc?.id === id) {
        setActiveDoc(null);
        setShowList(true);
      }
      fetchDocuments();
    } catch (err) {
      const message = err?.message || 'Failed to delete document';
      setError(message);
      console.error('Error deleting document:', err);
    }
  }

  // AI Document Drafter functions
  async function handleAIDraft() {
    if (!aiDocPrompt.trim()) {
      setAiError('Please describe the document you need.');
      return;
    }
    setAiDrafting(true);
    setAiDocResult(null);
    setAiError('');

    abortControllerRef.current = new AbortController();

    try {
      const res = await api.post('/ai/draft-document', {
        prompt: aiDocPrompt,
      }, { signal: abortControllerRef.current.signal });
      setAiDocResult(res);
    } catch (err) {
      if (err?.code === 'TIMEOUT') {
        setAiError('AI request timed out. Please try again.');
      } else {
        setAiError(err?.message || 'Failed to generate document. Please try again.');
      }
      console.error('AI Draft error:', err);
    }
    setAiDrafting(false);
  }

  async function useAIDraft() {
    if (!aiDocResult) return;
    const data = {
      title: aiDocResult.title || 'AI Drafted Document',
      content: aiDocResult.content || '',
      type: aiDocResult.type || 'General',
      author: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      setError('');
      const ref = await addDoc(collection(db, 'documents'), data);
      const newDoc = { id: ref.id, ...data };
      setDocuments(prev => [newDoc, ...prev]);
      setShowAIDrafter(false);
      setAiDocResult(null);
      setAiDocPrompt('');
      openDocument(newDoc);
    } catch (err) {
      const message = 'Failed to save the drafted document.';
      setError(message);
      console.error('Error creating AI drafted document:', err);
    }
  }

  // ===== SEND EMAIL FUNCTIONS =====
  function openSendEmail() {
    if (!activeDoc) return;
    // Save latest content first
    saveNow();
    setSendTo('');
    setSendSubject(`${typeEdit}: ${titleEdit} | ${COMPANY.name}`);
    setSendCoverMessage('');
    setSendFromAlias(getDefaultAlias(typeEdit));
    setSendPdfFile(null);
    setSendSuccess('');
    setSendError('');
    setShowSendEmail(true);
  }

  function closeSendEmail() {
    setShowSendEmail(false);
    setSendSuccess('');
    setSendError('');
  }

  function handlePdfSelect(e) {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setSendPdfFile(file);
      setSendError('');
    } else if (file) {
      setSendError('Please select a PDF file.');
      e.target.value = '';
    }
  }

  async function handleSendEmail(e) {
    e.preventDefault();
    if (!sendTo.trim()) {
      setSendError('Please enter recipient email.');
      return;
    }
    if (!activeDoc) return;

    setSending(true);
    setSendSuccess('');
    setSendError('');
    abortControllerRef.current = new AbortController();

    try {
      // Save latest content
      await saveNow();

      const payload = {
        to: sendTo.trim(),
        subject: sendSubject || `${typeEdit}: ${titleEdit}`,
        coverMessage: sendCoverMessage.trim(),
        fromAlias: sendFromAlias,
      };

      // If PDF attached, convert to base64
      if (sendPdfFile) {
        const base64 = await fileToBase64(sendPdfFile);
        payload.pdfBase64 = base64;
        payload.pdfFileName = sendPdfFile.name;
      }

      await api.post(`/documents/${activeDoc.id}/send-email`, payload, { signal: abortControllerRef.current.signal });
      setSendSuccess(`Document sent to ${sendTo} from ${sendFromAlias}`);
      setTimeout(() => closeSendEmail(), 3000);
    } catch (err) {
      if (err?.code === 'TIMEOUT') {
        setSendError('Request timed out. Please try again.');
      } else {
        setSendError(err?.message || 'Failed to send email.');
      }
      console.error('Error sending document email:', err);
    }
    setSending(false);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // Remove "data:application/pdf;base64," prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function execCmd(command, value = null) {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    debouncedSave();
  }

  function handlePrint() {
    const content = editorRef.current?.innerHTML || '';
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${titleEdit || 'Document'} — ${COMPANY.name}</title>
  <style>
    @page { size: A4; margin: 8mm 12mm 18mm 12mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #1a1a1a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 100%; min-height: 100vh; position: relative; }
    /* HEADER — Modern dark style */
    .header { background: #1e293b; color: #fff; padding: 18px 24px 16px; margin-bottom: 0; border-radius: 0; }
    .header table { width: 100%; border-collapse: collapse; }
    .header td { border: none; padding: 0; vertical-align: top; }
    .header h1 { font-size: 18pt; font-weight: 800; color: #fff; margin: 0 0 2px; letter-spacing: 0.5px; }
    .header .legal { font-size: 7pt; color: #94a3b8; font-style: italic; margin-bottom: 3px; }
    .header .tagline { font-size: 7.5pt; color: #c0e040; font-weight: 600; margin-bottom: 6px; }
    .header .statutory { font-family: 'Courier New', monospace; font-size: 7pt; color: #64748b; line-height: 1.6; }
    .header .contact { text-align: right; font-size: 7.5pt; color: #94a3b8; line-height: 2; }
    .header .contact .website { color: #c0e040; font-weight: 700; font-size: 8.5pt; }
    /* Address bar */
    .address-bar { background: #f8fafc; padding: 5px 24px; font-size: 7pt; color: #64748b; border-bottom: 1px solid #e2e8f0; }
    /* BODY */
    .body { font-size: 11pt; line-height: 1.8; min-height: 600px; padding: 20px 24px; }
    .body p { margin-bottom: 0.6em; }
    .body h1 { font-size: 16pt; margin: 0.8em 0 0.4em; font-weight: 700; }
    .body h2 { font-size: 14pt; margin: 0.6em 0 0.3em; font-weight: 700; }
    .body h3 { font-size: 12pt; margin: 0.5em 0 0.3em; font-weight: 600; }
    .body ul, .body ol { margin-left: 1.5em; margin-bottom: 0.5em; }
    .body table { width: 100%; border-collapse: collapse; margin: 0.5em 0; }
    .body table th, .body table td { border: 1px solid #ddd; padding: 6px 10px; font-size: 10pt; }
    .body table th { background: #f5f5f5; font-weight: 700; }
    /* FOOTER */
    .footer { position: fixed; bottom: 0; left: 0; right: 0; background: #f8fafc; border-top: 2px solid #2e7d32; padding: 6px 24px; text-align: center; font-size: 7pt; color: #64748b; line-height: 1.5; }
    .footer .brand { color: #1e293b; font-weight: 700; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <table><tr>
        <td>
          <h1>${COMPANY.name.toUpperCase()}</h1>
          <div class="legal">A Unit of ${COMPANY.legalName}</div>
          <div class="tagline">${COMPANY.tagline}</div>
          <div class="statutory">GSTIN: ${COMPANY.gstin} &nbsp;&bull;&nbsp; CIN: ${COMPANY.cin} &nbsp;&bull;&nbsp; PAN: ${COMPANY.pan}</div>
        </td>
        <td class="contact">
          ${COMPANY.email}<br>
          ${COMPANY.phone}<br>
          <span class="website">${COMPANY.website}</span>
        </td>
      </tr></table>
    </div>
    <div class="address-bar">${COMPANY.address}</div>
    <div class="body">${content}</div>
    <div class="footer">
      <span class="brand">${COMPANY.name}</span> (A Unit of ${COMPANY.legalName}) &nbsp;|&nbsp; CIN: ${COMPANY.cin} &nbsp;|&nbsp; GSTIN: ${COMPANY.gstin}<br>
      ${COMPANY.email} &nbsp;&bull;&nbsp; ${COMPANY.phone} &nbsp;&bull;&nbsp; ${COMPANY.website} &nbsp;&bull;&nbsp; ${COMPANY.address}
    </div>
  </div>
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`);
    printWindow.document.close();
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="loader"></div></div>;
  }

  // Document list view
  if (showList && !activeDoc) {
    return (
      <div>
        {error && (
          <div style={{ padding: '12px 18px', marginBottom: '1rem', borderRadius: '6px', border: '2px solid #ef4444', background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: '14px' }}>
            {error}
          </div>
        )}

        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Documents ({documents.length})</h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => { setShowAIDrafter(!showAIDrafter); setAiDocResult(null); }}
              style={{
                padding: '0.5rem 1rem',
                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
                transition: 'all 0.2s'
              }}
            >
              <span style={{ fontSize: '1rem' }}>&#9733;</span> AI Draft
            </button>
            <button className="btn btn-primary" onClick={handleNewDocument}>+ New Document</button>
          </div>
        </div>

        {/* AI Document Drafter Panel */}
        {showAIDrafter && (
          <div style={{
            marginBottom: '1.5rem',
            borderRadius: '12px',
            border: '2px solid #7c3aed',
            background: 'linear-gradient(135deg, #faf5ff 0%, #f5f3ff 50%, #ede9fe 100%)',
            boxShadow: '0 4px 24px rgba(124,58,237,0.15)',
            overflow: 'hidden'
          }}>
            {/* Drafter Header */}
            <div style={{
              background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
              padding: '0.85rem 1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.1rem', color: '#fff' }}>&#9733;</span>
                <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem', fontWeight: 700 }}>AI Document Drafter</h3>
                <span style={{ fontSize: '0.7rem', color: '#c4b5fd', marginLeft: '0.5rem' }}>
                  {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
              <button
                onClick={() => { setShowAIDrafter(false); setAiDocResult(null); }}
                style={{
                  background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
                  width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer',
                  fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                title="Close"
              >&#10005;</button>
            </div>

            {/* Drafter Body */}
            <div style={{ padding: '1.25rem' }}>
              {aiError && (
                <div style={{ padding: '12px 18px', marginBottom: '1rem', borderRadius: '8px', border: '2px solid #ef4444', background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: '14px' }}>
                  {aiError}
                </div>
              )}

              {/* AI Result Preview */}
              {aiDocResult ? (
                <div>
                  <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #ddd6fe', padding: '1.25rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <h4 style={{ margin: '0 0 0.25rem 0', color: '#5b21b6', fontSize: '1.05rem' }}>{aiDocResult.title || 'Generated Document'}</h4>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '0.15rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600 }}>
                            {aiDocResult.type || 'document'}
                          </span>
                          {aiDocResult.summary && <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{aiDocResult.summary}</span>}
                        </div>
                      </div>
                    </div>
                    {/* A4 Preview */}
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', padding: '1rem', maxHeight: '400px', overflowY: 'auto', background: '#fefefe', fontFamily: 'Georgia, serif', fontSize: '0.85rem', lineHeight: 1.7 }}
                      dangerouslySetInnerHTML={{ __html: aiDocResult.content || '' }}
                    />
                  </div>
                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button onClick={useAIDraft} style={{ padding: '0.55rem 1.25rem', background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, boxShadow: '0 2px 8px rgba(124,58,237,0.3)' }}>
                      Use This Draft
                    </button>
                    <button onClick={handleAIDraft} disabled={aiDrafting} style={{ padding: '0.55rem 1.25rem', background: '#fff', color: '#7c3aed', border: '2px solid #7c3aed', borderRadius: '6px', cursor: aiDrafting ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 600, opacity: aiDrafting ? 0.6 : 1 }}>
                      {aiDrafting ? 'Regenerating...' : 'Regenerate'}
                    </button>
                    <button onClick={() => setAiDocResult(null)} style={{ padding: '0.55rem 1.25rem', background: '#fff', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                      Discard
                    </button>
                  </div>
                </div>
              ) : (
                /* Single Input Form */
                <div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <textarea
                        value={aiDocPrompt}
                        onChange={e => setAiDocPrompt(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && aiDocPrompt.trim()) { e.preventDefault(); handleAIDraft(); } }}
                        placeholder="Describe the document you need... e.g. Draft a proposal letter to NISG for AI chatbot deployment at NTA, addressed to The Competent Authority, New Delhi"
                        rows={3}
                        style={{
                          width: '100%', padding: '0.7rem 0.85rem', borderRadius: '8px',
                          border: '1.5px solid #8b5cf6', fontSize: '0.9rem', outline: 'none',
                          resize: 'vertical', fontFamily: 'inherit', background: '#fff',
                          boxShadow: '0 0 0 3px rgba(139,92,246,0.1)', color: '#1e293b',
                        }}
                      />
                    </div>
                    <button
                      onClick={handleAIDraft}
                      disabled={aiDrafting || !aiDocPrompt.trim()}
                      style={{
                        padding: '0.7rem 1.5rem', height: 'fit-content',
                        background: (aiDrafting || !aiDocPrompt.trim()) ? '#a78bfa' : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                        color: '#fff', border: 'none', borderRadius: '8px',
                        cursor: (aiDrafting || !aiDocPrompt.trim()) ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap',
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        boxShadow: (aiDrafting || !aiDocPrompt.trim()) ? 'none' : '0 4px 14px rgba(124,58,237,0.35)',
                        opacity: (aiDrafting || !aiDocPrompt.trim()) ? 0.7 : 1,
                      }}
                    >
                      {aiDrafting && <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'aidraft-spin 0.7s linear infinite' }} />}
                      {aiDrafting ? 'Drafting...' : 'Draft'}
                    </button>
                  </div>
                  <style>{`@keyframes aidraft-spin { to { transform: rotate(360deg); } }`}</style>
                  {/* Quick Prompts */}
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {QUICK_PROMPTS.map(qp => (
                      <button
                        key={qp.label}
                        onClick={() => setAiDocPrompt(qp.prompt)}
                        style={{
                          padding: '0.25rem 0.6rem',
                          background: aiDocPrompt === qp.prompt ? '#7c3aed' : '#ede9fe',
                          color: aiDocPrompt === qp.prompt ? '#fff' : '#6d28d9',
                          border: '1px solid ' + (aiDocPrompt === qp.prompt ? '#7c3aed' : '#c4b5fd'),
                          borderRadius: '999px', cursor: 'pointer', fontSize: '0.72rem',
                          fontWeight: 600, transition: 'all 0.15s', whiteSpace: 'nowrap',
                        }}
                      >{qp.label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {documents.length === 0 ? (
          <div className="card" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
            <p style={{ fontSize: '1.1rem' }}>No documents yet. Create your first document.</p>
          </div>
        ) : (
          <div className="card" style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem' }}>Title</th>
                  <th style={{ padding: '0.75rem' }}>Type</th>
                  <th style={{ padding: '0.75rem' }}>Created</th>
                  <th style={{ padding: '0.75rem' }}>Last Updated</th>
                  <th style={{ padding: '0.75rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }} onClick={() => openDocument(d)}>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{d.title || 'Untitled'}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600 }}>{d.type || 'General'}</span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>{formatDate(d.createdAt)}</td>
                    <td style={{ padding: '0.75rem' }}>{formatDate(d.updatedAt)}</td>
                    <td style={{ padding: '0.75rem' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openDocument(d)}>Open</button>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#2563eb' }} onClick={() => { openDocument(d); setTimeout(() => openSendEmail(), 300); }}>Email</button>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#ef4444' }} onClick={() => handleDeleteDoc(d.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // Document editor view
  return (
    <div>
      {error && (
        <div style={{ padding: '12px 18px', marginBottom: '1rem', borderRadius: '6px', border: '2px solid #ef4444', background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: '14px' }}>
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={backToList}>
            &larr; Back
          </button>
          <input
            type="text"
            value={titleEdit}
            onChange={handleTitleChange}
            placeholder="Document title"
            style={{ border: 'none', fontSize: '1rem', fontWeight: 600, outline: 'none', minWidth: '200px', background: 'transparent' }}
          />
          <select value={typeEdit} onChange={handleTypeChange} style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '0.8rem' }}>
            {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span style={{ fontSize: '0.75rem', color: '#64748b', background: '#f1f5f9', padding: '0.3rem 0.6rem', borderRadius: '4px', whiteSpace: 'nowrap' }}>
            {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={saveNow}>Save</button>
          <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? 'Editor' : 'Preview'}
          </button>
          <button
            onClick={openSendEmail}
            style={{
              padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 600,
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.3rem',
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
            Send Email
          </button>
          <button className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={handlePrint}>Print</button>
        </div>
      </div>

      {/* Send Email Panel */}
      {showSendEmail && (
        <div style={{
          marginBottom: '1rem', borderRadius: '12px', border: '2px solid #2563eb',
          background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
          boxShadow: '0 4px 24px rgba(37,99,235,0.15)', overflow: 'hidden',
        }}>
          {/* Panel Header */}
          <div style={{
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', padding: '1rem 1.25rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#fff" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
              <h3 style={{ margin: 0, color: '#fff', fontSize: '1.05rem', fontWeight: 700 }}>Send Document via Email</h3>
            </div>
            <button onClick={closeSendEmail} style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
              width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer',
              fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }} title="Close">&#10005;</button>
          </div>

          {/* Panel Body */}
          <div style={{ padding: '1.25rem' }}>
            {sendError && (
              <div style={{ padding: '12px 18px', marginBottom: '1rem', borderRadius: '8px', border: '2px solid #ef4444', background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: '14px' }}>
                {sendError}
              </div>
            )}

            {sendSuccess ? (
              <div style={{ background: '#f0fdf4', border: '2px solid #22c55e', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#16a34a' }}>{sendSuccess}</div>
              </div>
            ) : (
              <form onSubmit={handleSendEmail}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '0.85rem' }}>
                  {/* Recipient */}
                  <div>
                    <label style={emailLabelStyle}>Recipient Email *</label>
                    <input type="email" value={sendTo} onChange={e => setSendTo(e.target.value)}
                      placeholder="recipient@example.com" required style={emailInputStyle} />
                  </div>
                  {/* From Alias */}
                  <div>
                    <label style={emailLabelStyle}>Send From</label>
                    <select value={sendFromAlias} onChange={e => setSendFromAlias(e.target.value)} style={emailInputStyle}>
                      {FROM_ALIASES.map(a => (
                        <option key={a.email} value={a.email}>{a.label} — {a.email}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Subject */}
                <div style={{ marginBottom: '0.85rem' }}>
                  <label style={emailLabelStyle}>Subject</label>
                  <input type="text" value={sendSubject} onChange={e => setSendSubject(e.target.value)}
                    placeholder="Email subject" style={emailInputStyle} />
                </div>

                {/* Cover Message */}
                <div style={{ marginBottom: '0.85rem' }}>
                  <label style={emailLabelStyle}>Cover Message <span style={{ fontWeight: 400, color: '#93c5fd' }}>(optional — shown above the document)</span></label>
                  <textarea value={sendCoverMessage} onChange={e => setSendCoverMessage(e.target.value)}
                    placeholder="e.g., Please find the enclosed document for your review and records..."
                    rows={3} style={{ ...emailInputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                </div>

                {/* PDF Attachment */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={emailLabelStyle}>Attach PDF Document <span style={{ fontWeight: 400, color: '#93c5fd' }}>(optional)</span></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <label style={{
                      padding: '0.5rem 1rem', background: '#fff', border: '1.5px dashed #93c5fd',
                      borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', color: '#2563eb',
                      fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.4rem',
                    }}>
                      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
                      {sendPdfFile ? sendPdfFile.name : 'Choose PDF...'}
                      <input type="file" accept="application/pdf" onChange={handlePdfSelect} style={{ display: 'none' }} />
                    </label>
                    {sendPdfFile && (
                      <button type="button" onClick={() => setSendPdfFile(null)} style={{
                        background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '4px',
                        padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#dc2626', cursor: 'pointer',
                      }}>Remove</button>
                    )}
                  </div>
                </div>

                {/* Email Preview Info */}
                <div style={{
                  background: '#fff', borderRadius: '8px', border: '1px solid #bfdbfe',
                  padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#475569',
                }}>
                  <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '0.35rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email Preview</div>
                  <div>The email will include the <strong>company letterpad header</strong> (same style as invoice emails), your cover message, and the full document content rendered as HTML.</div>
                  {sendPdfFile && <div style={{ marginTop: '0.25rem', color: '#2563eb' }}>PDF "{sendPdfFile.name}" will be attached.</div>}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="submit" disabled={sending} style={{
                    padding: '0.6rem 1.5rem', background: sending ? '#93c5fd' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                    color: '#fff', border: 'none', borderRadius: '6px', cursor: sending ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem',
                    boxShadow: sending ? 'none' : '0 2px 12px rgba(37,99,235,0.35)',
                  }}>
                    {sending && <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'emailspin 0.7s linear infinite' }} />}
                    {sending ? 'Sending...' : 'Send Email'}
                  </button>
                  <button type="button" onClick={closeSendEmail} style={{
                    padding: '0.6rem 1.25rem', background: '#fff', color: '#6b7280',
                    border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer',
                    fontSize: '0.85rem', fontWeight: 500,
                  }}>Cancel</button>
                </div>
                <style>{`@keyframes emailspin { to { transform: rotate(360deg); } }`}</style>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Formatting toolbar */}
      {!showPreview && (
        <div className="card" style={{ padding: '0.5rem 0.75rem', marginBottom: '1rem', display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <ToolBtn label="B" style={{ fontWeight: 700 }} onClick={() => execCmd('bold')} />
          <ToolBtn label="I" style={{ fontStyle: 'italic' }} onClick={() => execCmd('italic')} />
          <ToolBtn label="U" style={{ textDecoration: 'underline' }} onClick={() => execCmd('underline')} />
          <span style={{ width: '1px', height: '20px', background: '#d1d5db', margin: '0 0.25rem' }} />
          <ToolBtn label="H1" onClick={() => execCmd('formatBlock', 'h1')} />
          <ToolBtn label="H2" onClick={() => execCmd('formatBlock', 'h2')} />
          <ToolBtn label="H3" onClick={() => execCmd('formatBlock', 'h3')} />
          <ToolBtn label="P" onClick={() => execCmd('formatBlock', 'p')} />
          <span style={{ width: '1px', height: '20px', background: '#d1d5db', margin: '0 0.25rem' }} />
          <ToolBtn label="UL" onClick={() => execCmd('insertUnorderedList')} />
          <ToolBtn label="OL" onClick={() => execCmd('insertOrderedList')} />
          <span style={{ width: '1px', height: '20px', background: '#d1d5db', margin: '0 0.25rem' }} />
          <ToolBtn label="Left" onClick={() => execCmd('justifyLeft')} />
          <ToolBtn label="Center" onClick={() => execCmd('justifyCenter')} />
          <ToolBtn label="Right" onClick={() => execCmd('justifyRight')} />
          <ToolBtn label="Justify" onClick={() => execCmd('justifyFull')} />
          <span style={{ width: '1px', height: '20px', background: '#d1d5db', margin: '0 0.25rem' }} />
          <ToolBtn label="Undo" onClick={() => execCmd('undo')} />
          <ToolBtn label="Redo" onClick={() => execCmd('redo')} />
        </div>
      )}

      {/* Editor or Preview */}
      {showPreview ? (
        /* Letterhead Preview — A4 page (210mm x 297mm) */
        <div style={{ width: '210mm', minHeight: '297mm', margin: '0 auto', fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif", background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,0.12)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
          {/* HEADER — Dark modern style */}
          <div style={{ background: '#1e293b', color: '#fff', padding: '22px 30px 18px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody><tr>
              <td style={{ verticalAlign: 'top', padding: 0, border: 'none' }}>
                <h1 style={{ margin: '0 0 3px', fontSize: '22px', fontWeight: 800, letterSpacing: '0.5px', color: '#fff' }}>{COMPANY.name.toUpperCase()}</h1>
                <div style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic', marginBottom: '4px' }}>A Unit of {COMPANY.legalName}</div>
                <div style={{ fontSize: '11px', color: '#c0e040', fontWeight: 600, marginBottom: '8px' }}>{COMPANY.tagline}</div>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: '9px', color: '#64748b', lineHeight: 1.6 }}>
                  GSTIN: {COMPANY.gstin} &nbsp;&bull;&nbsp; CIN: {COMPANY.cin} &nbsp;&bull;&nbsp; PAN: {COMPANY.pan}
                </div>
              </td>
              <td style={{ verticalAlign: 'top', textAlign: 'right', padding: 0, border: 'none', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', lineHeight: 2 }}>
                  {COMPANY.email}<br />
                  {COMPANY.phone}<br />
                  <span style={{ color: '#c0e040', fontWeight: 700, fontSize: '11px' }}>{COMPANY.website}</span>
                </div>
              </td>
            </tr></tbody></table>
          </div>
          {/* Address bar */}
          <div style={{ background: '#f8fafc', padding: '6px 30px', borderBottom: '1px solid #e2e8f0', fontSize: '9px', color: '#64748b' }}>
            {COMPANY.address}
          </div>
          {/* BODY — fills remaining A4 space */}
          <div
            style={{ padding: '24px 30px 80px', minHeight: 'calc(297mm - 180px)', lineHeight: 1.8, fontSize: '12px', color: '#1a1a1a' }}
            dangerouslySetInnerHTML={{ __html: editorRef.current?.innerHTML || activeDoc?.content || '' }}
          />
          {/* FOOTER — pinned at bottom */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#f8fafc', borderTop: '2px solid #2e7d32', padding: '10px 30px', textAlign: 'center' }}>
            <div style={{ fontSize: '8px', color: '#64748b', lineHeight: 1.6 }}>
              <strong style={{ color: '#1e293b' }}>{COMPANY.name}</strong> (A Unit of {COMPANY.legalName}) &nbsp;|&nbsp; CIN: {COMPANY.cin} &nbsp;|&nbsp; GSTIN: {COMPANY.gstin}
            </div>
            <div style={{ fontSize: '7px', color: '#94a3b8', marginTop: '2px' }}>
              {COMPANY.email} &nbsp;&bull;&nbsp; {COMPANY.phone} &nbsp;&bull;&nbsp; {COMPANY.website} &nbsp;&bull;&nbsp; {COMPANY.address}
            </div>
          </div>
        </div>
      ) : (
        /* Rich Text Editor */
        <div className="card" style={{ padding: 0 }}>
          <div
            ref={editorRef}
            contentEditable
            onInput={handleContentChange}
            style={{
              padding: '1.5rem',
              minHeight: '500px',
              outline: 'none',
              lineHeight: 1.7,
              fontSize: '0.95rem',
              fontFamily: 'Georgia, serif'
            }}
            suppressContentEditableWarning
          />
        </div>
      )}
    </div>
  );
}

function ToolBtn({ label, style = {}, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={e => e.preventDefault()}
      style={{
        background: '#f3f4f6',
        border: '1px solid #d1d5db',
        borderRadius: '4px',
        padding: '0.25rem 0.5rem',
        cursor: 'pointer',
        fontSize: '0.75rem',
        fontWeight: 500,
        minWidth: '28px',
        textAlign: 'center',
        ...style
      }}
    >
      {label}
    </button>
  );
}

const emailLabelStyle = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#1e3a5f', marginBottom: '0.3rem' };
const emailInputStyle = { width: '100%', padding: '0.55rem 0.75rem', borderRadius: '6px', border: '1.5px solid #93c5fd', fontSize: '0.85rem', outline: 'none', background: '#fff', color: '#1e293b', boxSizing: 'border-box' };
