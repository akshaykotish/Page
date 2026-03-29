import React, { useState, useEffect, useRef } from 'react';
import { api, ApiError } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const TABS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'compose', label: 'Compose' },
  { key: 'sent', label: 'Sent' },
  { key: 'aliases', label: 'Aliases' },
  { key: 'mailboxes', label: 'Mailboxes' },
];

const EMAIL_TEMPLATES = {
  welcome: {
    label: 'Welcome',
    subject: 'Welcome to AK & Co.',
    html: `<p>Dear Client,</p>
<p>Welcome to <strong>Akshay Kotish &amp; Co.</strong>! We are thrilled to have you on board.</p>
<p>Our team is committed to providing you with excellent service and ensuring a seamless experience. Should you have any questions or need assistance, please do not hesitate to reach out to us.</p>
<p>We look forward to a successful partnership.</p>
<p>Warm regards,<br/>Team AK &amp; Co.</p>`,
  },
  invoiceFollowUp: {
    label: 'Invoice Follow-up',
    subject: 'Payment Reminder — Invoice Due',
    html: `<p>Dear Client,</p>
<p>This is a friendly reminder that your invoice is due for payment. We kindly request you to process the payment at your earliest convenience.</p>
<p>If the payment has already been made, please disregard this message. For any queries regarding the invoice, feel free to contact us.</p>
<p>Thank you for your prompt attention.</p>
<p>Best regards,<br/>Accounts Team<br/>Akshay Kotish &amp; Co.</p>`,
  },
  meetingRequest: {
    label: 'Meeting Request',
    subject: 'Meeting Request — AK & Co.',
    html: `<p>Dear Client,</p>
<p>I hope this email finds you well. I would like to schedule a meeting to discuss our ongoing collaboration and upcoming deliverables.</p>
<p>Could you please share your availability for this week or the next? I am happy to work around your schedule.</p>
<p>Looking forward to hearing from you.</p>
<p>Best regards,<br/>Akshay Kotish &amp; Co.</p>`,
  },
  thankYou: {
    label: 'Thank You',
    subject: 'Thank You for Your Business',
    html: `<p>Dear Client,</p>
<p>Thank you for choosing <strong>Akshay Kotish &amp; Co.</strong> We truly appreciate your trust and business.</p>
<p>It has been a pleasure working with you, and we hope to continue this association for years to come. Your satisfaction is our top priority.</p>
<p>Should you need anything in the future, we are just an email away.</p>
<p>With gratitude,<br/>Team AK &amp; Co.</p>`,
  },
};

const EMPTY_ALIAS_FORM = {
  alias: '',
  displayName: '',
  linkedEmployee: '',
};

const AI_TONES = [
  { key: 'professional', label: 'Professional' },
  { key: 'friendly', label: 'Friendly' },
  { key: 'formal', label: 'Formal' },
  { key: 'urgent', label: 'Urgent' },
];

const AI_QUICK_PROMPTS = [
  'Payment reminder',
  'Welcome new client',
  'Meeting invitation',
  'Project update',
  'Thank you note',
];

