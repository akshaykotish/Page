import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Razorpay from 'razorpay';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, ValidationError, ServiceUnavailableError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { v4 as uuidv4 } from 'uuid';
import { sendEmail as dispatchEmail, getMailConfig } from '../utils/mailer.js';

const router = Router();
router.use(verifyToken);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Gemini model — configurable via env, defaults to latest stable (gemini-2.5-pro)
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const GEMINI_FAST_MODEL = process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash';

const AI_TIMEOUT_MS = 45000;
const MAX_RESPONSE_SIZE = 1024 * 1024;
const MAX_CONVERSATION_HISTORY = 20;

// ===== PARSE AI JSON RESPONSE =====
function parseAIJson(rawText) {
  let text = rawText.trim();
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(text); } catch {}
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  const fixed = text.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(fixed); } catch {}
  throw new Error('Could not parse AI response as JSON');
}

// ===== BUILD SYSTEM PROMPT =====
function buildSystemPrompt(companyContext) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const isoDate = today.toISOString().split('T')[0];
  const dueDateISO = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  return `You are the AI business assistant for "${companyContext.companyName}".

COMPANY DETAILS (use in letters, emails, invoices — DO NOT ask the user for these):
Name: ${companyContext.companyName}
Legal Name: ${companyContext.legalName}
CIN: ${companyContext.cin} | GSTIN: ${companyContext.gstin} | PAN: ${companyContext.pan}
Address: ${companyContext.address}
State: ${companyContext.state} (Code: ${companyContext.stateCode})
Email: ${companyContext.email} | Phone: ${companyContext.phone} | Website: ${companyContext.website}

TODAY'S DATE: ${dateStr}
ISO DATE: ${isoDate}
IMPORTANT: Always use TODAY'S DATE (${dateStr}) in ALL letters, emails, invoices, and documents you generate. Never use a placeholder or past date.

CORE PRINCIPLE: Be SMART. Infer everything you can. Never ask for information you can deduce. If the user says "write a letter to Sharma about tax filing", produce the FULL letter immediately — don't ask what to write. Fill in reasonable professional defaults for anything not specified.

OUTPUT: Return ONLY valid JSON. No markdown, no code fences, no text outside JSON.

SMART DEFAULTS (apply automatically when user doesn't specify):
- Date: ${isoDate}
- Due date: ${dueDateISO} (30 days from today)
- GST rate: 18%
- Payment method: bank_transfer
- Payment type: incoming (unless context suggests outgoing)
- Employee joining date: ${isoDate}
- Letter closing: "Yours faithfully" (formal) or "Warm regards" (semi-formal)
- Invoice notes: "Payment due within 30 days. Thank you for your business."
- Customer state: "${companyContext.state}" (unless specified otherwise)

ACTIONS:

1. CREATE_LETTER
{ "action": "CREATE_LETTER", "data": { "title": "...", "to": { "name": "...", "designation": "...", "company": "...", "address": "..." }, "subject": "Re: ...", "body": "<FULL PROFESSIONAL HTML LETTER>", "closing": "Yours faithfully" }, "message": "..." }

LETTER BODY FORMAT — Generate complete, professional HTML:
<div style="font-family: 'Georgia', 'Times New Roman', serif; font-size: 14px; line-height: 1.8; color: #1a1a1a;">
  <p style="margin-bottom: 6px; text-align: right; font-size: 13px; color: #555;">Date: ${dateStr}</p>
  <p style="margin-bottom: 6px; font-size: 13px; color: #555;">Ref: AK&Co/[TYPE]/[YEAR-MONTH]/001</p>
  <p style="margin-bottom: 16px;">[Opening paragraph — reference, context]</p>
  <p style="margin-bottom: 16px;">[Body paragraph(s) — detailed content, clear and professional]</p>
  <p style="margin-bottom: 16px;">[Closing paragraph — next steps, call to action]</p>
</div>
Write 3-5 substantial paragraphs. Use formal Indian business English. ALWAYS include today's date (${dateStr}) at the top of the letter. Reference specific details from the user's command. Include relevant legal/financial references where appropriate (GST, IT Act sections, compliance deadlines, etc.).

2. CREATE_EMAIL
{ "action": "CREATE_EMAIL", "data": { "to": "email@example.com", "subject": "...", "body": "<PROFESSIONAL HTML EMAIL>" }, "message": "..." }

3. SEND_EMAIL
{ "action": "SEND_EMAIL", "data": { "to": "email@example.com", "subject": "...", "body": "<PROFESSIONAL HTML EMAIL>" }, "message": "..." }

EMAIL BODY FORMAT — Generate polished, branded HTML:
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; color: #333;">
  <p style="font-size: 15px; line-height: 1.7; margin-bottom: 14px;">Dear [Name],</p>
  <p style="font-size: 15px; line-height: 1.7; margin-bottom: 14px;">[Content paragraphs]</p>
  <p style="font-size: 15px; line-height: 1.7; margin-bottom: 14px;">Please do not hesitate to reach out if you have any questions.</p>
  <div style="margin-top: 28px; padding-top: 16px; border-top: 2px solid #1a1a1a;">
    <p style="margin: 0; font-weight: 700; font-size: 14px; color: #1a1a1a;">Best regards,</p>
    <p style="margin: 4px 0 0; font-weight: 800; font-size: 15px; color: #1a1a1a;">${companyContext.companyName}</p>
    <p style="margin: 2px 0 0; font-size: 12px; color: #666;">${companyContext.email} | ${companyContext.phone}</p>
    <p style="margin: 2px 0 0; font-size: 12px; color: #666;">${companyContext.website}</p>
  </div>
</div>

4. CREATE_INVOICE
{ "action": "CREATE_INVOICE", "data": { "customer": { "name": "...", "email": "", "phone": "", "address": "", "gstin": "", "state": "${companyContext.state}" }, "items": [{ "description": "...", "hsn": "998311", "qty": 1, "rate": 0, "gstRate": 18 }], "notes": "Payment due within 30 days. Thank you for your business.", "dueDate": "${dueDateISO}" }, "message": "..." }

5. ADD_EMPLOYEE
{ "action": "ADD_EMPLOYEE", "data": { "name": "...", "email": "", "phone": "", "department": "General", "designation": "...", "salary": 0, "joiningDate": "${isoDate}" }, "message": "..." }

6. UPDATE_EMPLOYEE
{ "action": "UPDATE_EMPLOYEE", "data": { "searchName": "...", "updates": {} }, "message": "..." }

7. ADD_PROJECT
{ "action": "ADD_PROJECT", "data": { "name": "...", "client": "...", "description": "...", "budget": 0, "startDate": "${isoDate}", "deadline": "", "status": "active" }, "message": "..." }

8. UPDATE_PROJECT
{ "action": "UPDATE_PROJECT", "data": { "searchName": "...", "updates": {} }, "message": "..." }

9. RECORD_PAYMENT
{ "action": "RECORD_PAYMENT", "data": { "amount": 0, "type": "incoming", "method": "bank_transfer", "description": "...", "reference": "" }, "message": "..." }

10. SEND_BILL — Create invoice + Razorpay payment link + email
{ "action": "SEND_BILL", "data": { "customer": { "name": "...", "email": "...", "phone": "", "address": "", "gstin": "", "state": "${companyContext.state}" }, "items": [{ "description": "...", "hsn": "998311", "qty": 1, "rate": 0, "gstRate": 18 }], "notes": "" }, "message": "..." }

11. QUERY_DATA
{ "action": "QUERY_DATA", "data": { "queryType": "employees|invoices|payments|projects|summary", "filters": {} }, "message": "detailed answer with data" }

12. GENERAL
{ "action": "GENERAL", "data": {}, "message": "your response" }

INTELLIGENCE RULES:
- NEVER ask the user for company details — you already have them.
- If user says "letter to Sharma about tax filing" — write the FULL letter immediately. Infer Sharma is a client, use appropriate formal tone, reference relevant tax provisions.
- If user says "email Ravi about salary" — check employee data, find Ravi's email, draft about salary.
- If user says "invoice for XYZ, 5 hours at 2000" — create full invoice with customer name "XYZ", 1 item "Professional Services / Consulting" at qty=5, rate=2000.
- If user says "bill client@email.com for website work 50000" — create SEND_BILL with email, amount=50000, description="Website Development".
- For voice commands with typos/errors — interpret intent, don't fail.
- Use SEND_EMAIL when user says "send", "email to", "mail to". Use CREATE_EMAIL only when they say "draft".
- For queries about existing data, summarize the BUSINESS DATA provided in context. Give counts, totals, and names.
- Fill ALL fields with reasonable defaults. Leave fields empty string "" only if truly unknown and non-critical.
- HSN codes: 998311 (management consulting), 998312 (accounting/bookkeeping), 998313 (tax consulting), 998314 (IT services), 998399 (other professional services).
- Indian business formalities: use "Respected Sir/Madam", "Yours faithfully", reference sections of IT Act, GST Act, Companies Act where relevant.`;
}

