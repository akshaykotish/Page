import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';

// ─── Constants ────────────────────────────────────────────────────────────────

const FOLDERS = [
  { key: 'inbox', label: 'Inbox', icon: '\u{1F4E5}' },
  { key: 'starred', label: 'Starred', icon: '\u2B50' },
  { key: 'sent', label: 'Sent', icon: '\u{1F4E4}' },
  { key: 'drafts', label: 'Drafts', icon: '\u{1F4DD}' },
  { key: 'scheduled', label: 'Scheduled', icon: '\u{1F552}' },
  { key: 'trash', label: 'Trash', icon: '\u{1F5D1}' },
];

const LABEL_COLORS = {
  Important: '#dc2626',
  Work: '#2563eb',
  Personal: '#7c3aed',
  Finance: '#059669',
  Urgent: '#ea580c',
};

const PAGE_SIZE = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString([], {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function senderName(email) {
  if (!email) return 'Unknown';
  if (email.fromName) return email.fromName;
  const addr = email.from || '';
  return addr.split('@')[0] || addr;
}

function recipientDisplay(email) {
  const to = email.to;
  if (Array.isArray(to)) return to.join(', ');
  return to || '';
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Mail() {
  // Navigation
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [view, setView] = useState('list'); // 'list' | 'thread' | 'compose'

  // Data
  const [emails, setEmails] = useState([]);
  const [thread, setThread] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [labels, setLabels] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [folderCounts, setFolderCounts] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({});

  // Pagination
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);

  // UI state
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Compose state
  const [compose, setCompose] = useState({ to: '', cc: '', bcc: '', subject: '', html: '', draftId: null, threadId: '', replyTo: '' });
  const [showCc, setShowCc] = useState(false);
  const [sending, setSending] = useState(false);

  // Contact suggestions
  const [contactQuery, setContactQuery] = useState('');
  const [contactSuggestions, setContactSuggestions] = useState([]);
  const [activeField, setActiveField] = useState(null);

  const searchTimeout = useRef(null);
  const toastTimeout = useRef(null);

  // ─── Toast helper ───────────────────────────────────────────────────────────

  function showToast(msg) {
    setToast(msg);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(''), 3000);
  }

  // ─── Data loading ───────────────────────────────────────────────────────────

  const loadFolderCounts = useCallback(async () => {
    try {
      const data = await api.get('/mail/folder-counts');
      setFolderCounts(data.counts || {});
      setUnreadCounts(data.unreadCounts || {});
    } catch {}
  }, []);

  const loadLabels = useCallback(async () => {
    try { setLabels(await api.get('/mail/labels')); } catch {}
  }, []);

  const loadEmails = useCallback(async (folder, pageNum, searchTerm) => {
    setLoading(true);
    setError('');
    try {
      if (folder === 'sent') {
        const data = await api.get(`/mail/sent?page=${pageNum}&limit=${PAGE_SIZE}${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ''}`);
        setEmails(data.emails || []);
        setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
      } else if (folder === 'drafts') {
        const data = await api.get('/mail/drafts');
        setDrafts(data || []);
        setEmails([]);
      } else if (folder === 'scheduled') {
        const data = await api.get('/mail/scheduled');
        setScheduled(data || []);
        setEmails([]);
      } else if (folder === 'starred') {
        const data = await api.get(`/mail/inbox?page=${pageNum}&limit=${PAGE_SIZE}&starred=true${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ''}`);
        setEmails(data.emails || []);
        setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
      } else {
        const folderParam = folder === 'inbox' ? 'inbox' : folder;
        const data = await api.get(`/mail/inbox?page=${pageNum}&limit=${PAGE_SIZE}&folder=${folderParam}${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ''}`);
        setEmails(data.emails || []);
        setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
      }
    } catch (err) {
      setError(err.message || 'Failed to load emails');
    }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    loadFolderCounts();
    loadLabels();
  }, [loadFolderCounts, loadLabels]);

  // Reload on folder/page/search change
  useEffect(() => {
    setSelected(new Set());
    setView('list');
    loadEmails(activeFolder, page, search);
  }, [activeFolder, page, search, loadEmails]);

  // Search debounce
  function handleSearchInput(val) {
    setSearchInput(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 400);
  }

  // ─── Contact autocomplete ──────────────────────────────────────────────────

  async function searchContacts(q) {
    if (!q || q.length < 2) { setContactSuggestions([]); return; }
    try {
      const data = await api.get(`/mail/contacts?q=${encodeURIComponent(q)}`);
      setContactSuggestions(data || []);
    } catch { setContactSuggestions([]); }
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  async function toggleRead(emailId, currentRead) {
    try {
      await api.patch(`/mail/inbox/${emailId}`, { read: !currentRead });
      setEmails(prev => prev.map(e => e.id === emailId ? { ...e, read: !currentRead } : e));
      loadFolderCounts();
    } catch (err) { showToast(err.message || 'Failed'); }
  }

  async function toggleStar(emailId, currentStarred, e) {
    if (e) e.stopPropagation();
    try {
      await api.patch(`/mail/inbox/${emailId}`, { starred: !currentStarred });
      setEmails(prev => prev.map(em => em.id === emailId ? { ...em, starred: !currentStarred } : em));
      if (thread) {
        setThread(prev => ({
          ...prev,
          emails: prev.emails.map(em => em.id === emailId ? { ...em, starred: !currentStarred } : em),
        }));
      }
      loadFolderCounts();
    } catch (err) { showToast(err.message || 'Failed'); }
  }

  async function deleteEmail(emailId, e) {
    if (e) e.stopPropagation();
    try {
      await api.delete(`/mail/inbox/${emailId}`);
      setEmails(prev => prev.filter(em => em.id !== emailId));
      if (view === 'thread') setView('list');
      loadFolderCounts();
      showToast('Email moved to trash');
    } catch (err) { showToast(err.message || 'Failed'); }
  }

  async function moveToFolder(emailId, folder) {
    try {
      await api.patch(`/mail/inbox/${emailId}`, { folder });
      setEmails(prev => prev.filter(em => em.id !== emailId));
      loadFolderCounts();
      showToast(`Moved to ${folder}`);
    } catch (err) { showToast(err.message || 'Failed'); }
  }

  async function bulkAction(action, extra = {}) {
    if (selected.size === 0) return;
    try {
      await api.post('/mail/bulk', { ids: Array.from(selected), action, ...extra });
      setSelected(new Set());
      loadEmails(activeFolder, page, search);
      loadFolderCounts();
      showToast(`${action} applied to ${selected.size} email(s)`);
    } catch (err) { showToast(err.message || 'Bulk action failed'); }
  }

  // ─── Thread ─────────────────────────────────────────────────────────────────

  async function openThread(email) {
    if (activeFolder === 'drafts') {
      openDraft(email);
      return;
    }
    setLoading(true);
    try {
      if (!email.read && email.id) {
        await api.patch(`/mail/inbox/${email.id}`, { read: true });
        setEmails(prev => prev.map(e => e.id === email.id ? { ...e, read: true } : e));
        loadFolderCounts();
      }
      if (email.threadId) {
        const data = await api.get(`/mail/threads/${email.threadId}`);
        setThread(data);
      } else {
        setThread({ threadId: email.id, subject: email.subject, emails: [{ ...email, _type: email._type || 'received' }] });
      }
      setView('thread');
    } catch (err) {
      setThread({ threadId: email.id, subject: email.subject, emails: [{ ...email, _type: 'received' }] });
      setView('thread');
    }
    setLoading(false);
  }

  // ─── Compose / Drafts ──────────────────────────────────────────────────────

  function startCompose(defaults = {}) {
    setCompose({ to: '', cc: '', bcc: '', subject: '', html: '', draftId: null, threadId: '', replyTo: '', ...defaults });
    setShowCc(!!defaults.cc || !!defaults.bcc);
    setView('compose');
  }

  function startReply(email) {
    startCompose({
      to: email._type === 'sent' ? recipientDisplay(email) : (email.replyTo || email.from || ''),
      subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject || ''}`,
      threadId: email.threadId || '',
      replyTo: email.messageId || '',
    });
  }

  function openDraft(draft) {
    setCompose({
      to: draft.to || '',
      cc: draft.cc || '',
      bcc: draft.bcc || '',
      subject: draft.subject || '',
      html: draft.html || draft.text || '',
      draftId: draft.id,
      threadId: draft.threadId || '',
      replyTo: '',
    });
    setShowCc(!!draft.cc || !!draft.bcc);
    setView('compose');
  }

  async function saveDraft() {
    try {
      if (compose.draftId) {
        await api.put(`/mail/drafts/${compose.draftId}`, {
          to: compose.to, cc: compose.cc, bcc: compose.bcc,
          subject: compose.subject, html: compose.html,
        });
      } else {
        const res = await api.post('/mail/drafts', {
          to: compose.to, cc: compose.cc, bcc: compose.bcc,
          subject: compose.subject, html: compose.html, threadId: compose.threadId,
        });
        setCompose(prev => ({ ...prev, draftId: res.id }));
      }
      showToast('Draft saved');
      loadFolderCounts();
    } catch (err) { showToast(err.message || 'Failed to save draft'); }
  }

  async function deleteDraft(id, e) {
    if (e) e.stopPropagation();
    try {
      await api.delete(`/mail/drafts/${id}`);
      setDrafts(prev => prev.filter(d => d.id !== id));
      if (compose.draftId === id) setView('list');
      loadFolderCounts();
      showToast('Draft deleted');
    } catch (err) { showToast(err.message || 'Failed'); }
  }

  async function sendEmail() {
    if (!compose.to.trim()) { showToast('Recipient is required'); return; }
    if (!compose.subject.trim()) { showToast('Subject is required'); return; }
    setSending(true);
    try {
      await api.post('/mail/send', {
        to: compose.to,
        cc: compose.cc || undefined,
        bcc: compose.bcc || undefined,
        subject: compose.subject,
        html: compose.html || compose.subject,
        text: stripHtml(compose.html) || compose.subject,
        threadId: compose.threadId || undefined,
        inReplyTo: compose.replyTo || undefined,
      });
      if (compose.draftId) {
        try { await api.delete(`/mail/drafts/${compose.draftId}`); } catch {}
      }
      showToast('Email sent');
      setView('list');
      loadFolderCounts();
      if (activeFolder === 'sent') loadEmails('sent', 1, search);
    } catch (err) { showToast(err.message || 'Failed to send'); }
    setSending(false);
  }

  async function cancelScheduled(id, e) {
    if (e) e.stopPropagation();
    try {
      await api.delete(`/mail/scheduled/${id}`);
      setScheduled(prev => prev.filter(s => s.id !== id));
      showToast('Scheduled email cancelled');
      loadFolderCounts();
    } catch (err) { showToast(err.message || 'Failed'); }
  }

  // ─── Selection ──────────────────────────────────────────────────────────────

  function toggleSelect(id, e) {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    const currentList = activeFolder === 'drafts' ? drafts : emails;
    if (selected.size === currentList.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(currentList.map(e => e.id)));
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', fontFamily: "'Poppins', sans-serif", background: '#f8fafc', overflow: 'hidden' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
          background: '#1a1a1a', color: '#fff', padding: '10px 24px', borderRadius: 8,
          fontSize: 13, fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        }}>
          {toast}
        </div>
      )}

      {/* ── Left Sidebar ── */}
      <div style={{
        width: 220, minWidth: 220, background: '#fff', borderRight: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Compose button */}
        <div style={{ padding: '16px 12px 8px' }}>
          <button
            onClick={() => startCompose()}
            style={{
              width: '100%', padding: '10px 0', background: '#2e7d32', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 2px 8px rgba(46,125,50,0.3)', transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#256d29'}
            onMouseLeave={e => e.currentTarget.style.background = '#2e7d32'}
          >
            <span style={{ fontSize: 18 }}>+</span> Compose
          </button>
        </div>

        {/* Folders */}
        <div style={{ padding: '8px 0', flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '0 12px', marginBottom: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, padding: '8px 0 4px' }}>Folders</div>
          </div>
          {FOLDERS.map(f => {
            const isActive = activeFolder === f.key && view !== 'compose';
            const count = f.key === 'starred' ? (folderCounts.starred || 0)
              : f.key === 'sent' ? (folderCounts.sent || 0)
              : f.key === 'drafts' ? (folderCounts.drafts || 0)
              : (folderCounts[f.key] || 0);
            const unread = unreadCounts[f.key] || 0;
            return (
              <div
                key={f.key}
                onClick={() => { setActiveFolder(f.key); setPage(1); setSearch(''); setSearchInput(''); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px',
                  cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 700 : (unread > 0 ? 600 : 400),
                  color: isActive ? '#2e7d32' : '#374151',
                  background: isActive ? '#f0fdf4' : 'transparent',
                  borderRight: isActive ? '3px solid #2e7d32' : '3px solid transparent',
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>{f.icon}</span>
                <span style={{ flex: 1 }}>{f.label}</span>
                {f.key === 'inbox' && unread > 0 && (
                  <span style={{
                    background: '#2e7d32', color: '#fff', fontSize: 10, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 10, minWidth: 18, textAlign: 'center',
                  }}>{unread}</span>
                )}
                {f.key !== 'inbox' && count > 0 && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{count}</span>
                )}
              </div>
            );
          })}

          {/* Labels */}
          {labels.length > 0 && (
            <>
              <div style={{ padding: '12px 12px 4px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>Labels</div>
              </div>
              {labels.map(l => (
                <div
                  key={l.id}
                  onClick={() => { setActiveFolder(`label:${l.name}`); setPage(1); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px',
                    cursor: 'pointer', fontSize: 12, color: '#475569',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color || '#6366f1', flexShrink: 0 }} />
                  <span>{l.name}</span>
                </div>
              ))}
            </>
          )}

          {/* Contacts quick access */}
          <div style={{ padding: '12px 12px 4px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>Quick Contacts</div>
          </div>
          <ContactsList onCompose={(email) => startCompose({ to: email })} />
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{
          padding: '8px 16px', borderBottom: '1px solid #e5e7eb', background: '#fff',
          display: 'flex', alignItems: 'center', gap: 8, minHeight: 48,
        }}>
          {view === 'thread' && (
            <button onClick={() => setView('list')} style={toolBtn}>
              <span style={{ fontSize: 16 }}>&larr;</span> Back
            </button>
          )}
          {view === 'compose' && (
            <button onClick={() => setView('list')} style={toolBtn}>
              <span style={{ fontSize: 16 }}>&larr;</span> Back
            </button>
          )}

          {view === 'list' && activeFolder !== 'drafts' && activeFolder !== 'scheduled' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === emails.length && emails.length > 0}
                  onChange={selectAll}
                  style={{ marginRight: 6, accentColor: '#2e7d32' }}
                />
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  {selected.size > 0 ? `${selected.size} selected` : 'All'}
                </span>
              </label>

              {selected.size > 0 && (
                <>
                  <button onClick={() => bulkAction('markRead')} style={toolBtn} title="Mark read">Mark Read</button>
                  <button onClick={() => bulkAction('markUnread')} style={toolBtn} title="Mark unread">Mark Unread</button>
                  <button onClick={() => bulkAction('star')} style={toolBtn} title="Star">Star</button>
                  <button onClick={() => bulkAction('delete')} style={{ ...toolBtn, color: '#dc2626' }} title="Delete">Delete</button>
                  <select
                    onChange={e => { if (e.target.value) bulkAction('move', { folder: e.target.value }); e.target.value = ''; }}
                    style={{ ...toolBtn, padding: '4px 8px' }}
                    defaultValue=""
                  >
                    <option value="" disabled>Move to...</option>
                    <option value="inbox">Inbox</option>
                    <option value="trash">Trash</option>
                  </select>
                </>
              )}
            </>
          )}

          <div style={{ flex: 1 }} />

          {/* Search */}
          {view === 'list' && activeFolder !== 'drafts' && activeFolder !== 'scheduled' && (
            <div style={{ position: 'relative', width: 280 }}>
              <input
                type="text"
                placeholder="Search emails..."
                value={searchInput}
                onChange={e => handleSearchInput(e.target.value)}
                style={{
                  width: '100%', padding: '7px 12px 7px 32px', border: '1px solid #d1d5db',
                  borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: 'inherit',
                  background: '#f8fafc',
                }}
                onFocus={e => e.target.style.borderColor = '#2e7d32'}
                onBlur={e => e.target.style.borderColor = '#d1d5db'}
              />
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#94a3b8' }}>
                &#128269;
              </span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ margin: '8px 16px 0', padding: '8px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && view !== 'compose' ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Loading...</div>
          ) : view === 'compose' ? (
            <ComposeView
              compose={compose}
              setCompose={setCompose}
              showCc={showCc}
              setShowCc={setShowCc}
              sending={sending}
              onSend={sendEmail}
              onSaveDraft={saveDraft}
              onSearchContacts={searchContacts}
              contactSuggestions={contactSuggestions}
              setContactSuggestions={setContactSuggestions}
            />
          ) : view === 'thread' && thread ? (
            <ThreadView
              thread={thread}
              onReply={startReply}
              onToggleStar={toggleStar}
              onDelete={deleteEmail}
              onMoveToFolder={moveToFolder}
              onBack={() => setView('list')}
            />
          ) : activeFolder === 'drafts' ? (
            <DraftsView drafts={drafts} onOpen={openDraft} onDelete={deleteDraft} />
          ) : activeFolder === 'scheduled' ? (
            <ScheduledView scheduled={scheduled} onCancel={cancelScheduled} />
          ) : (
            <EmailList
              emails={emails}
              selected={selected}
              onSelect={toggleSelect}
              onOpen={openThread}
              onToggleStar={toggleStar}
              onToggleRead={toggleRead}
              onDelete={deleteEmail}
              isSent={activeFolder === 'sent'}
            />
          )}
        </div>

        {/* Pagination */}
        {view === 'list' && activeFolder !== 'drafts' && activeFolder !== 'scheduled' && pagination.pages > 1 && (
          <div style={{
            padding: '8px 16px', borderTop: '1px solid #e5e7eb', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#64748b',
          }}>
            <span>{pagination.total} email(s)</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{ ...toolBtn, opacity: page <= 1 ? 0.4 : 1 }}
              >
                Prev
              </button>
              <span style={{ padding: '4px 8px', fontSize: 12 }}>Page {page} of {pagination.pages}</span>
              <button
                onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                disabled={page >= pagination.pages}
                style={{ ...toolBtn, opacity: page >= pagination.pages ? 0.4 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Toolbar button style ─────────────────────────────────────────────────────

const toolBtn = {
  padding: '5px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0',
  borderRadius: 5, fontSize: 12, color: '#475569', cursor: 'pointer',
  fontFamily: 'inherit', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4,
};

// ─── Email List ───────────────────────────────────────────────────────────────

function EmailList({ emails, selected, onSelect, onOpen, onToggleStar, onToggleRead, onDelete, isSent }) {
  if (emails.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>&#128235;</div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>No emails here</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>This folder is empty.</div>
      </div>
    );
  }

  return (
    <div>
      {emails.map(email => {
        const isSelected = selected.has(email.id);
        const isUnread = !email.read;
        const preview = stripHtml(email.html || email.text || '').slice(0, 120);
        const date = isSent ? email.sentAt : email.receivedAt;

        return (
          <div
            key={email.id}
            onClick={() => onOpen(email)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', borderBottom: '1px solid #f1f5f9',
              cursor: 'pointer', transition: 'background 0.1s',
              background: isSelected ? '#f0fdf4' : (isUnread ? '#fff' : '#fafbfc'),
              fontWeight: isUnread ? 600 : 400,
            }}
            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isSelected ? '#f0fdf4' : (isUnread ? '#fff' : '#fafbfc'); }}
          >
            {/* Checkbox */}
            {!isSent && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={e => onSelect(email.id, e)}
                onClick={e => e.stopPropagation()}
                style={{ accentColor: '#2e7d32', flexShrink: 0 }}
              />
            )}

            {/* Star */}
            {!isSent && (
              <span
                onClick={e => onToggleStar(email.id, email.starred, e)}
                style={{ cursor: 'pointer', fontSize: 16, color: email.starred ? '#f59e0b' : '#d1d5db', flexShrink: 0 }}
                title={email.starred ? 'Unstar' : 'Star'}
              >
                {email.starred ? '\u2605' : '\u2606'}
              </span>
            )}

            {/* Unread indicator */}
            {!isSent && (
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: isUnread ? '#2e7d32' : 'transparent',
              }} />
            )}

            {/* Sender / Recipient */}
            <div style={{ width: 160, minWidth: 120, flexShrink: 0, fontSize: 13, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isSent ? `To: ${recipientDisplay(email)}` : senderName(email)}
            </div>

            {/* Subject + Preview */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
              <span style={{ fontSize: 13, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300 }}>
                {email.subject || '(No Subject)'}
              </span>
              <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, fontWeight: 400 }}>
                {preview ? `- ${preview}` : ''}
              </span>
            </div>

            {/* Labels */}
            {(email.labels || []).length > 0 && (
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                {email.labels.slice(0, 2).map(l => (
                  <span key={l} style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 600,
                    background: (LABEL_COLORS[l] || '#6366f1') + '18',
                    color: LABEL_COLORS[l] || '#6366f1',
                  }}>{l}</span>
                ))}
              </div>
            )}

            {/* Attachments indicator */}
            {(email.attachments || []).length > 0 && (
              <span style={{ fontSize: 13, color: '#94a3b8', flexShrink: 0 }} title="Has attachments">&#128206;</span>
            )}

            {/* Date */}
            <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 60, textAlign: 'right' }}>
              {formatDate(date)}
            </div>

            {/* Quick actions */}
            {!isSent && (
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} className="email-actions">
                <button
                  onClick={e => { e.stopPropagation(); onToggleRead(email.id, email.read); }}
                  style={{ ...miniBtn, fontSize: 11 }}
                  title={email.read ? 'Mark unread' : 'Mark read'}
                >
                  {email.read ? '\u{1F4E9}' : '\u{1F4E8}'}
                </button>
                <button
                  onClick={e => onDelete(email.id, e)}
                  style={{ ...miniBtn, color: '#dc2626', fontSize: 11 }}
                  title="Delete"
                >
                  &#128465;
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const miniBtn = {
  padding: '2px 6px', background: 'transparent', border: 'none', cursor: 'pointer',
  borderRadius: 3, fontSize: 13, lineHeight: 1, display: 'inline-flex', alignItems: 'center',
};

// ─── Thread View ──────────────────────────────────────────────────────────────

function ThreadView({ thread, onReply, onToggleStar, onDelete, onMoveToFolder, onBack }) {
  if (!thread || !thread.emails || thread.emails.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Thread not found</div>;
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900, margin: '0 auto' }}>
      {/* Subject header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 22, color: '#1a1a1a', margin: 0, lineHeight: 1.3 }}>
          {thread.subject || '(No Subject)'}
        </h2>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          {thread.emails.length} message{thread.emails.length !== 1 ? 's' : ''} in this thread
        </div>
      </div>

      {/* Messages */}
      {thread.emails.map((email, idx) => (
        <MessageBubble
          key={email.id || idx}
          email={email}
          isLast={idx === thread.emails.length - 1}
          onReply={() => onReply(email)}
          onToggleStar={onToggleStar}
          onDelete={onDelete}
          onMoveToFolder={onMoveToFolder}
        />
      ))}

      {/* Reply button at bottom */}
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button
          onClick={() => onReply(thread.emails[thread.emails.length - 1])}
          style={{
            padding: '10px 24px', background: '#2e7d32', color: '#fff', border: 'none',
            borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Reply
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ email, isLast, onReply, onToggleStar, onDelete, onMoveToFolder }) {
  const [expanded, setExpanded] = useState(isLast);
  const isSent = email._type === 'sent';
  const date = isSent ? email.sentAt : email.receivedAt;

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
      marginBottom: 12, overflow: 'hidden',
      borderLeft: isSent ? '3px solid #2e7d32' : '3px solid #e5e7eb',
    }}>
      {/* Header - always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
          cursor: 'pointer', background: expanded ? '#fafbfc' : '#fff',
        }}
      >
        {/* Avatar */}
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: isSent ? '#dcfce7' : '#e0e7ff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: isSent ? '#2e7d32' : '#4338ca',
        }}>
          {isSent ? 'Me' : (senderName(email) || '?')[0].toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
              {isSent ? `Me (${email.fromAlias || ''})` : senderName(email)}
            </span>
            {isSent && <span style={{ fontSize: 10, padding: '1px 6px', background: '#dcfce7', color: '#2e7d32', borderRadius: 3, fontWeight: 600 }}>Sent</span>}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isSent
              ? `To: ${Array.isArray(email.to) ? email.to.join(', ') : email.to}`
              : `From: ${email.from || ''}`}
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {formatFullDate(date)}
        </div>

        <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>
          {expanded ? '\u25B2' : '\u25BC'}
        </span>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Action bar */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, paddingTop: 4 }}>
            <button onClick={onReply} style={toolBtn}>Reply</button>
            {!isSent && email.id && (
              <>
                <button onClick={e => onToggleStar(email.id, email.starred, e)} style={toolBtn}>
                  {email.starred ? 'Unstar' : 'Star'}
                </button>
                <button onClick={e => onDelete(email.id, e)} style={{ ...toolBtn, color: '#dc2626' }}>Delete</button>
                <select
                  onChange={e => { if (e.target.value) onMoveToFolder(email.id, e.target.value); e.target.value = ''; }}
                  style={{ ...toolBtn, padding: '4px 8px' }}
                  defaultValue=""
                >
                  <option value="" disabled>Move to...</option>
                  <option value="inbox">Inbox</option>
                  <option value="trash">Trash</option>
                </select>
              </>
            )}
          </div>

          {/* Email body */}
          <div style={{
            fontSize: 13, lineHeight: 1.7, color: '#374151',
            overflowWrap: 'break-word', wordBreak: 'break-word',
          }}>
            {email.html ? (
              <div dangerouslySetInnerHTML={{ __html: email.html }} style={{ maxWidth: '100%', overflow: 'auto' }} />
            ) : (
              <pre style={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', margin: 0 }}>{email.text || ''}</pre>
            )}
          </div>

          {/* Attachments */}
          {(email.attachments || []).length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>Attachments ({email.attachments.length})</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {email.attachments.map((a, i) => (
                  <div key={i} style={{
                    padding: '6px 12px', background: '#f8fafc', border: '1px solid #e5e7eb',
                    borderRadius: 6, fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span>&#128206;</span>
                    <span>{a.name || 'Attachment'}</span>
                    {a.size > 0 && <span style={{ color: '#94a3b8', fontSize: 10 }}>({(a.size / 1024).toFixed(1)} KB)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Compose View ─────────────────────────────────────────────────────────────

function ComposeView({ compose, setCompose, showCc, setShowCc, sending, onSend, onSaveDraft, onSearchContacts, contactSuggestions, setContactSuggestions }) {
  const [activeField, setActiveField] = useState(null);
  const suggestTimeout = useRef(null);

  function handleFieldChange(field, value) {
    setCompose(prev => ({ ...prev, [field]: value }));
    // Trigger contact suggestions for to/cc/bcc
    if (['to', 'cc', 'bcc'].includes(field)) {
      const parts = value.split(',');
      const last = parts[parts.length - 1].trim();
      if (suggestTimeout.current) clearTimeout(suggestTimeout.current);
      suggestTimeout.current = setTimeout(() => {
        setActiveField(field);
        onSearchContacts(last);
      }, 300);
    }
  }

  function insertContact(field, email) {
    setCompose(prev => {
      const current = prev[field];
      const parts = current.split(',').map(s => s.trim()).filter(Boolean);
      parts.pop(); // Remove partial input
      parts.push(email);
      return { ...prev, [field]: parts.join(', ') + ', ' };
    });
    setContactSuggestions([]);
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '20px 24px' }}>
      <h3 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 20, color: '#1a1a1a', margin: '0 0 16px' }}>
        {compose.draftId ? 'Edit Draft' : (compose.replyTo ? 'Reply' : 'New Email')}
      </h3>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        {/* To */}
        <div style={{ position: 'relative' }}>
          <div style={composeFieldRow}>
            <label style={composeLabel}>To</label>
            <input
              value={compose.to}
              onChange={e => handleFieldChange('to', e.target.value)}
              placeholder="recipient@example.com"
              style={composeInput}
              onFocus={() => setActiveField('to')}
              onBlur={() => setTimeout(() => setActiveField(null), 200)}
            />
            {!showCc && (
              <button onClick={() => setShowCc(true)} style={{ ...toolBtn, fontSize: 11, padding: '3px 8px' }}>CC/BCC</button>
            )}
          </div>
          {activeField === 'to' && contactSuggestions.length > 0 && (
            <ContactDropdown suggestions={contactSuggestions} onSelect={email => insertContact('to', email)} />
          )}
        </div>

        {/* CC / BCC */}
        {showCc && (
          <>
            <div style={{ position: 'relative' }}>
              <div style={composeFieldRow}>
                <label style={composeLabel}>CC</label>
                <input
                  value={compose.cc}
                  onChange={e => handleFieldChange('cc', e.target.value)}
                  placeholder="cc@example.com"
                  style={composeInput}
                  onFocus={() => setActiveField('cc')}
                  onBlur={() => setTimeout(() => setActiveField(null), 200)}
                />
              </div>
              {activeField === 'cc' && contactSuggestions.length > 0 && (
                <ContactDropdown suggestions={contactSuggestions} onSelect={email => insertContact('cc', email)} />
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <div style={composeFieldRow}>
                <label style={composeLabel}>BCC</label>
                <input
                  value={compose.bcc}
                  onChange={e => handleFieldChange('bcc', e.target.value)}
                  placeholder="bcc@example.com"
                  style={composeInput}
                  onFocus={() => setActiveField('bcc')}
                  onBlur={() => setTimeout(() => setActiveField(null), 200)}
                />
              </div>
              {activeField === 'bcc' && contactSuggestions.length > 0 && (
                <ContactDropdown suggestions={contactSuggestions} onSelect={email => insertContact('bcc', email)} />
              )}
            </div>
          </>
        )}

        {/* Subject */}
        <div style={composeFieldRow}>
          <label style={composeLabel}>Subject</label>
          <input
            value={compose.subject}
            onChange={e => setCompose(prev => ({ ...prev, subject: e.target.value }))}
            placeholder="Email subject"
            style={composeInput}
          />
        </div>

        {/* Body */}
        <div style={{ borderTop: '1px solid #f1f5f9' }}>
          <textarea
            value={compose.html}
            onChange={e => setCompose(prev => ({ ...prev, html: e.target.value }))}
            placeholder="Write your message..."
            style={{
              width: '100%', minHeight: 320, padding: '16px 20px', border: 'none',
              outline: 'none', fontSize: 14, fontFamily: "'Poppins', sans-serif",
              lineHeight: 1.7, resize: 'vertical', color: '#1a1a1a', background: '#fff',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Actions */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid #f1f5f9', background: '#fafbfc',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <button
            onClick={onSend}
            disabled={sending}
            style={{
              padding: '9px 28px', background: sending ? '#94a3b8' : '#2e7d32', color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: sending ? 'default' : 'pointer',
              boxShadow: '0 2px 6px rgba(46,125,50,0.2)',
            }}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
          <button onClick={onSaveDraft} style={toolBtn}>Save Draft</button>
          <div style={{ flex: 1 }} />
          {compose.draftId && (
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Editing draft</span>
          )}
        </div>
      </div>
    </div>
  );
}

const composeFieldRow = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
  borderBottom: '1px solid #f1f5f9',
};

const composeLabel = {
  fontSize: 12, fontWeight: 600, color: '#64748b', width: 50, flexShrink: 0,
};

const composeInput = {
  flex: 1, border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit',
  padding: '4px 0', color: '#1a1a1a', background: 'transparent',
};

// ─── Contact Dropdown ─────────────────────────────────────────────────────────

function ContactDropdown({ suggestions, onSelect }) {
  return (
    <div style={{
      position: 'absolute', top: '100%', left: 60, right: 16, zIndex: 100,
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: 200, overflowY: 'auto',
    }}>
      {suggestions.slice(0, 8).map(c => (
        <div
          key={c.id || c.email}
          onMouseDown={e => { e.preventDefault(); onSelect(c.email); }}
          style={{
            padding: '8px 12px', cursor: 'pointer', fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: '1px solid #f8fafc',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
          onMouseLeave={e => e.currentTarget.style.background = '#fff'}
        >
          <div style={{
            width: 28, height: 28, borderRadius: '50%', background: '#e0e7ff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#4338ca', flexShrink: 0,
          }}>
            {(c.name || c.email || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {c.name && <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>{c.name}</div>}
            <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Contacts List (Sidebar) ──────────────────────────────────────────────────

function ContactsList({ onCompose }) {
  const [contacts, setContacts] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get('/mail/contacts?q=');
        setContacts((data || []).slice(0, 5));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  if (!loaded || contacts.length === 0) return null;

  return (
    <>
      {contacts.map(c => (
        <div
          key={c.id}
          onClick={() => onCompose(c.email)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 16px',
            cursor: 'pointer', fontSize: 11, color: '#475569',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          title={`Compose email to ${c.email}`}
        >
          <div style={{
            width: 22, height: 22, borderRadius: '50%', background: '#e0e7ff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, color: '#4338ca', flexShrink: 0,
          }}>
            {(c.name || c.email || '?')[0].toUpperCase()}
          </div>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.name || c.email}
          </span>
        </div>
      ))}
    </>
  );
}

// ─── Drafts View ──────────────────────────────────────────────────────────────

function DraftsView({ drafts, onOpen, onDelete }) {
  if (drafts.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>&#128221;</div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>No drafts</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>Your saved drafts will appear here.</div>
      </div>
    );
  }

  return (
    <div>
      {drafts.map(d => (
        <div
          key={d.id}
          onClick={() => onOpen(d)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ fontSize: 15, color: '#f59e0b' }}>&#128221;</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.subject || '(No Subject)'}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              To: {d.to || '(No recipient)'} &middot; {stripHtml(d.html || d.text || '').slice(0, 80) || 'Empty draft'}
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {formatDate(d.updatedAt || d.createdAt)}
          </div>
          <button
            onClick={e => onDelete(d.id, e)}
            style={{ ...miniBtn, color: '#dc2626' }}
            title="Delete draft"
          >
            &#128465;
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Scheduled View ───────────────────────────────────────────────────────────

function ScheduledView({ scheduled, onCancel }) {
  if (scheduled.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>&#128338;</div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>No scheduled emails</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>Emails scheduled for later will appear here.</div>
      </div>
    );
  }

  return (
    <div>
      {scheduled.map(s => (
        <div
          key={s.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <span style={{ fontSize: 15, color: '#6366f1' }}>&#128338;</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.subject || '(No Subject)'}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              To: {Array.isArray(s.to) ? s.to.join(', ') : s.to} &middot; Scheduled for {formatFullDate(s.scheduledAt)}
            </div>
          </div>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
            background: '#fef3c7', color: '#d97706',
          }}>
            Pending
          </span>
          <button
            onClick={e => onCancel(s.id, e)}
            style={{ ...toolBtn, color: '#dc2626', fontSize: 11 }}
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}
