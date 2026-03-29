import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../utils/api';

// Speech Recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function AIAssistant() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [showPreview, setShowPreview] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize speech recognition
  useEffect(() => {
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-IN';

      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(r => r[0].transcript)
          .join('');
        setInput(transcript);
        if (event.results[0].isFinal) {
          setListening(false);
        }
      };

      recognition.onerror = (e) => {
        console.error('Speech error:', e.error);
        setListening(false);
      };

      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
    }
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
    }
  }, [input]);

  // Add welcome message on mount and cleanup on unmount
  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `Hello ${user?.name || 'there'}! I'm your AI business assistant. I can help you with:\n\n• **Create letters** — "Write a letter to Mr. Sharma about tax filing"\n• **Draft & send emails** — "Send an email to client@example.com about project update"\n• **Create invoices** — "Create a bill for ABC Corp, 5 hours consulting at ₹2000/hr"\n• **Manage employees** — "Add new employee Ravi Kumar, accountant, ₹35000 salary"\n• **Manage projects** — "Create project LawMS website redesign for client XYZ"\n• **Record payments** — "Record incoming payment of ₹50000 from ABC Corp via UPI"\n• **Send bills** — "Send bill to client@email.com for 10 hours consulting at ₹2000/hr with payment link"\n• **Query data** — "Show me all pending invoices" or "How many employees do we have?"\n\nYou can **type** or use the **microphone** button to speak your commands.`,
      timestamp: new Date().toISOString(),
    }]);

    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  function toggleListening() {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser. Please use Chrome.');
      return;
    }
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      setInput('');
      recognitionRef.current.start();
      setListening(true);
    }
  }

  async function sendCommand(promptOverride) {
    const prompt = promptOverride || input.trim();
    if (!prompt || loading) return;

    const userMsg = { role: 'user', content: prompt, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    abortControllerRef.current = new AbortController();

    try {
      // Build conversation history for context
      const history = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));

      const aiResponse = await api.post('/ai/command', { prompt, conversationHistory: history }, { signal: abortControllerRef.current.signal });

      const assistantMsg = {
        role: 'assistant',
        content: aiResponse.message || 'Done.',
        action: aiResponse.action,
        data: aiResponse.data,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMsg]);

      // Auto-execute for queries and general responses
      if (['GENERAL', 'QUERY_DATA'].includes(aiResponse.action)) {
        // No action needed
      } else {
        // Set pending action for confirmation
        setPendingAction(aiResponse);
      }
    } catch (err) {
      if (err?.code === 'TIMEOUT') {
        setMessages(prev => [...prev, {
          role: 'error',
          content: 'Error: Request timed out. The AI took too long to respond. Please try again.',
          timestamp: new Date().toISOString(),
        }]);
      } else if (err?.code !== 'ABORT_ERR') {
        setMessages(prev => [...prev, {
          role: 'error',
          content: `Error: ${err?.message || 'Failed to process command'}`,
          timestamp: new Date().toISOString(),
        }]);
      }
    }
    setLoading(false);
  }

  async function executeAction(actionData) {
    if (!actionData) return;
    setLoading(true);

    abortControllerRef.current = new AbortController();

    try {
      const result = await api.post('/ai/execute', {
        action: actionData.action,
        data: actionData.data,
      }, { signal: abortControllerRef.current.signal });

      setMessages(prev => [...prev, {
        role: 'system',
        content: result.message || (result.success ? 'Action completed successfully.' : 'Action failed.'),
        success: result.success,
        result,
        timestamp: new Date().toISOString(),
      }]);
    } catch (err) {
      if (err?.code === 'TIMEOUT') {
        setMessages(prev => [...prev, {
          role: 'error',
          content: 'Execution timed out. The action took too long to complete. Please try again.',
          timestamp: new Date().toISOString(),
        }]);
      } else if (err?.code !== 'ABORT_ERR') {
        setMessages(prev => [...prev, {
          role: 'error',
          content: `Execution failed: ${err?.message || 'Unknown error'}`,
          timestamp: new Date().toISOString(),
        }]);
      }
    }

    setPendingAction(null);
    setLoading(false);
  }

  function dismissAction() {
    setPendingAction(null);
    setMessages(prev => [...prev, {
      role: 'system',
      content: 'Action cancelled.',
      timestamp: new Date().toISOString(),
    }]);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCommand();
    }
  }

  // Quick prompts
  const quickPrompts = [
    { label: 'List Employees', prompt: 'Show me all employees' },
    { label: 'Pending Invoices', prompt: 'Show all pending invoices' },
    { label: 'Recent Payments', prompt: 'Show recent payments' },
    { label: 'Draft a Letter', prompt: 'Write a formal letter to ' },
    { label: 'Create Invoice', prompt: 'Create an invoice for ' },
    { label: 'Send Email', prompt: 'Send an email to ' },
    { label: 'Send Bill', prompt: 'Send a bill with payment link to ' },
  ];

  // ===== RENDER HELPERS =====
  function getActionBadge(action) {
    const badges = {
      CREATE_LETTER: { bg: '#e3f2fd', color: '#1565c0', label: 'LETTER' },
      CREATE_EMAIL: { bg: '#fce4ec', color: '#c62828', label: 'EMAIL DRAFT' },
      SEND_EMAIL: { bg: '#ffebee', color: '#b71c1c', label: 'SEND EMAIL' },
      CREATE_INVOICE: { bg: '#fff3e0', color: '#e65100', label: 'INVOICE' },
      ADD_EMPLOYEE: { bg: '#e8f5e9', color: '#2e7d32', label: 'ADD EMPLOYEE' },
      UPDATE_EMPLOYEE: { bg: '#e8f5e9', color: '#2e7d32', label: 'UPDATE EMPLOYEE' },
      ADD_PROJECT: { bg: '#f3e5f5', color: '#6a1b9a', label: 'NEW PROJECT' },
      UPDATE_PROJECT: { bg: '#f3e5f5', color: '#6a1b9a', label: 'UPDATE PROJECT' },
      RECORD_PAYMENT: { bg: '#e0f2f1', color: '#00695c', label: 'PAYMENT' },
      SEND_BILL: { bg: '#fff3e0', color: '#e65100', label: 'SEND BILL + PAY LINK' },
      QUERY_DATA: { bg: '#f5f5f5', color: '#616161', label: 'QUERY' },
      GENERAL: { bg: '#f5f5f5', color: '#616161', label: 'INFO' },
    };
    return badges[action] || { bg: '#f5f5f5', color: '#616161', label: action };
  }

  function renderPreview(data, action) {
    if (!data) return null;

    if (action === 'CREATE_LETTER') {
      return (
        <div style={s.previewBox}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Letter Preview</div>
          {data.to && (
            <div style={{ marginBottom: 12, fontSize: 12 }}>
              <strong>To:</strong> {data.to.name}{data.to.designation && `, ${data.to.designation}`}
              {data.to.company && <><br />{data.to.company}</>}
              {data.to.address && <><br />{data.to.address}</>}
            </div>
          )}
          {data.subject && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 700 }}>Re: {data.subject}</div>}
          <div style={{ fontSize: 12, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: data.body }} />
          {data.closing && <div style={{ marginTop: 16, fontSize: 12, fontStyle: 'italic' }}>{data.closing}</div>}
        </div>
      );
    }

    if (action === 'CREATE_EMAIL' || action === 'SEND_EMAIL') {
      return (
        <div style={s.previewBox}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Email Preview</div>
          <div style={{ fontSize: 12, marginBottom: 4 }}><strong>To:</strong> {data.to}</div>
          <div style={{ fontSize: 12, marginBottom: 12 }}><strong>Subject:</strong> {data.subject}</div>
          <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '8px 0' }} />
          <div style={{ fontSize: 12, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: data.body }} />
        </div>
      );
    }

    if (action === 'CREATE_INVOICE') {
      return (
        <div style={s.previewBox}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Invoice Preview</div>
          <div style={{ fontSize: 12, marginBottom: 8 }}><strong>Customer:</strong> {data.customer?.name} {data.customer?.gstin && `(${data.customer.gstin})`}</div>
          {data.items && (
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginBottom: 8 }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={s.th}>Item</th>
                  <th style={s.th}>Qty</th>
                  <th style={s.th}>Rate</th>
                  <th style={s.th}>GST%</th>
                  <th style={s.th}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, i) => (
                  <tr key={i}>
                    <td style={s.td}>{item.description}</td>
                    <td style={{ ...s.td, textAlign: 'center' }}>{item.qty}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>₹{(item.rate || 0).toLocaleString('en-IN')}</td>
                    <td style={{ ...s.td, textAlign: 'center' }}>{item.gstRate}%</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>₹{((item.qty || 1) * (item.rate || 0)).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.notes && <div style={{ fontSize: 11, color: '#666' }}>Notes: {data.notes}</div>}
        </div>
      );
    }

    if (action === 'SEND_BILL') {
      return (
        <div style={s.previewBox}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Bill + Payment Link Preview</div>
          <div style={{ fontSize: 12, marginBottom: 8 }}><strong>Customer:</strong> {data.customer?.name} ({data.customer?.email})</div>
          {data.items && (
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginBottom: 8 }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={s.th}>Item</th>
                  <th style={s.th}>Qty</th>
                  <th style={s.th}>Rate</th>
                  <th style={s.th}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, i) => (
                  <tr key={i}>
                    <td style={s.td}>{item.description}</td>
                    <td style={{ ...s.td, textAlign: 'center' }}>{item.qty}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>₹{(item.rate || 0).toLocaleString('en-IN')}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>₹{((item.qty || 1) * (item.rate || 0)).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 12, color: '#e65100', fontWeight: 700 }}>
            Invoice will be created, Razorpay payment link generated, and emailed to {data.customer?.email}
          </div>
        </div>
      );
    }

    if (action === 'ADD_EMPLOYEE' || action === 'UPDATE_EMPLOYEE') {
      return (
        <div style={s.previewBox}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Employee Details</div>
          {Object.entries(data).filter(([k]) => k !== 'searchName' && k !== 'updates').map(([k, v]) => (
            <div key={k} style={{ fontSize: 12, marginBottom: 4 }}>
              <strong>{k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </div>
          ))}
          {data.updates && Object.entries(data.updates).map(([k, v]) => (
            <div key={k} style={{ fontSize: 12, marginBottom: 4 }}>
              <strong>{k}:</strong> {String(v)} <span style={{ color: '#2e7d32', fontSize: 10 }}>(updating)</span>
            </div>
          ))}
        </div>
      );
    }

    if (action === 'ADD_PROJECT' || action === 'UPDATE_PROJECT') {
      return (
        <div style={s.previewBox}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Project Details</div>
          {Object.entries(data).filter(([k]) => k !== 'searchName' && k !== 'updates').map(([k, v]) => (
            <div key={k} style={{ fontSize: 12, marginBottom: 4 }}>
              <strong>{k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </div>
          ))}
          {data.updates && Object.entries(data.updates).map(([k, v]) => (
            <div key={k} style={{ fontSize: 12, marginBottom: 4 }}>
              <strong>{k}:</strong> {String(v)} <span style={{ color: '#6a1b9a', fontSize: 10 }}>(updating)</span>
            </div>
          ))}
        </div>
      );
    }

    if (action === 'RECORD_PAYMENT') {
      return (
        <div style={s.previewBox}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Payment Details</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: data.type === 'incoming' ? '#2e7d32' : '#c62828', marginBottom: 8 }}>
            {data.type === 'incoming' ? '+' : '-'}₹{(data.amount || 0).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: 12 }}><strong>Type:</strong> {data.type || 'incoming'}</div>
          <div style={{ fontSize: 12 }}><strong>Method:</strong> {data.method || 'bank_transfer'}</div>
          {data.description && <div style={{ fontSize: 12 }}><strong>Description:</strong> {data.description}</div>}
          {data.reference && <div style={{ fontSize: 12 }}><strong>Reference:</strong> {data.reference}</div>}
        </div>
      );
    }

    return null;
  }

  function formatMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/\n/g, '<br/>');
  }

  // ===== STYLES =====
  const s = {
    page: {
      display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)',
      maxWidth: 900, margin: '0 auto', padding: '0',
    },
    chatArea: {
      flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex',
      flexDirection: 'column', gap: 16,
    },
    msgRow: (role) => ({
      display: 'flex', justifyContent: role === 'user' ? 'flex-end' : 'flex-start',
      alignItems: 'flex-start', gap: 10,
    }),
    avatar: (role) => ({
      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 900,
      background: role === 'user' ? '#1a1a1a' : role === 'error' ? '#c62828' : '#2e7d32',
      color: '#fff', border: '2px solid',
      borderColor: role === 'user' ? '#1a1a1a' : role === 'error' ? '#c62828' : '#2e7d32',
    }),
    bubble: (role) => ({
      maxWidth: '75%', padding: '12px 16px', borderRadius: 16,
      fontSize: 13, lineHeight: 1.6, fontWeight: 500,
      ...(role === 'user' ? {
        background: '#1a1a1a', color: '#fff',
        borderBottomRightRadius: 4,
      } : role === 'error' ? {
        background: '#ffebee', color: '#c62828', border: '2px solid #ffcdd2',
        borderBottomLeftRadius: 4,
      } : role === 'system' ? {
        background: '#e8f5e9', color: '#1b5e20', border: '2px solid #c8e6c9',
        borderBottomLeftRadius: 4, fontWeight: 700, fontSize: 12,
      } : {
        background: '#fff', color: '#1a1a1a', border: '2px solid #e0e0e0',
        borderBottomLeftRadius: 4, boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }),
    }),
    actionBadge: (bg, color) => ({
      display: 'inline-block', padding: '2px 8px', fontSize: 9, fontWeight: 900,
      textTransform: 'uppercase', letterSpacing: 1, borderRadius: 4,
      background: bg, color: color, marginBottom: 8,
    }),
    previewBox: {
      background: '#fafafa', border: '2px solid #e0e0e0', borderRadius: 10,
      padding: 14, marginTop: 10,
    },
    th: { padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #e0e0e0', fontWeight: 800 },
    td: { padding: '5px 8px', borderBottom: '1px solid #eee' },
    actionBar: {
      display: 'flex', gap: 8, padding: '12px 16px',
      background: '#fff8e1', borderTop: '2px solid #ffe082', borderBottom: '2px solid #ffe082',
      alignItems: 'center', flexWrap: 'wrap',
    },
    inputArea: {
      padding: '12px 16px', borderTop: '3px solid #1a1a1a', background: '#fff',
      display: 'flex', gap: 10, alignItems: 'flex-end',
    },
    textarea: {
      flex: 1, padding: '10px 14px', border: '2px solid #ddd', borderRadius: 12,
      fontSize: 14, fontWeight: 500, outline: 'none', resize: 'none',
      fontFamily: 'Inter, sans-serif', minHeight: 44, maxHeight: 150,
      transition: 'border-color 0.2s',
    },
    btn: {
      padding: '10px 20px', border: '3px solid #1a1a1a', borderRadius: 10,
      background: '#2e7d32', color: '#fff', fontWeight: 900, fontSize: 13,
      cursor: 'pointer', boxShadow: '3px 3px 0 #1a1a1a', textTransform: 'uppercase',
      letterSpacing: 0.5, transition: 'all 0.1s', whiteSpace: 'nowrap',
    },
    btnSm: {
      padding: '6px 14px', border: '2px solid #1a1a1a', borderRadius: 6,
      fontWeight: 800, fontSize: 11, cursor: 'pointer', transition: 'all 0.1s',
    },
    micBtn: (active) => ({
      width: 44, height: 44, borderRadius: '50%', border: '3px solid',
      borderColor: active ? '#c62828' : '#1a1a1a',
      background: active ? '#c62828' : '#fff',
      color: active ? '#fff' : '#1a1a1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', fontSize: 18, fontWeight: 900,
      boxShadow: active ? '0 0 0 4px rgba(198,40,40,0.2)' : '2px 2px 0 #1a1a1a',
      animation: active ? 'pulse 1.5s infinite' : 'none',
      transition: 'all 0.2s', flexShrink: 0,
    }),
    quickPrompts: {
      display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 16px',
      borderTop: '1px solid #eee',
    },
    quickBtn: {
      padding: '5px 12px', border: '2px solid #e0e0e0', borderRadius: 20,
      background: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
      color: '#555', transition: 'all 0.15s',
    },
    typingDots: {
      display: 'flex', gap: 4, padding: '12px 16px', alignItems: 'center',
    },
    dot: (delay) => ({
      width: 8, height: 8, borderRadius: '50%', background: '#2e7d32',
      animation: `bounce 1.4s infinite ${delay}s`,
    }),
  };

  return (
    <div style={s.page}>
      {/* CSS Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(198,40,40,0.2); }
          50% { box-shadow: 0 0 0 12px rgba(198,40,40,0.1); }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-8px); }
        }
        .ai-msg-enter { animation: fadeSlideIn 0.3s ease-out; }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ===== MESSAGES ===== */}
      <div style={s.chatArea}>
        {messages.map((msg, i) => (
          <div key={i} style={s.msgRow(msg.role)} className="ai-msg-enter">
            {msg.role !== 'user' && (
              <div style={s.avatar(msg.role)}>
                {msg.role === 'assistant' ? 'AI' : msg.role === 'error' ? '!' : '✓'}
              </div>
            )}
            <div style={{ maxWidth: '75%' }}>
              {/* Action badge */}
              {msg.action && msg.action !== 'GENERAL' && msg.action !== 'QUERY_DATA' && (
                <div style={s.actionBadge(getActionBadge(msg.action).bg, getActionBadge(msg.action).color)}>
                  {getActionBadge(msg.action).label}
                </div>
              )}

              <div style={s.bubble(msg.role)}>
                <div dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />
              </div>

              {/* Preview */}
              {msg.data && msg.action && !['GENERAL', 'QUERY_DATA'].includes(msg.action) && (
                <>
                  <button
                    onClick={() => setShowPreview(showPreview === i ? null : i)}
                    style={{ ...s.quickBtn, marginTop: 6, borderColor: '#2e7d32', color: '#2e7d32' }}>
                    {showPreview === i ? 'Hide Preview' : 'Show Preview'}
                  </button>
                  {showPreview === i && renderPreview(msg.data, msg.action)}
                </>
              )}

              {/* Timestamp */}
              <div style={{ fontSize: 10, color: '#aaa', marginTop: 4, fontWeight: 600 }}>
                {new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            {msg.role === 'user' && (
              <div style={s.avatar('user')}>
                {(user?.name || 'U')[0].toUpperCase()}
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div style={s.msgRow('assistant')} className="ai-msg-enter">
            <div style={s.avatar('assistant')}>AI</div>
            <div style={s.bubble('assistant')}>
              <div style={s.typingDots}>
                <div style={s.dot(0)} /><div style={s.dot(0.2)} /><div style={s.dot(0.4)} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ===== PENDING ACTION BAR ===== */}
      {pendingAction && (
        <div style={s.actionBar}>
          <div style={s.actionBadge(getActionBadge(pendingAction.action).bg, getActionBadge(pendingAction.action).color)}>
            {getActionBadge(pendingAction.action).label}
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>
            {pendingAction.action === 'SEND_EMAIL'
              ? `Send email to ${pendingAction.data?.to}?`
              : `Confirm ${getActionBadge(pendingAction.action).label.toLowerCase()}?`
            }
          </span>
          <button
            onClick={() => executeAction(pendingAction)}
            disabled={loading}
            style={{ ...s.btnSm, background: '#2e7d32', color: '#fff', borderColor: '#1a1a1a' }}>
            {loading ? 'Executing...' : pendingAction.action === 'SEND_EMAIL' ? 'Send Now' : 'Confirm & Execute'}
          </button>
          <button onClick={() => setShowPreview(pendingAction === showPreview ? null : 'pending')}
            style={{ ...s.btnSm, background: '#fff' }}>
            Preview
          </button>
          <button onClick={dismissAction} style={{ ...s.btnSm, background: '#ffebee', color: '#c62828', borderColor: '#c62828' }}>
            Cancel
          </button>
          {showPreview === 'pending' && (
            <div style={{ width: '100%', marginTop: 8 }}>
              {renderPreview(pendingAction.data, pendingAction.action)}
            </div>
          )}
        </div>
      )}

      {/* ===== QUICK PROMPTS ===== */}
      {messages.length <= 1 && (
        <div style={s.quickPrompts}>
          {quickPrompts.map((qp, i) => (
            <button key={i} style={s.quickBtn}
              onMouseOver={e => { e.target.style.borderColor = '#2e7d32'; e.target.style.color = '#2e7d32'; }}
              onMouseOut={e => { e.target.style.borderColor = '#e0e0e0'; e.target.style.color = '#555'; }}
              onClick={() => {
                if (qp.prompt.endsWith(' ')) {
                  setInput(qp.prompt);
                  textareaRef.current?.focus();
                } else {
                  sendCommand(qp.prompt);
                }
              }}>
              {qp.label}
            </button>
          ))}
        </div>
      )}

      {/* ===== INPUT BAR ===== */}
      <div style={s.inputArea}>
        <button
          onClick={toggleListening}
          style={s.micBtn(listening)}
          title={listening ? 'Stop listening' : 'Start voice input'}>
          {listening ? (
            <svg viewBox="0 0 24 24" width="20" height="20"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
          )}
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={listening ? 'Listening... speak your command' : 'Type a command or press the mic button...'}
          style={{
            ...s.textarea,
            borderColor: listening ? '#c62828' : '#ddd',
            background: listening ? '#fff5f5' : '#fff',
          }}
          rows={1}
          disabled={loading}
        />
        <button
          onClick={() => sendCommand()}
          disabled={!input.trim() || loading}
          style={{
            ...s.btn,
            opacity: (!input.trim() || loading) ? 0.5 : 1,
            cursor: (!input.trim() || loading) ? 'not-allowed' : 'pointer',
          }}>
          {loading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