// ===== FETCH BUSINESS CONTEXT =====
async function getBusinessContext() {
  const context = { employees: [], projects: [], recentInvoices: [], recentPayments: [] };

  try {
    const empSnap = await db.collection('employees').where('status', '==', 'active').get();
    context.employees = empSnap.docs.map(d => ({ id: d.id, name: d.data().name, email: d.data().email, designation: d.data().designation, department: d.data().department }));
  } catch {}

  try {
    const projSnap = await db.collection('projects').orderBy('createdAt', 'desc').limit(20).get();
    context.projects = projSnap.docs.map(d => ({ id: d.id, name: d.data().name, client: d.data().client, status: d.data().status, budget: d.data().budget }));
  } catch {
    try {
      const projSnap = await db.collection('projects').get();
      context.projects = projSnap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, 20);
    } catch {}
  }

  try {
    const invSnap = await db.collection('invoices').orderBy('createdAt', 'desc').limit(10).get();
    context.recentInvoices = invSnap.docs.map(d => ({ id: d.id, number: d.data().invoiceNumber, customer: d.data().customer?.name, total: d.data().total, status: d.data().status }));
  } catch {}

  try {
    const paySnap = await db.collection('payments').orderBy('createdAt', 'desc').limit(10).get();
    context.recentPayments = paySnap.docs.map(d => ({ id: d.id, paymentId: d.data().paymentId, amount: d.data().amount, type: d.data().type, description: d.data().description }));
  } catch {}

  return context;
}

// ===== TIMEOUT WRAPPER =====
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI API request timeout')), timeoutMs)
    )
  ]);
}