export default function Mail() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('inbox');
  const abortControllerRef = useRef(null);

  // Error states
  const [inboxError, setInboxError] = useState('');
  const [composeError, setComposeError] = useState('');
  const [sentError, setSentError] = useState('');
  const [aliasError, setAliasError] = useState('');
  const [mailboxError, setMailboxError] = useState('');

  // Inbox state
  const [inboxEmails, setInboxEmails] = useState([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxFilter, setInboxFilter] = useState('');
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Compose state
  const [aliases, setAliases] = useState([]);
  const [fromAlias, setFromAlias] = useState('');
  const [fromName, setFromName] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [sending, setSending] = useState(false);
  const [composeMsg, setComposeMsg] = useState({ text: '', type: '' });

  // AI Draft state
  const [showAIDrafter, setShowAIDrafter] = useState(false);
  const [aiMailPrompt, setAiMailPrompt] = useState('');
  const [aiTone, setAiTone] = useState('professional');
  const [aiDrafting, setAiDrafting] = useState(false);

  // Sent state
  const [sentEmails, setSentEmails] = useState([]);
  const [sentLoading, setSentLoading] = useState(false);
  const [sentSearch, setSentSearch] = useState('');

  // Aliases state
  const [aliasesLoading, setAliasesLoading] = useState(false);
  const [aliasForm, setAliasForm] = useState({ ...EMPTY_ALIAS_FORM });
  const [showAliasForm, setShowAliasForm] = useState(false);
  const [aliasMsg, setAliasMsg] = useState({ text: '', type: '' });
  const [savingAlias, setSavingAlias] = useState(false);

  // Mailboxes state
  const [mailboxes, setMailboxes] = useState([]);
  const [mailboxesLoading, setMailboxesLoading] = useState(false);
  const [mailboxMsg, setMailboxMsg] = useState({ text: '', type: '' });
  const [showMailboxForm, setShowMailboxForm] = useState(false);
  const [mailboxForm, setMailboxForm] = useState({ emailPrefix: '', name: '', password: '', employeeId: '' });
  const [creatingMailbox, setCreatingMailbox] = useState(false);
  const [employees, setEmployees] = useState([]);

  // Mailbox list for compose "From" selector
  const [posteMailboxes, setPosteMailboxes] = useState([]);

  useEffect(() => {
    fetchAliases();
    fetchPosteMailboxes();
    fetchInbox();
    fetchUnreadCount();
  }, []);

  useEffect(() => {
    if (activeTab === 'inbox') { fetchInbox(); fetchUnreadCount(); }
    if (activeTab === 'sent') fetchSentEmails();
    if (activeTab === 'aliases') fetchAliases();
    if (activeTab === 'mailboxes') {
      fetchMailboxes();
      fetchEmployeesList();
    }
  }, [activeTab]);

  // Refetch inbox when filter changes
  useEffect(() => {
    if (activeTab === 'inbox') fetchInbox();
  }, [inboxFilter]);

  // Clear messages after 5 seconds
  useEffect(() => {
    if (composeMsg.text) {
      const t = setTimeout(() => setComposeMsg({ text: '', type: '' }), 5000);
      return () => clearTimeout(t);
    }
  }, [composeMsg]);

  useEffect(() => {
    if (aliasMsg.text) {
      const t = setTimeout(() => setAliasMsg({ text: '', type: '' }), 5000);
      return () => clearTimeout(t);
    }
  }, [aliasMsg]);

  useEffect(() => {
    if (mailboxMsg.text) {
      const t = setTimeout(() => setMailboxMsg({ text: '', type: '' }), 5000);
      return () => clearTimeout(t);
    }
  }, [mailboxMsg]);

  // ── Fetch functions ──

  async function fetchAliases() {
    setAliasesLoading(true);
    setAliasError('');
    abortControllerRef.current = new AbortController();
    try {
      const data = await api.get('/mail/aliases', { signal: abortControllerRef.current.signal });
      const list = Array.isArray(data) ? data : data.aliases || [];
      setAliases(list);
    } catch (err) {
      if (err?.code !== 'ABORT_ERR') {
        const message = err?.message || 'Failed to fetch aliases';
        setAliasError(message);
        console.error('Error fetching aliases:', err);
      }
    } finally {
      setAliasesLoading(false);
    }
  }

  async function fetchSentEmails() {
    setSentLoading(true);
    setSentError('');
    abortControllerRef.current = new AbortController();
    try {
      const data = await api.get('/mail/sent', { signal: abortControllerRef.current.signal });
      const list = Array.isArray(data) ? data : data.emails || [];
      setSentEmails(list);
    } catch (err) {
      if (err?.code !== 'ABORT_ERR') {
        const message = err?.message || 'Failed to fetch sent emails';
        setSentError(message);
        console.error('Error fetching sent emails:', err);
      }
    } finally {
      setSentLoading(false);
    }
  }

  async function fetchMailboxes() {
    setMailboxesLoading(true);
    try {
      const data = await api.get('/mail/aliases');
      const list = Array.isArray(data) ? data : [];
      setMailboxes(list);
    } catch (err) {
      console.error('Error fetching mailboxes:', err);
      setMailboxes([]);
    } finally {
      setMailboxesLoading(false);
    }
  }

  async function fetchPosteMailboxes() {
    try {
      const data = await api.get('/mail/aliases');
      const list = Array.isArray(data) ? data : [];
      setPosteMailboxes(list);
    } catch (err) {
      console.error('Error fetching mailboxes for compose:', err);
    }
  }

  async function fetchInbox() {
    setInboxLoading(true);
    setInboxError('');
    abortControllerRef.current = new AbortController();
    try {
      const params = inboxFilter ? `?to=${encodeURIComponent(inboxFilter)}` : '';
      const data = await api.get(`/mail/inbox${params}`, { signal: abortControllerRef.current.signal });
      setInboxEmails(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err?.code !== 'ABORT_ERR') {
        const message = err?.message || 'Failed to fetch inbox';
        setInboxError(message);
        console.error('Error fetching inbox:', err);
      }
      setInboxEmails([]);
    } finally {
      setInboxLoading(false);
    }
  }

  async function fetchUnreadCount() {
    try {
      const data = await api.get('/mail/inbox/unread-count');
      setUnreadCount(data.count || 0);
    } catch {}
  }

  async function markEmailRead(id, read = true) {
    try {
      await api.patch(`/mail/inbox/${id}`, { read });
      setInboxEmails(prev => prev.map(e => e.id === id ? { ...e, read } : e));
      if (read) setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {}
  }

  async function toggleStar(id, starred) {
    try {
      await api.patch(`/mail/inbox/${id}`, { starred });
      setInboxEmails(prev => prev.map(e => e.id === id ? { ...e, starred } : e));
    } catch {}
  }

  async function deleteInboxEmail(id) {
    if (!window.confirm('Delete this email?')) return;
    try {
      await api.delete(`/mail/inbox/${id}`);
      setInboxEmails(prev => prev.filter(e => e.id !== id));
      if (selectedEmail?.id === id) setSelectedEmail(null);
    } catch {}
  }

  function replyToEmail(email) {
    setActiveTab('compose');
    setTo(email.replyTo || email.from || '');
    setSubject(`Re: ${email.subject || ''}`);
    setHtml(`<br/><br/>---<br/><em>On ${new Date(email.receivedAt).toLocaleString()}, ${email.fromName || email.from} wrote:</em><br/>${email.html || email.text || ''}`);
  }

  async function fetchEmployeesList() {
    try {
      const data = await api.get('/employees');
      const list = Array.isArray(data) ? data : data.employees || [];
      setEmployees(list);
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  }

  // ── Compose handlers ──

  function loadTemplate(key) {
    const tmpl = EMAIL_TEMPLATES[key];
    if (!tmpl) return;
    setSubject(tmpl.subject);
    setHtml(tmpl.html);
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!to.trim() || !subject.trim() || !html.trim()) {
      setComposeMsg({ text: 'Please fill in all required fields.', type: 'error' });
      return;
    }

    setSending(true);
    setComposeMsg({ text: '', type: '' });
    setComposeError('');
    abortControllerRef.current = new AbortController();

    try {
      await api.post('/mail/send', {
        to: to.trim(),
        subject: subject.trim(),
        html,
        fromAlias: fromAlias || undefined,
        fromName: fromName.trim() || undefined,
      });
      setComposeMsg({ text: 'Email sent successfully!', type: 'success' });
      setTo('');
      setSubject('');
      setHtml('');
      setFromAlias('');
      setFromName('');
    } catch (err) {
      if (err?.code === 'TIMEOUT') {
        setComposeMsg({ text: 'Request timed out. Please try again.', type: 'error' });
      } else {
        setComposeMsg({ text: err?.message || 'Failed to send email', type: 'error' });
      }
    } finally {
      setSending(false);
    }
  }

  // ── AI Draft handler ──

  async function handleAIDraft() {
    if (!aiMailPrompt.trim()) {
      setComposeMsg({ text: 'Please enter a prompt for AI drafting.', type: 'error' });
      return;
    }
    setAiDrafting(true);
    setComposeError('');
    abortControllerRef.current = new AbortController();
    try {
      const data = await api.post('/ai/draft-email', {
        prompt: aiMailPrompt.trim(),
        to: to.trim(),
        tone: aiTone,
        context: '',
      });
      if (data.subject) setSubject(data.subject);
      if (data.body || data.html) setHtml(data.body || data.html);
      setComposeMsg({ text: 'AI draft applied! Review and edit before sending.', type: 'success' });
      setShowAIDrafter(false);
      setAiMailPrompt('');
    } catch (err) {
      if (err?.code === 'TIMEOUT') {
        setComposeMsg({ text: 'AI request timed out. Please try again.', type: 'error' });
      } else {
        setComposeMsg({ text: err?.message || 'AI drafting failed. Please try again.', type: 'error' });
      }
    } finally {
      setAiDrafting(false);
    }
  }

  // ── Alias handlers ──

  async function handleAddAlias(e) {
    e.preventDefault();
    if (!aliasForm.alias.trim() || !aliasForm.displayName.trim()) {
      setAliasMsg({ text: 'Please fill in all required fields.', type: 'error' });
      return;
    }

    setSavingAlias(true);
    setAliasMsg({ text: '', type: '' });
    setAliasError('');
    abortControllerRef.current = new AbortController();

    try {
      await api.post('/mail/aliases', {
        alias: aliasForm.alias.trim(),
        displayName: aliasForm.displayName.trim(),
        linkedEmployee: aliasForm.linkedEmployee.trim() || undefined,
      });
      setAliasMsg({ text: 'Alias added successfully!', type: 'success' });
      setAliasForm({ ...EMPTY_ALIAS_FORM });
      setShowAliasForm(false);
      await fetchAliases();
    } catch (err) {
      const message = err?.message || 'Failed to add alias';
      setAliasMsg({ text: message, type: 'error' });
      setAliasError(message);
    } finally {
      setSavingAlias(false);
    }
  }

  async function handleDeleteAlias(aliasId) {
    if (!window.confirm('Delete this alias? It will no longer be available for sending emails.')) return;
    abortControllerRef.current = new AbortController();
    try {
      await api.delete(`/mail/aliases/${aliasId}`, { signal: abortControllerRef.current.signal });
      setAliasMsg({ text: 'Alias deleted.', type: 'success' });
      await fetchAliases();
    } catch (err) {
      const message = err?.message || 'Failed to delete alias';
      setAliasMsg({ text: message, type: 'error' });
      setAliasError(message);
    }
  }

  // ── Mailbox handlers ──

  async function handleCreateMailbox(e) {
    e.preventDefault();
    const email = mailboxForm.emailPrefix.trim() + '@akshaykotish.com';
    if (!mailboxForm.emailPrefix.trim() || !mailboxForm.name.trim()) {
      setMailboxMsg({ text: 'Please fill in email prefix and display name.', type: 'error' });
      return;
    }

    setCreatingMailbox(true);
    setMailboxMsg({ text: '', type: '' });

    try {
      // Create as an alias in the system — sends via Brevo/Gmail SMTP
      await api.post('/mail/aliases', {
        alias: email,
        displayName: mailboxForm.name.trim(),
        employeeId: mailboxForm.employeeId || undefined,
        employeeName: mailboxForm.employeeId ? employees.find(e => e.id === mailboxForm.employeeId)?.name || '' : '',
        forwardTo: mailboxForm.password.trim() || '', // Reuse password field as "forward to" personal email
      });

      // Also update employee record if linked
      if (mailboxForm.employeeId) {
        try {
          await api.put(`/employees/${mailboxForm.employeeId}`, { emailAlias: email });
        } catch {}
      }

      setMailboxMsg({ text: `Email alias ${email} created! Configure Cloudflare Email Routing to receive emails.`, type: 'success' });
      setMailboxForm({ emailPrefix: '', name: '', password: '', employeeId: '' });
      setShowMailboxForm(false);
      await fetchMailboxes();
    } catch (err) {
      setMailboxMsg({ text: err.message || 'Failed to create alias', type: 'error' });
    } finally {
      setCreatingMailbox(false);
    }
  }

  async function handleDeleteMailbox(aliasId) {
    if (!window.confirm('Delete this email alias?')) return;
    setMailboxMsg({ text: '', type: '' });
    try {
      await api.delete(`/mail/aliases/${aliasId}`);
      setMailboxMsg({ text: 'Alias deleted.', type: 'success' });
      await fetchMailboxes();
    } catch (err) {
      setMailboxMsg({ text: err.message || 'Failed to delete', type: 'error' });
    }
  }

  async function handleGeneratePassword() {
    // Generate a forwarding email suggestion
    const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let pw = '';
    for (let i = 0; i < 12; i++) pw += charset[Math.floor(Math.random() * charset.length)];
    setMailboxForm(prev => ({ ...prev, password: pw }));
  }

  // ── Formatting helpers ──

  function formatTimestamp(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Filtered sent emails ──

  const filteredSent = sentEmails.filter(email => {
    if (!sentSearch) return true;
    const q = sentSearch.toLowerCase();
    return (
      (email.to || '').toLowerCase().includes(q) ||
      (email.subject || '').toLowerCase().includes(q) ||
      (email.fromAlias || '').toLowerCase().includes(q)
    );
  });

  // Build combined "From" options: aliases + poste mailboxes
  const allFromOptions = [];
  // Add aliases
  aliases.forEach((a, i) => {
    allFromOptions.push({
      key: `alias-${a._id || a.id || i}`,
      value: a.alias || a.email,
      label: `${a.displayName || a.name || a.alias || a.email} <${a.alias || a.email}>`,
      name: a.displayName || a.name || '',
      source: 'alias',
    });
  });
  // Add poste mailboxes (avoid duplicates)
  const aliasEmails = new Set(aliases.map(a => (a.alias || a.email || '').toLowerCase()));
  posteMailboxes.forEach((mb, i) => {
    const mbEmail = mb.email || mb.name || '';
    if (mbEmail && !aliasEmails.has(mbEmail.toLowerCase())) {
      allFromOptions.push({
        key: `mailbox-${i}`,
        value: mbEmail,
        label: `${mb.displayName || mb.name || mbEmail} <${mbEmail}>`,
        name: mb.displayName || mb.name || '',
        source: 'mailbox',
      });
    }
  });

  // ── Render ──

  return (
    <div className="page-mail">
      {/* Tabs */}
      <div className="tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.key === 'inbox' && unreadCount > 0 && (
              <span style={{ marginLeft: 6, background: 'var(--red)', color: '#fff', borderRadius: '50%', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900 }}>{unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════════ INBOX TAB ═══════════════════ */}
      {activeTab === 'inbox' && (
        <div>
          {/* Filter bar */}
          <div className="filter-bar" style={{ marginBottom: 16 }}>
            <select
              value={inboxFilter}
              onChange={e => setInboxFilter(e.target.value)}
              style={{ padding: '8px 14px', background: 'var(--card)', border: 'var(--border-thin)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600 }}
            >
              <option value="">All Mailboxes</option>
              {mailboxes.map(mb => (
                <option key={mb.id} value={mb.alias}>{mb.alias}</option>
              ))}
            </select>
            <div className="spacer" />
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
              {inboxEmails.length} email(s) {unreadCount > 0 && `· ${unreadCount} unread`}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={fetchInbox}>Refresh</button>
          </div>

          {/* Email list or detail view */}
          {selectedEmail ? (
            /* ── Email Detail View ── */
            <div className="card">
              <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setSelectedEmail(null)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 16 }}>&larr;</span> Back
                </button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-secondary btn-sm" onClick={() => replyToEmail(selectedEmail)}>Reply</button>
                <button className="btn btn-sm" style={{ background: '#ffebee', color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => deleteInboxEmail(selectedEmail.id)}>Delete</button>
              </div>
              <div style={{ padding: 24 }}>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>{selectedEmail.subject}</h2>
                <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, flexWrap: 'wrap' }}>
                  <div><strong>From:</strong> {selectedEmail.fromName ? `${selectedEmail.fromName} <${selectedEmail.from}>` : selectedEmail.from}</div>
                  <div><strong>To:</strong> {(selectedEmail.to || []).join(', ')}</div>
                  <div><strong>Date:</strong> {new Date(selectedEmail.receivedAt).toLocaleString('en-IN')}</div>
                </div>
                {selectedEmail.cc?.length > 0 && (
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}><strong>CC:</strong> {selectedEmail.cc.join(', ')}</div>
                )}
                <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 20, background: '#fff', marginTop: 8 }}>
                  {selectedEmail.html ? (
                    <div dangerouslySetInnerHTML={{ __html: selectedEmail.html }} style={{ fontSize: 14, lineHeight: 1.7, color: '#333' }} />
                  ) : (
                    <pre style={{ fontSize: 14, lineHeight: 1.7, color: '#333', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{selectedEmail.text || '(empty)'}</pre>
                  )}
                </div>
                {selectedEmail.attachments?.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <strong style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Attachments ({selectedEmail.attachments.length})</strong>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      {selectedEmail.attachments.map((a, i) => (
                        <div key={i} style={{ padding: '6px 12px', background: '#f5f5f5', borderRadius: 6, border: '1px solid #ddd', fontSize: 12, fontWeight: 600 }}>
                          {a.name} {a.size ? `(${Math.round(a.size / 1024)}KB)` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Email List ── */
            inboxLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="loader"></div></div>
            ) : inboxEmails.length === 0 ? (
              <div className="card empty-state">
                <h3>No Emails</h3>
                <p>Your inbox is empty. Emails sent to @akshaykotish.com will appear here.</p>
                <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                  Setup: Brevo dashboard &rarr; Inbound &rarr; Add domain &rarr; Webhook URL: <code>https://akshaykotish.com/api/mail/inbound</code>
                </p>
              </div>
            ) : (
              <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 30 }}></th>
                        <th>From</th>
                        <th>Subject</th>
                        <th>To</th>
                        <th>Date</th>
                        <th style={{ textAlign: 'center', width: 80 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inboxEmails.map(email => (
                        <tr key={email.id}
                          style={{ background: email.read ? 'transparent' : '#f0fdf4', cursor: 'pointer', fontWeight: email.read ? 400 : 700 }}
                          onClick={() => { setSelectedEmail(email); if (!email.read) markEmailRead(email.id); }}
                        >
                          <td style={{ textAlign: 'center' }}>
                            <span
                              style={{ cursor: 'pointer', fontSize: 16, color: email.starred ? '#f59e0b' : '#ddd' }}
                              onClick={e => { e.stopPropagation(); toggleStar(email.id, !email.starred); }}
                            >
                              {email.starred ? '\u2605' : '\u2606'}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontSize: 13 }}>{email.fromName || email.from || '--'}</div>
                            {email.fromName && <div style={{ fontSize: 11, color: '#888' }}>{email.from}</div>}
                          </td>
                          <td>
                            <div style={{ fontSize: 13, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {email.subject || '(No Subject)'}
                            </div>
                            {email.text && <div style={{ fontSize: 11, color: '#999', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email.text.substring(0, 80)}</div>}
                          </td>
                          <td style={{ fontSize: 12, color: '#888' }}>{(email.to || []).join(', ')}</td>
                          <td style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>
                            {new Date(email.receivedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            {' '}
                            {new Date(email.receivedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <button
                              className="btn btn-sm"
                              style={{ background: '#ffebee', color: 'var(--red)', borderColor: 'var(--red)', padding: '2px 8px', fontSize: 11 }}
                              onClick={() => deleteInboxEmail(email.id)}
                            >
                              Del
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ═══════════════════ COMPOSE TAB ═══════════════════ */}
      {activeTab === 'compose' && (
        <div>
          {/* Quick Templates */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <h3 className="card-title">Quick Templates</h3>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {Object.entries(EMAIL_TEMPLATES).map(([key, tmpl]) => (
                <button
                  key={key}
                  className="btn btn-secondary btn-sm"
                  onClick={() => loadTemplate(key)}
                  style={{ textTransform: 'none', letterSpacing: 0 }}
                >
                  {tmpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* AI Draft Panel */}
          <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
            {/* AI Header - always visible as toggle */}
            <div
              onClick={() => setShowAIDrafter(!showAIDrafter)}
              style={{
                padding: '14px 20px',
                background: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93L12 22"/>
                    <path d="M8 6a4 4 0 0 1 8 0"/>
                    <path d="M17 12.5c1.77.54 3 2.18 3 4.1 0 2.38-1.94 4.4-4.5 4.4h-7C5.94 21 4 18.98 4 16.6c0-1.92 1.23-3.56 3-4.1"/>
                  </svg>
                </span>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: '0.02em' }}>
                  AI Draft
                </span>
                <span style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 12,
                  fontWeight: 500,
                }}>
                  -- Let AI write your email
                </span>
              </div>
              <span style={{
                color: '#fff',
                fontSize: 18,
                fontWeight: 700,
                transform: showAIDrafter ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                lineHeight: 1,
              }}>
                &#9662;
              </span>
            </div>

            {/* AI Collapsible Content */}
            {showAIDrafter && (
              <div style={{ padding: 20, background: '#faf5ff', borderTop: '1px solid #e9d5ff' }}>
                {/* Tone Selector */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9', display: 'block', marginBottom: 8 }}>
                    Tone
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {AI_TONES.map(t => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setAiTone(t.key)}
                        style={{
                          padding: '7px 16px',
                          borderRadius: 20,
                          border: aiTone === t.key ? '2px solid #7c3aed' : '2px solid #d8b4fe',
                          background: aiTone === t.key ? 'linear-gradient(135deg, #7c3aed, #3b82f6)' : '#fff',
                          color: aiTone === t.key ? '#fff' : '#6d28d9',
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Prompt textarea */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9', display: 'block', marginBottom: 8 }}>
                    Describe the email you want to send...
                  </label>
                  <textarea
                    value={aiMailPrompt}
                    onChange={e => setAiMailPrompt(e.target.value)}
                    placeholder="e.g. Write a payment reminder for invoice #INV-042 due last week, amount Rs. 25,000. Be polite but firm."
                    style={{
                      width: '100%',
                      minHeight: 90,
                      padding: '12px 14px',
                      border: '2px solid #d8b4fe',
                      borderRadius: 10,
                      fontSize: 14,
                      fontFamily: "'Inter', sans-serif",
                      lineHeight: 1.6,
                      resize: 'vertical',
                      outline: 'none',
                      background: '#fff',
                      color: '#1e293b',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Quick Prompts */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#8b5cf6', display: 'block', marginBottom: 8 }}>
                    Quick prompts:
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {AI_QUICK_PROMPTS.map(qp => (
                      <button
                        key={qp}
                        type="button"
                        onClick={() => setAiMailPrompt(qp)}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 16,
                          border: '1px solid #e9d5ff',
                          background: '#fff',
                          color: '#7c3aed',
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#ede9fe'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                      >
                        {qp}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Draft with AI Button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={handleAIDraft}
                    disabled={aiDrafting || !aiMailPrompt.trim()}
                    style={{
                      padding: '10px 24px',
                      background: aiDrafting || !aiMailPrompt.trim()
                        ? '#c4b5fd'
                        : 'linear-gradient(135deg, #7c3aed, #3b82f6)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      fontWeight: 700,
                      fontSize: 14,
                      cursor: aiDrafting || !aiMailPrompt.trim() ? 'not-allowed' : 'pointer',
                      opacity: aiDrafting || !aiMailPrompt.trim() ? 0.7 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {aiDrafting ? (
                      <>
                        <span style={{
                          display: 'inline-block',
                          width: 16,
                          height: 16,
                          border: '2px solid rgba(255,255,255,0.3)',
                          borderTopColor: '#fff',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite',
                        }} />
                        Drafting...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </svg>
                        Draft with AI
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Compose Form */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Compose Email</h3>
            </div>

            <form onSubmit={handleSend}>
              <div className="form-row" style={{ marginBottom: 16 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>From (Alias / Mailbox)</label>
                  <select
                    value={fromAlias}
                    onChange={e => {
                      setFromAlias(e.target.value);
                      const matched = allFromOptions.find(o => o.value === e.target.value);
                      if (matched) setFromName(matched.name || '');
                    }}
                  >
                    <option value="">Default (Company Email)</option>
                    {allFromOptions.map(opt => (
                      <option key={opt.key} value={opt.value}>
                        {opt.label}
                        {opt.source === 'mailbox' ? ' [Mailbox]' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>From Name</label>
                  <input
                    type="text"
                    placeholder="Display name (e.g. Akshay Kotish)"
                    value={fromName}
                    onChange={e => setFromName(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>To *</label>
                <input
                  type="email"
                  placeholder="recipient@example.com"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Subject *</label>
                <input
                  type="text"
                  placeholder="Email subject"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Body (HTML) *</label>
                <textarea
                  placeholder="Write your email content here. You can use HTML tags for formatting."
                  value={html}
                  onChange={e => setHtml(e.target.value)}
                  required
                  style={{ minHeight: 240, fontFamily: "'Inter', sans-serif", lineHeight: 1.7 }}
                />
              </div>

              {/* Message feedback */}
              {composeMsg.text && (
                <div
                  style={{
                    padding: '12px 18px',
                    marginBottom: 16,
                    borderRadius: 'var(--radius-sm)',
                    border: '2px solid',
                    borderColor: composeMsg.type === 'success' ? 'var(--green)' : 'var(--red)',
                    background: composeMsg.type === 'success' ? '#e8f5e9' : '#ffebee',
                    color: composeMsg.type === 'success' ? 'var(--green-dark)' : 'var(--red)',
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {composeMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setTo('');
                    setSubject('');
                    setHtml('');
                    setFromAlias('');
                    setFromName('');
                  }}
                >
                  Clear
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={sending}
                  style={{ opacity: sending ? 0.7 : 1 }}
                >
                  {sending ? 'Sending...' : 'Send Email'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════ SENT TAB ═══════════════════ */}
      {activeTab === 'sent' && (
        <div>
          {/* Search / Filter */}
          <div className="filter-bar">
            <input
              type="text"
              placeholder="Search by recipient, subject, or alias..."
              value={sentSearch}
              onChange={e => setSentSearch(e.target.value)}
              style={{ flex: 1, minWidth: 240 }}
            />
            <div className="spacer" />
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => { setSentLoading(true); fetchSentEmails(); }}
            >
              Refresh
            </button>
          </div>

          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12 }}>
            Showing {filteredSent.length} of {sentEmails.length} sent emails
          </p>

          {/* Sent Emails Table */}
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>From</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {sentLoading ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      Loading sent emails...
                    </td>
                  </tr>
                ) : filteredSent.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      {sentEmails.length === 0 ? 'No sent emails yet.' : 'No emails match your search.'}
                    </td>
                  </tr>
                ) : (
                  filteredSent.map((email, idx) => (
                    <tr key={email._id || email.id || idx}>
                      <td style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {formatTimestamp(email.sentAt || email.createdAt || email.date)}
                      </td>
                      <td style={{ fontWeight: 700, fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                        {email.to || '--'}
                      </td>
                      <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {email.subject || '--'}
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {email.fromAlias || email.from || '--'}
                      </td>
                      <td>
                        {email.type ? (
                          <span
                            className="status-badge"
                            style={{
                              background: email.type === 'invoice' ? '#e3f2fd' :
                                         email.type === 'payslip' ? '#f3e5f5' :
                                         email.type === 'reminder' ? '#fff3e0' :
                                         '#e8f5e9',
                              color: email.type === 'invoice' ? '#1565c0' :
                                     email.type === 'payslip' ? '#7b1fa2' :
                                     email.type === 'reminder' ? '#e65100' :
                                     'var(--green)',
                              borderColor: email.type === 'invoice' ? '#1565c0' :
                                           email.type === 'payslip' ? '#7b1fa2' :
                                           email.type === 'reminder' ? '#e65100' :
                                           'var(--green)',
                            }}
                          >
                            {email.type}
                          </span>
                        ) : (
                          <span
                            className="status-badge"
                            style={{ background: '#f5f5f5', color: '#888', borderColor: '#ccc' }}
                          >
                            general
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════ ALIASES TAB ═══════════════════ */}
      {activeTab === 'aliases' && (
        <div>
          {/* Info Box */}
          <div
            className="card"
            style={{
              marginBottom: 20,
              background: '#e8f5e9',
              borderColor: 'var(--green)',
              borderLeftWidth: 6,
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>i</span>
              <div>
                <p style={{ fontWeight: 800, fontSize: 14, marginBottom: 4, color: 'var(--green-dark)' }}>
                  About Email Aliases
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Aliases must also be configured in the Zoho Mail admin panel. Adding an alias here registers
                  it in the system for sending emails. Ensure the alias is verified and active in your Zoho
                  Mail account before using it.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="section-header" style={{ marginBottom: 20 }}>
            <h3
              className="section-title"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Email Aliases
            </h3>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setShowAliasForm(!showAliasForm);
                setAliasForm({ ...EMPTY_ALIAS_FORM });
              }}
            >
              {showAliasForm ? 'Cancel' : '+ Add Alias'}
            </button>
          </div>

          {/* Alias Message */}
          {aliasMsg.text && (
            <div
              style={{
                padding: '12px 18px',
                marginBottom: 16,
                borderRadius: 'var(--radius-sm)',
                border: '2px solid',
                borderColor: aliasMsg.type === 'success' ? 'var(--green)' : 'var(--red)',
                background: aliasMsg.type === 'success' ? '#e8f5e9' : '#ffebee',
                color: aliasMsg.type === 'success' ? 'var(--green-dark)' : 'var(--red)',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {aliasMsg.text}
            </div>
          )}

          {/* Add Alias Form */}
          {showAliasForm && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <h3 className="card-title">New Alias</h3>
              </div>
              <form onSubmit={handleAddAlias}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Alias Email *</label>
                    <input
                      type="email"
                      placeholder="billing@akshaykotish.com"
                      value={aliasForm.alias}
                      onChange={e => setAliasForm(prev => ({ ...prev, alias: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Display Name *</label>
                    <input
                      type="text"
                      placeholder="Billing Department"
                      value={aliasForm.displayName}
                      onChange={e => setAliasForm(prev => ({ ...prev, displayName: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Link to Employee (Optional)</label>
                    <input
                      type="text"
                      placeholder="Employee name or ID"
                      value={aliasForm.linkedEmployee}
                      onChange={e => setAliasForm(prev => ({ ...prev, linkedEmployee: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setShowAliasForm(false);
                      setAliasForm({ ...EMPTY_ALIAS_FORM });
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={savingAlias}
                    style={{ opacity: savingAlias ? 0.7 : 1 }}
                  >
                    {savingAlias ? 'Saving...' : 'Add Alias'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Aliases List */}
          {aliasesLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <div className="loader"></div>
            </div>
          ) : aliases.length === 0 ? (
            <div className="card empty-state">
              <h3>No Aliases Configured</h3>
              <p>Add your first email alias to start sending emails from different addresses.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Alias Email</th>
                    <th>Display Name</th>
                    <th>Linked Employee</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {aliases.map((a, idx) => (
                    <tr key={a._id || a.id || idx}>
                      <td style={{ fontWeight: 700, fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                        {a.alias || a.email || '--'}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {a.displayName || a.name || '--'}
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {a.linkedEmployee || '--'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn btn-sm"
                          style={{
                            background: '#ffebee',
                            color: 'var(--red)',
                            borderColor: 'var(--red)',
                            boxShadow: '2px 2px 0 #b71c1c',
                          }}
                          onClick={() => handleDeleteAlias(a._id || a.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ MAILBOXES TAB ═══════════════════ */}
      {activeTab === 'mailboxes' && (
        <div>
          {/* Info Box */}
          <div
            className="card"
            style={{
              marginBottom: 20,
              background: '#e3f2fd',
              borderColor: '#1565c0',
              borderLeftWidth: 6,
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 22, lineHeight: 1, color: '#1565c0', fontWeight: 800 }}>@</span>
              <div>
                <p style={{ fontWeight: 800, fontSize: 14, marginBottom: 4, color: '#1565c0' }}>
                  Employee Email Aliases — @akshaykotish.com
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Create email aliases for employees. <strong>Sending</strong> works via Brevo/Gmail SMTP.
                  For <strong>receiving</strong>, set up Cloudflare Email Routing to forward each alias to the employee's personal email.
                </p>
                <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  Cloudflare → Email Routing → Add rule: alias@akshaykotish.com → employee's personal email
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="section-header" style={{ marginBottom: 20 }}>
            <h3
              className="section-title"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Mailboxes
            </h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <a
                href="https://dash.cloudflare.com"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                Cloudflare Routing
              </a>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setShowMailboxForm(!showMailboxForm);
                  setMailboxForm({ emailPrefix: '', name: '', password: '', employeeId: '' });
                }}
              >
                {showMailboxForm ? 'Cancel' : '+ Create Mailbox'}
              </button>
            </div>
          </div>

          {/* Mailbox Message */}
          {mailboxMsg.text && (
            <div
              style={{
                padding: '12px 18px',
                marginBottom: 16,
                borderRadius: 'var(--radius-sm)',
                border: '2px solid',
                borderColor: mailboxMsg.type === 'success' ? 'var(--green)' : 'var(--red)',
                background: mailboxMsg.type === 'success' ? '#e8f5e9' : '#ffebee',
                color: mailboxMsg.type === 'success' ? 'var(--green-dark)' : 'var(--red)',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {mailboxMsg.text}
            </div>
          )}

          {/* Create Mailbox Form */}
          {showMailboxForm && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <h3 className="card-title">Create Mailbox</h3>
              </div>
              <form onSubmit={handleCreateMailbox}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Email Address *</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                      <input
                        type="text"
                        placeholder="username"
                        value={mailboxForm.emailPrefix}
                        onChange={e => setMailboxForm(prev => ({ ...prev, emailPrefix: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
                        required
                        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}
                      />
                      <span style={{
                        padding: '8px 14px',
                        background: '#f1f5f9',
                        border: '2px solid var(--border)',
                        borderLeft: 'none',
                        borderTopRightRadius: 'var(--radius-sm)',
                        borderBottomRightRadius: 'var(--radius-sm)',
                        fontWeight: 700,
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                      }}>
                        @akshaykotish.com
                      </span>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Display Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Akshay Kotish"
                      value={mailboxForm.name}
                      onChange={e => setMailboxForm(prev => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Forward To (personal email)</label>
                    <input
                      type="email"
                      placeholder="employee@gmail.com (for Cloudflare routing)"
                      value={mailboxForm.password}
                      onChange={e => setMailboxForm(prev => ({ ...prev, password: e.target.value }))}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Link to Employee (Optional)</label>
                    <select
                      value={mailboxForm.employeeId}
                      onChange={e => {
                        const empId = e.target.value;
                        setMailboxForm(prev => ({ ...prev, employeeId: empId }));
                        // Auto-fill name if employee selected
                        if (empId) {
                          const emp = employees.find(emp => emp.id === empId);
                          if (emp && !mailboxForm.name) {
                            setMailboxForm(prev => ({ ...prev, name: emp.name || '' }));
                          }
                        }
                      }}
                    >
                      <option value="">-- None --</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.email})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setShowMailboxForm(false);
                      setMailboxForm({ emailPrefix: '', name: '', password: '', employeeId: '' });
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={creatingMailbox}
                    style={{ opacity: creatingMailbox ? 0.7 : 1 }}
                  >
                    {creatingMailbox ? 'Creating...' : 'Create Mailbox'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Mailboxes List */}
          {mailboxesLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <div className="loader"></div>
            </div>
          ) : mailboxes.length === 0 ? (
            <div className="card empty-state">
              <h3>No Mailboxes Found</h3>
              <p>Create your first mailbox to start using email on your domain.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mailboxes.map((mb, idx) => {
                    const mbAlias = mb.alias || '';
                    const mbName = mb.displayName || mb.employeeName || '';
                    const mbForward = mb.forwardTo || '';
                    return (
                      <tr key={mb.id || idx}>
                        <td style={{ fontWeight: 700, fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
                          {mbAlias || '--'}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {mbName || '--'}
                          {mb.employeeName && <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>({mb.employeeName})</span>}
                        </td>
                        <td>
                          <span className="status-badge" style={{ background: '#e8f5e9', color: 'var(--green)', borderColor: 'var(--green)' }}>
                            Active
                          </span>
                          {mbForward && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>→ {mbForward}</div>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-sm"
                            style={{ background: '#ffebee', color: 'var(--red)', borderColor: 'var(--red)', boxShadow: '2px 2px 0 #b71c1c' }}
                            onClick={() => handleDeleteMailbox(mb.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* AI spinner keyframes */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