// ===== MAIN AI COMMAND ENDPOINT =====
router.post('/command', aiLimiter, validate('aiCommand'), asyncHandler(async (req, res) => {
  const { prompt, conversationHistory } = req.body;

  if (!prompt || !prompt.trim()) {
    throw new ValidationError('AI command validation failed', ['prompt is required']);
  }

  const companyContext = {
    companyName: process.env.COMPANY_NAME || 'Akshay Kotish & Co.',
    legalName: process.env.COMPANY_LEGAL_NAME || 'Akshay Lakshay Kotish Private Limited',
    cin: process.env.COMPANY_CIN || 'U72900HR2022PTC101170',
    gstin: process.env.COMPANY_GSTIN || '06AAWCA4919K1Z3',
    pan: process.env.COMPANY_PAN || 'AAWCA4919K',
    state: process.env.COMPANY_STATE || 'Haryana',
    stateCode: process.env.COMPANY_STATE_CODE || '06',
    address: process.env.COMPANY_ADDRESS || 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027',
    email: process.env.COMPANY_EMAIL || process.env.MAIL_FROM_EMAIL || 'akshaykotish@gmail.com',
    phone: process.env.COMPANY_PHONE || '+91 98967 70369',
    website: process.env.COMPANY_WEBSITE || 'www.akshaykotish.com',
  };

  const bizData = await getBusinessContext();

  const systemPrompt = buildSystemPrompt(companyContext);
  const contextMessage = `CURRENT BUSINESS DATA (use for reference):
Employees: ${JSON.stringify(bizData.employees)}
Projects: ${JSON.stringify(bizData.projects)}
Recent Invoices: ${JSON.stringify(bizData.recentInvoices)}
Recent Payments: ${JSON.stringify(bizData.recentPayments)}`;

  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const contents = [];
  if (conversationHistory && conversationHistory.length > 0) {
    for (const msg of conversationHistory.slice(-MAX_CONVERSATION_HISTORY)) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  contents.push({
    role: 'user',
    parts: [{ text: `${contextMessage}\n\nUSER COMMAND: ${prompt}` }],
  });

  try {
    const resultPromise = withTimeout(
      model.generateContent({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
      AI_TIMEOUT_MS
    );

    const result = await resultPromise;
    const responseText = result.response.text();

    if (!responseText || responseText.length > MAX_RESPONSE_SIZE) {
      throw new Error('Response size exceeded maximum limit');
    }

    let aiResponse;
    try {
      aiResponse = parseAIJson(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiResponse = JSON.parse(jsonMatch[0]);
      } else {
        aiResponse = { action: 'GENERAL', data: {}, message: responseText };
      }
    }

    await db.collection('ai_logs').add({
      userId: req.user.uid,
      prompt: prompt.substring(0, 1000),
      response: {
        action: aiResponse.action,
        message: aiResponse.message,
      },
      timestamp: new Date().toISOString(),
    });

    console.log(JSON.stringify({
      level: 'info',
      event: 'ai_command_executed',
      userId: req.user.uid,
      action: aiResponse.action,
      timestamp: new Date().toISOString()
    }));

    res.json(aiResponse);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'ai_command_failed',
      userId: req.user.uid,
      error: error.message,
      timestamp: new Date().toISOString()
    }));

    if (error.message.includes('timeout')) {
      throw new ServiceUnavailableError('AI API request timeout. Please try again.');
    }
    throw error;
  }
}));

// ===== EXECUTE ACTION =====
router.post('/execute', asyncHandler(async (req, res) => {
  const { action, data } = req.body;
  let result = { success: false };

  try {
    switch (action) {
      case 'SEND_EMAIL': {
        const info = await dispatchEmail({
          to: data.to,
          subject: data.subject,
          html: data.body,
        });

        result = { success: true, messageId: info.messageId, message: `Email sent to ${data.to}` };
        console.log(JSON.stringify({
          level: 'info',
          event: 'email_sent_from_ai',
          userId: req.user.uid,
          to: data.to,
          messageId: info.messageId,
          timestamp: new Date().toISOString()
        }));
        break;
      }

      case 'CREATE_INVOICE': {
        const { customer, items, notes, dueDate } = data;
        const companyState = process.env.COMPANY_STATE || 'Haryana';

        const counterRef = db.collection('counters').doc('invoice');
        const counter = await db.runTransaction(async (t) => {
          const doc = await t.get(counterRef);
          const newCount = (doc.exists ? doc.data().count : 0) + 1;
          t.set(counterRef, { count: newCount });
          return newCount;
        });

        const invoiceNumber = `INV-${new Date().getFullYear()}-${String(counter).padStart(4, '0')}`;
        const isInterstate = customer.state !== companyState;

        let subtotal = 0, totalCGST = 0, totalSGST = 0, totalIGST = 0;
        const calculatedItems = (items || []).map(item => {
          const amount = (item.qty || 1) * (item.rate || 0);
          const gstAmount = amount * ((item.gstRate || 18) / 100);
          subtotal += amount;
          if (isInterstate) { totalIGST += gstAmount; }
          else { totalCGST += gstAmount / 2; totalSGST += gstAmount / 2; }
          return { ...item, amount, gstAmount };
        });

        const total = subtotal + totalCGST + totalSGST + totalIGST;
        const invoice = {
          invoiceNumber, date: new Date().toISOString(),
          dueDate: dueDate || new Date(Date.now() + 30 * 86400000).toISOString(),
          customer, items: calculatedItems,
          subtotal, cgst: totalCGST, sgst: totalSGST, igst: totalIGST, total,
          status: 'draft', notes: notes || '',
          createdBy: req.user.uid, createdAt: new Date().toISOString(),
        };

        const docRef = await db.collection('invoices').add(invoice);

        await db.collection('journal_entries').add({
          date: invoice.date,
          description: `Invoice ${invoiceNumber} — ${customer.name}`,
          entries: [
            { account: 'Accounts Receivable', debit: total, credit: 0 },
            { account: 'Sales Revenue', debit: 0, credit: subtotal },
            { account: isInterstate ? 'IGST Payable' : 'CGST Payable', debit: 0, credit: isInterstate ? totalIGST : totalCGST },
            ...(!isInterstate ? [{ account: 'SGST Payable', debit: 0, credit: totalSGST }] : []),
          ],
          reference: invoiceNumber, createdAt: new Date().toISOString(),
        });

        result = { success: true, id: docRef.id, invoiceNumber, total, message: `Invoice ${invoiceNumber} created — Total: ₹${total.toLocaleString('en-IN')}` };
        break;
      }

      case 'ADD_EMPLOYEE': {
        const employee = {
          ...data,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        const docRef = await db.collection('employees').add(employee);
        result = { success: true, id: docRef.id, message: `Employee "${data.name}" added successfully` };
        break;
      }

      case 'UPDATE_EMPLOYEE': {
        const { searchName, updates } = data;
        const empSnap = await db.collection('employees').get();
        const match = empSnap.docs.find(d =>
          d.data().name?.toLowerCase().includes(searchName.toLowerCase())
        );
        if (!match) {
          result = { success: false, message: `Employee "${searchName}" not found` };
        } else {
          await match.ref.update({ ...updates, updatedAt: new Date().toISOString() });
          result = { success: true, id: match.id, message: `Updated employee "${match.data().name}"` };
        }
        break;
      }

      case 'ADD_PROJECT': {
        const project = {
          ...data,
          status: data.status || 'active',
          createdBy: req.user.uid,
          createdAt: new Date().toISOString(),
        };
        const docRef = await db.collection('projects').add(project);
        result = { success: true, id: docRef.id, message: `Project "${data.name}" created` };
        break;
      }

      case 'UPDATE_PROJECT': {
        const projSnap = await db.collection('projects').get();
        const projMatch = projSnap.docs.find(d =>
          d.data().name?.toLowerCase().includes(data.searchName.toLowerCase())
        );
        if (!projMatch) {
          result = { success: false, message: `Project "${data.searchName}" not found` };
        } else {
          await projMatch.ref.update({ ...data.updates, updatedAt: new Date().toISOString() });
          result = { success: true, id: projMatch.id, message: `Updated project "${projMatch.data().name}"` };
        }
        break;
      }

      case 'RECORD_PAYMENT': {
        const payment = {
          paymentId: `PAY-${uuidv4().slice(0, 8).toUpperCase()}`,
          amount: parseFloat(data.amount),
          type: data.type || 'incoming',
          method: data.method || 'bank_transfer',
          reference: data.reference || '',
          description: data.description || '',
          invoiceId: data.invoiceId || null,
          status: 'completed',
          source: 'ai_assistant',
          createdBy: req.user.uid,
          date: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        const docRef = await db.collection('payments').add(payment);

        await db.collection('journal_entries').add({
          date: payment.date,
          description: `Payment ${payment.paymentId} — ${data.description}`,
          entries: data.type === 'incoming'
            ? [{ account: 'Cash/Bank', debit: payment.amount, credit: 0 }, { account: 'Accounts Receivable', debit: 0, credit: payment.amount }]
            : [{ account: 'Accounts Payable', debit: payment.amount, credit: 0 }, { account: 'Cash/Bank', debit: 0, credit: payment.amount }],
          reference: payment.paymentId, createdAt: new Date().toISOString(),
        });

        result = { success: true, id: docRef.id, paymentId: payment.paymentId, message: `Payment ${payment.paymentId} recorded — ₹${payment.amount.toLocaleString('en-IN')}` };
        break;
      }

      case 'SEND_BILL': {
        const { customer: billCustomer, items: billItems, notes: billNotes } = data;
        const billCompanyState = process.env.COMPANY_STATE || 'Haryana';

        const billCounterRef = db.collection('counters').doc('invoice');
        const billCounter = await db.runTransaction(async (t) => {
          const doc = await t.get(billCounterRef);
          const newCount = (doc.exists ? doc.data().count : 0) + 1;
          t.set(billCounterRef, { count: newCount });
          return newCount;
        });

        const billInvNum = `INV-${new Date().getFullYear()}-${String(billCounter).padStart(4, '0')}`;
        const billIsInterstate = billCustomer.state !== billCompanyState;

        let billSubtotal = 0, billCGST = 0, billSGST = 0, billIGST = 0;
        const billCalcItems = (billItems || []).map(item => {
          const amt = (item.qty || 1) * (item.rate || 0);
          const gst = amt * ((item.gstRate || 18) / 100);
          billSubtotal += amt;
          if (billIsInterstate) { billIGST += gst; }
          else { billCGST += gst / 2; billSGST += gst / 2; }
          return { ...item, amount: amt, gstAmount: gst };
        });

        const billTotal = billSubtotal + billCGST + billSGST + billIGST;
        const billInvoice = {
          invoiceNumber: billInvNum, date: new Date().toISOString(),
          dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          customer: billCustomer, items: billCalcItems,
          subtotal: billSubtotal, cgst: billCGST, sgst: billSGST, igst: billIGST, total: billTotal,
          status: 'sent', notes: billNotes || '',
          createdBy: req.user.uid, createdAt: new Date().toISOString(),
        };

        const billDocRef = await db.collection('invoices').add(billInvoice);

        let paymentLinkUrl = '';
        try {
          const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
          const link = await rzp.paymentLink.create({
            amount: Math.round(billTotal * 100),
            currency: 'INR',
            description: `Invoice ${billInvNum}`,
            customer: { name: billCustomer.name || '', email: billCustomer.email || '', contact: billCustomer.phone || '' },
            notify: { sms: false, email: false },
            notes: { invoice_id: billDocRef.id, invoice_number: billInvNum },
          });
          paymentLinkUrl = link.short_url;

          await db.collection('razorpay_payments').add({
            razorpayPaymentLinkId: link.id,
            razorpayPaymentLinkUrl: link.short_url,
            amount: billTotal, currency: 'INR', status: 'created',
            description: `Invoice ${billInvNum}`, customer: billCustomer,
            invoiceId: billDocRef.id, source: 'ai_assistant',
            createdBy: req.user.uid, createdAt: new Date().toISOString(),
          });
        } catch (rzpErr) {
          console.warn(JSON.stringify({
            level: 'warn',
            event: 'razorpay_link_creation_failed',
            error: rzpErr.message,
            timestamp: new Date().toISOString()
          }));
        }

        if (billCustomer.email) {
          try {
            const cn = process.env.COMPANY_NAME || 'Akshay Kotish & Co.';
            await dispatchEmail({
              to: billCustomer.email,
              subject: `Invoice ${billInvNum} — ₹${billTotal.toLocaleString('en-IN')} | ${cn}`,
              html: `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#2e7d32;padding:24px 30px;border-radius:12px 12px 0 0;">
    <h1 style="color:#fff;margin:0;font-size:22px;">${cn}</h1>
    <p style="color:#c0e040;margin:4px 0 0;font-size:13px;">Invoice ${billInvNum}</p>
  </div>
  <div style="background:#fff;padding:30px;border:1px solid #e0e0e0;border-top:none;">
    <p style="font-size:15px;color:#333;">Dear <strong>${billCustomer.name || 'Sir/Madam'}</strong>,</p>
    <p style="font-size:14px;color:#555;">Please find below the details of your invoice:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <thead><tr style="background:#f5f5f5;">
        <th style="padding:8px;text-align:left;border-bottom:2px solid #e0e0e0;font-size:12px;">Description</th>
        <th style="padding:8px;text-align:center;border-bottom:2px solid #e0e0e0;font-size:12px;">Qty</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #e0e0e0;font-size:12px;">Rate</th>
        <th style="padding:8px;text-align:right;border-bottom:2px solid #e0e0e0;font-size:12px;">Amount</th>
      </tr></thead>
      <tbody>${billCalcItems.map(it => `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:13px;">${it.description}</td>
        <td style="padding:8px;text-align:center;border-bottom:1px solid #eee;font-size:13px;">${it.qty}</td>
        <td style="padding:8px;text-align:right;border-bottom:1px solid #eee;font-size:13px;">₹${(it.rate||0).toLocaleString('en-IN')}</td>
        <td style="padding:8px;text-align:right;border-bottom:1px solid #eee;font-size:13px;">₹${(it.amount||0).toLocaleString('en-IN')}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div style="text-align:right;margin:8px 0;">
      <div style="font-size:13px;color:#555;">Subtotal: ₹${billSubtotal.toLocaleString('en-IN')}</div>
      ${billCGST ? `<div style="font-size:12px;color:#888;">CGST: ₹${billCGST.toLocaleString('en-IN')}</div>` : ''}
      ${billSGST ? `<div style="font-size:12px;color:#888;">SGST: ₹${billSGST.toLocaleString('en-IN')}</div>` : ''}
      ${billIGST ? `<div style="font-size:12px;color:#888;">IGST: ₹${billIGST.toLocaleString('en-IN')}</div>` : ''}
      <div style="font-size:18px;font-weight:900;color:#1a1a1a;margin-top:8px;">Total: ₹${billTotal.toLocaleString('en-IN')}</div>
    </div>
    ${paymentLinkUrl ? `
    <div style="text-align:center;margin:24px 0;">
      <a href="${paymentLinkUrl}" style="display:inline-block;background:#2e7d32;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:800;font-size:15px;">Pay Now</a>
    </div>
    <p style="font-size:11px;color:#999;text-align:center;">Or use: <a href="${paymentLinkUrl}" style="color:#2e7d32;">${paymentLinkUrl}</a></p>
    ` : ''}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
    <p style="font-size:11px;color:#999;">GSTIN: ${process.env.COMPANY_GSTIN || ''} | ${process.env.COMPANY_STATE || ''}</p>
  </div>
  <div style="background:#1a1a1a;padding:16px 30px;border-radius:0 0 12px 12px;text-align:center;">
    <p style="color:#888;font-size:11px;margin:0;">${cn}</p>
  </div>
</div>`,
            });
          } catch (mailErr) {
            console.warn(JSON.stringify({
              level: 'warn',
              event: 'bill_email_send_failed',
              error: mailErr.message,
              timestamp: new Date().toISOString()
            }));
          }
        }

        result = {
          success: true, id: billDocRef.id, invoiceNumber: billInvNum, total: billTotal,
          paymentLinkUrl,
          message: `Invoice ${billInvNum} created (₹${billTotal.toLocaleString('en-IN')})${billCustomer.email ? `, sent to ${billCustomer.email}` : ''}${paymentLinkUrl ? ' with payment link' : ''}`,
        };
        break;
      }

      case 'CREATE_LETTER':
      case 'CREATE_EMAIL': {
        const doc = {
          title: data.title || data.subject || 'Untitled',
          type: action === 'CREATE_LETTER' ? 'letter' : 'email_draft',
          content: JSON.stringify(data),
          createdBy: req.user.uid,
          createdAt: new Date().toISOString(),
        };
        const docRef = await db.collection('documents').add(doc);
        result = { success: true, id: docRef.id, message: `${action === 'CREATE_LETTER' ? 'Letter' : 'Email draft'} saved` };
        break;
      }

      case 'QUERY_DATA': {
        result = { success: true, message: 'Query processed' };
        break;
      }

      default:
        result = { success: true, message: 'Noted' };
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'ai_execute_failed',
      userId: req.user.uid,
      action,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    throw error;
  }

  res.json(result);
}));

// ===== GET AI CONVERSATION HISTORY =====
router.get('/history', asyncHandler(async (req, res) => {
  const { page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  try {
    const snapshot = await db.collection('ai_logs')
      .where('userId', '==', req.user.uid)
      .orderBy('timestamp', 'desc')
      .get();

    let logs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const total = logs.length;
    const paginatedLogs = logs.slice(offset, offset + limitNum);

    res.json({
      logs: paginatedLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'ai_history_fetch_fallback',
      error: error.message,
      timestamp: new Date().toISOString()
    }));

    const snapshot = await db.collection('ai_logs').get();
    let logs = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(d => d.userId === req.user.uid)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    const total = logs.length;
    const paginatedLogs = logs.slice(offset, offset + limitNum);

    res.json({
      logs: paginatedLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  }
}));

// ===== PROFESSIONAL TEMPLATE PRESETS =====
function buildProfessionalTemplate(type, style, w, h, cp) {
  const name = cp.name || 'Akshay Kotish & Co.';
  const legalName = cp.legalName || 'Akshay Lakshay Kotish Private Limited';
  const gstin = cp.gstin || '06AAWCA4919K1Z3';
  const cin = cp.cin || 'U72900HR2022PTC101170';
  const pan = cp.pan || 'AAWCA4919K';
  const addr = cp.address || 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027';
  const phone = cp.phone || '+91 98967 70369';
  const email = cp.email || 'akshaykotish@gmail.com';
  const website = cp.website || 'www.akshaykotish.com';

  const colors = {
    professional: { primary: '#2e7d32', accent: '#c0e040', dark: '#1a1a1a', text: '#333333', light: '#f5f5f5' },
    modern: { primary: '#1565c0', accent: '#42a5f5', dark: '#0d47a1', text: '#263238', light: '#e3f2fd' },
    minimal: { primary: '#555555', accent: '#888888', dark: '#1a1a1a', text: '#333333', light: '#fafafa' },
    bold: { primary: '#c62828', accent: '#ff5252', dark: '#1a1a1a', text: '#1a1a1a', light: '#ffebee' },
    classic: { primary: '#4a148c', accent: '#7c43bd', dark: '#1a1a1a', text: '#333333', light: '#f3e5f5' },
    elegant: { primary: '#2e7d32', accent: '#81c784', dark: '#1b5e20', text: '#1a1a1a', light: '#e8f5e9' },
  }[style] || { primary: '#2e7d32', accent: '#c0e040', dark: '#1a1a1a', text: '#333333', light: '#f5f5f5' };

  if (type === 'letterhead' || type === 'bill_header') {
    return [
      { type: 'rect', left: 0, top: 0, width: w, height: 6, fill: colors.primary, rx: 0, ry: 0 },
      { type: 'i-text', text: name, left: 30, top: 24, fontSize: 28, fontFamily: 'Playfair Display', fontWeight: 'bold', fill: colors.dark },
      { type: 'i-text', text: legalName, left: 30, top: 58, fontSize: 10, fontFamily: 'Inter', fontWeight: 'normal', fill: '#888888', fontStyle: 'italic' },
      { type: 'i-text', text: 'Chartered Accountants & Business Consultants', left: 30, top: 74, fontSize: 11, fontFamily: 'Inter', fontWeight: 'normal', fill: colors.primary },
      { type: 'i-text', text: `GSTIN: ${gstin}`, left: 30, top: 96, fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 'bold', fill: colors.dark },
      { type: 'i-text', text: `CIN: ${cin}`, left: 250, top: 96, fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 'normal', fill: '#666666' },
      { type: 'textbox', text: `${email}\n${phone}\n${website}`, left: w - 230, top: 24, width: 200, fontSize: 11, fontFamily: 'Inter', fontWeight: 'normal', fill: '#555555', textAlign: 'right', lineHeight: 1.8 },
      { type: 'textbox', text: addr, left: w - 280, top: 80, width: 250, fontSize: 9, fontFamily: 'Inter', fontWeight: 'normal', fill: '#888888', textAlign: 'right', lineHeight: 1.5 },
      { type: 'rect', left: w - 290, top: 20, width: 2, height: h - 50, fill: colors.accent },
      { type: 'rect', left: 0, top: h - 4, width: w, height: 4, fill: colors.primary },
      ...(type === 'bill_header' ? [
        { type: 'i-text', text: 'TAX INVOICE', left: w - 230, top: 24, fontSize: 22, fontFamily: 'Playfair Display', fontWeight: 'bold', fill: colors.primary, charSpacing: 300, textAlign: 'right' },
      ] : []),
    ];
  }

  if (type === 'bill_footer') {
    return [
      { type: 'rect', left: 0, top: 0, width: w, height: 2, fill: colors.primary },
      { type: 'i-text', text: 'BANK DETAILS', left: 30, top: 16, fontSize: 9, fontFamily: 'Inter', fontWeight: 'bold', fill: colors.primary, charSpacing: 200 },
      { type: 'textbox', text: 'Bank Name: ____________\nA/c No: ____________\nIFSC: ____________\nBranch: ____________', left: 30, top: 32, width: 220, fontSize: 9, fontFamily: 'Inter', fontWeight: 'normal', fill: '#555555', lineHeight: 1.8 },
      { type: 'i-text', text: 'TERMS & CONDITIONS', left: 280, top: 16, fontSize: 9, fontFamily: 'Inter', fontWeight: 'bold', fill: colors.primary, charSpacing: 200 },
      { type: 'textbox', text: '1. Payment due within 30 days\n2. Late fee: 18% p.a.\n3. Subject to local jurisdiction\n4. E & O.E.', left: 280, top: 32, width: 220, fontSize: 8, fontFamily: 'Inter', fontWeight: 'normal', fill: '#666666', lineHeight: 1.7 },
      { type: 'i-text', text: '________________________', left: w - 210, top: h - 60, fontSize: 11, fontFamily: 'Inter', fontWeight: 'normal', fill: '#aaaaaa', textAlign: 'center' },
      { type: 'i-text', text: 'Authorized Signatory', left: w - 195, top: h - 44, fontSize: 9, fontFamily: 'Inter', fontWeight: 'normal', fill: '#888888', textAlign: 'center' },
      { type: 'i-text', text: name, left: w - 210, top: h - 32, fontSize: 10, fontFamily: 'Inter', fontWeight: 'bold', fill: colors.dark, textAlign: 'center' },
      { type: 'i-text', text: 'This is a computer-generated document.', left: 30, top: h - 20, fontSize: 7, fontFamily: 'Inter', fontWeight: 'normal', fill: '#bbbbbb' },
      { type: 'rect', left: 0, top: h - 4, width: w, height: 4, fill: colors.primary },
    ];
  }

  if (type === 'letterhead_footer') {
    return [
      { type: 'rect', left: 0, top: 0, width: w, height: 2, fill: colors.primary },
      { type: 'i-text', text: `${name} | CIN: ${cin} | GSTIN: ${gstin} | ${email} | ${phone}`, left: w / 2 - 300, top: 12, fontSize: 8, fontFamily: 'Inter', fontWeight: 'normal', fill: '#999999', textAlign: 'center' },
      { type: 'i-text', text: addr, left: w / 2 - 200, top: 28, fontSize: 7, fontFamily: 'Inter', fontWeight: 'normal', fill: '#aaaaaa', textAlign: 'center' },
      { type: 'rect', left: 0, top: h - 3, width: w, height: 3, fill: colors.primary },
    ];
  }

  return [];
}

// ===== AI TEMPLATE GENERATION =====
router.post('/generate-template', asyncHandler(async (req, res) => {
  const { prompt, templateType, canvasWidth, canvasHeight, companyProfile, style } = req.body;

  if (!prompt || !prompt.trim()) {
    throw new ValidationError('Template generation validation failed', ['prompt is required']);
  }

  const cp = companyProfile || {};
  const w = canvasWidth || 794;
  const h = canvasHeight || 250;
  const type = templateType || 'letterhead';

  const systemPrompt = `You are a professional graphic design AI that generates Fabric.js canvas elements for business document templates.

CANVAS: ${w}px wide × ${h}px tall. Coordinate system: (0,0) is top-left.

COMPANY PROFILE:
- Name: ${cp.name || 'Akshay Kotish & Co.'}
- GSTIN: ${cp.gstin || '06AAWCA4919K1Z3'}
- PAN: ${cp.pan || ''}
- Address: ${cp.address || 'Haryana, India'}
- Phone: ${cp.phone || ''}
- Email: ${cp.email || 'connect@akshaykotish.com'}
- Website: ${cp.website || 'www.akshaykotish.com'}
- State: ${cp.state || 'Haryana'} (Code: ${cp.stateCode || '06'})

TEMPLATE TYPE: ${type}

DESIGN STYLE: ${style || 'professional'}

Return ONLY a valid JSON array of Fabric.js element objects.`;

  const model = genAI.getGenerativeModel({ model: GEMINI_FAST_MODEL });

  try {
    const resultPromise = withTimeout(
      model.generateContent({
        contents: [
          { role: 'user', parts: [{ text: systemPrompt + '\n\nUSER REQUEST: ' + prompt }] },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
      }),
      AI_TIMEOUT_MS
    );

    const result = await resultPromise;
    let text = result.response.text().trim();

    if (text.length > MAX_RESPONSE_SIZE) {
      throw new Error('Response size exceeded');
    }

    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let elements;
    try {
      const parsed = parseAIJson(text);
      elements = Array.isArray(parsed) ? parsed : (parsed.elements || parsed.objects || parsed.items || null);
    } catch {}

    if (!elements) {
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          elements = JSON.parse(arrayMatch[0]);
        } catch (parseErr) {
          try {
            const fixed = arrayMatch[0]
              .replace(/,\s*\]/g, ']')
              .replace(/,\s*\}/g, '}')
              .replace(/'/g, '"');
            elements = JSON.parse(fixed);
          } catch {}
        }
      }
    }

    if (!elements || !Array.isArray(elements) || elements.length === 0) {
      throw new ValidationError('Template generation failed', ['AI did not return valid elements']);
    }

    const validTypes = ['i-text', 'textbox', 'rect', 'line', 'circle'];
    const sanitized = elements.filter(el => el && validTypes.includes(el.type)).map(el => {
      if (el.left !== undefined) el.left = Number(el.left) || 0;
      if (el.top !== undefined) el.top = Number(el.top) || 0;
      if (el.width !== undefined) el.width = Number(el.width) || 100;
      if (el.height !== undefined) el.height = Number(el.height) || 40;
      if (el.fontSize !== undefined) el.fontSize = Number(el.fontSize) || 12;
      if (el.opacity !== undefined) el.opacity = Math.max(0, Math.min(1, Number(el.opacity) || 1));
      if (el.strokeWidth !== undefined) el.strokeWidth = Number(el.strokeWidth) || 0;
      if (el.radius !== undefined) el.radius = Number(el.radius) || 20;
      if (el.rx !== undefined) el.rx = Number(el.rx) || 0;
      if (el.ry !== undefined) el.ry = Number(el.ry) || 0;
      return el;
    });

    res.json({ elements: sanitized, count: sanitized.length });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'template_generation_failed',
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    throw error;
  }
}));

// ===== PRESET TEMPLATE (no AI, instant) =====
router.post('/preset-template', asyncHandler(async (req, res) => {
  const { templateType, style, canvasWidth, canvasHeight, companyProfile } = req.body;
  const w = canvasWidth || 794;
  const h = canvasHeight || 250;
  const elements = buildProfessionalTemplate(templateType || 'letterhead', style || 'professional', w, h, companyProfile || {});
  res.json({ elements, count: elements.length });
}));

// ===== AI MAIL DRAFTER =====
router.post('/draft-email', asyncHandler(async (req, res) => {
  const { prompt, to, context, tone } = req.body;

  if (!prompt?.trim()) {
    throw new ValidationError('Email draft validation failed', ['prompt is required']);
  }

  const companyName = process.env.COMPANY_NAME || 'Akshay Kotish & Co.';
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const companyEmail = process.env.COMPANY_EMAIL || 'connect@akshaykotish.com';
  const companyPhone = process.env.COMPANY_PHONE || '+91 98967 70369';
  const companyWebsite = process.env.COMPANY_WEBSITE || 'www.akshaykotish.com';

  const systemPrompt = `You are a professional email drafting assistant for "${companyName}", a chartered accountancy and business consulting firm in India.

Generate a polished, professional email with clean HTML formatting. Return ONLY valid JSON:
{
  "subject": "Clear, professional subject line",
  "body": "<Full HTML email body with inline styles>",
  "summary": "One-line description"
}

EMAIL FORMAT REQUIREMENTS:
- Use inline CSS styles for all elements (no external stylesheets)
- Wrap in: <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;color:#333;">
- Use proper greeting: "Dear [Name]," or "Dear Sir/Madam,"
- Write 2-4 well-structured paragraphs with proper spacing
- Use formal Indian business English
- Include a professional sign-off with company details:
  <div style="margin-top:28px;padding-top:16px;border-top:2px solid #1a1a1a;">
    <p style="margin:0;font-weight:700;font-size:14px;color:#1a1a1a;">Best regards,</p>
    <p style="margin:4px 0 0;font-weight:800;font-size:15px;color:#1a1a1a;">${companyName}</p>
    <p style="margin:2px 0 0;font-size:12px;color:#666;">${companyEmail} | ${companyPhone}</p>
    <p style="margin:2px 0 0;font-size:12px;color:#666;">${companyWebsite}</p>
  </div>
- Be smart: infer details from the prompt. Don't leave placeholders like [NAME] — use context clues.
- Tone: ${tone || 'professional and courteous'}`;

  try {
    const resultPromise = withTimeout(
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nDRAFT THIS EMAIL: ${prompt}` }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      }),
      AI_TIMEOUT_MS
    );

    const result = await resultPromise;
    let text = result.response.text().trim();
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = parseAIJson(text);

    res.json(parsed);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'email_draft_failed',
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    throw error;
  }
}));

// ===== AI DOCUMENT DRAFTER =====
router.post('/draft-document', asyncHandler(async (req, res) => {
  const { prompt } = req.body;

  if (!prompt?.trim()) {
    throw new ValidationError('Document draft validation failed', ['prompt is required']);
  }

  const companyName = process.env.COMPANY_NAME || 'Akshay Kotish & Co.';
  const companyLegalName = process.env.COMPANY_LEGAL_NAME || 'Akshay Lakshay Kotish Private Limited';
  const companyAddress = process.env.COMPANY_ADDRESS || 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027';
  const companyGSTIN = process.env.COMPANY_GSTIN || '06AAWCA4919K1Z3';
  const companyCIN = process.env.COMPANY_CIN || 'U72900HR2022PTC101170';
  const companyPAN = process.env.COMPANY_PAN || 'AAWCA4919K';
  const companyPhone = process.env.COMPANY_PHONE || '+91 98967 70369';
  const companyEmail = process.env.COMPANY_EMAIL || 'connect@akshaykotish.com';
  const companyWebsite = process.env.COMPANY_WEBSITE || 'www.akshaykotish.com';
  const todayFormatted = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const systemPrompt = `You are a professional document drafting assistant for "${companyName}" (${companyLegalName}), a chartered accountancy and business consulting firm in India.

COMPANY DETAILS (use in all documents):
Name: ${companyName} | Legal: ${companyLegalName}
CIN: ${companyCIN} | GSTIN: ${companyGSTIN} | PAN: ${companyPAN}
Address: ${companyAddress}
Phone: ${companyPhone} | Email: ${companyEmail} | Website: ${companyWebsite}
Today's Date: ${todayFormatted}

Generate a professional, complete document with proper HTML formatting. Return ONLY valid JSON:
{
  "title": "Document title",
  "type": "Letter|Agreement|Notice|General",
  "content": "<Full HTML content of the document>",
  "summary": "One-line description"
}

DOCUMENT FORMAT REQUIREMENTS:
- Write COMPLETE documents, not outlines. Include full paragraphs, clauses, terms as applicable.
- Use clean HTML with inline styles for professional rendering.
- For LETTERS: Include today's date (${todayFormatted}) at the top right, reference number (Ref: AK&Co/[TYPE]/${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}/001), addressee, subject line, salutation, 3-5 body paragraphs, closing, and signature block.
- For AGREEMENTS: Include parties, recitals, numbered clauses, terms & conditions, signatures section.
- For NOTICES: Include date, reference, addressee, subject, notice body with legal references.
- Use formal Indian business English with proper legal terminology where appropriate.
- Reference relevant Indian laws/sections (IT Act, GST Act, Companies Act 2013, etc.) when applicable.
- Format content with proper headings: <h2>, <h3> tags with styles.
- Paragraphs: <p style="margin-bottom:12px;font-size:14px;line-height:1.8;color:#1a1a1a;">
- Include signature block at the bottom:
  <div style="margin-top:40px;">
    <p style="margin:0;font-weight:700;">For ${companyName}</p>
    <p style="margin:40px 0 4px;font-weight:700;">________________________</p>
    <p style="margin:0;font-weight:600;">Authorized Signatory</p>
  </div>
- Be SMART: infer all details from the prompt. Never leave [PLACEHOLDER] text — use reasonable defaults.`;

  try {
    const resultPromise = withTimeout(
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nDRAFT THIS DOCUMENT: ${prompt}` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
      }),
      AI_TIMEOUT_MS
    );

    const result = await resultPromise;
    let text = result.response.text().trim();
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = parseAIJson(text);

    res.json(parsed);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'document_draft_failed',
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    throw error;
  }
}));

// ===== AI LEDGER CONTROLLER =====
router.post('/ledger-assistant', asyncHandler(async (req, res) => {
  const { prompt, action } = req.body;

  if (!prompt?.trim()) {
    throw new ValidationError('Ledger assistant validation failed', ['prompt is required']);
  }

  let accounts = [], recentEntries = [];
  try {
    const accSnap = await db.collection('accounts').orderBy('code').get();
    accounts = accSnap.docs.map(d => ({ id: d.id, code: d.data().code, name: d.data().name, type: d.data().type, balance: d.data().balance || 0 }));
  } catch {}
  try {
    const jeSnap = await db.collection('journal_entries').orderBy('date', 'desc').limit(20).get();
    recentEntries = jeSnap.docs.map(d => ({ id: d.id, entryNumber: d.data().entryNumber, date: d.data().date, description: d.data().description }));
  } catch {
    try {
      const jeSnap = await db.collection('journal_entries').get();
      recentEntries = jeSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20);
    } catch {}
  }

  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const systemPrompt = `You are an expert accounting assistant for "${process.env.COMPANY_NAME || 'Akshay Kotish & Co.'}".

CHART OF ACCOUNTS: ${JSON.stringify(accounts)}
RECENT ENTRIES: ${JSON.stringify(recentEntries)}

Return ONLY valid JSON with action, data, and message fields.`;

  try {
    const resultPromise = withTimeout(
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nUSER REQUEST: ${prompt}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
      AI_TIMEOUT_MS
    );

    const result = await resultPromise;
    let text = result.response.text().trim();
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = parseAIJson(text);

    res.json(parsed);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'ledger_assistant_failed',
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    throw error;
  }
}));

export default router;
