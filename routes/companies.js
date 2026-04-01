import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from '../firebase-admin.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';

const router = express.Router();

let _genAI;
function getGenAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}
router.use(verifyToken);

// ─── Default Header/Footer Templates ────────────────────────────────────────

function defaultDocHeader(c) {
  // Only show fields that have actual data — empty fields are omitted
  const name = (c.name || 'Company Name').toUpperCase();
  const legalLine = c.legalLine || (c.legalName ? `A Brand of ${c.legalName}` : '');
  const tagline = c.tagline || '';
  const statutory = [c.gstin ? `GSTIN: ${c.gstin}` : '', c.cin ? `CIN: ${c.cin}` : '', c.pan ? `PAN: ${c.pan}` : ''].filter(Boolean).join(' | ');
  const contactLines = [c.email, c.phone].filter(Boolean);
  const website = c.website || '';
  const address = c.address || '';

  return `<table style="width:100%;border-collapse:collapse;font-family:'Poppins',Arial,Helvetica,sans-serif;">
<tr>
<td style="vertical-align:top;padding:0 0 10px 0;border:none;width:62%;">
<div style="font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;line-height:1.15;margin-bottom:2px;">${name}</div>
${legalLine ? `<div style="font-size:9px;color:#64748b;margin-bottom:2px;font-weight:400;">${legalLine}</div>` : ''}
${tagline ? `<div style="font-size:10px;color:#2e7d32;font-weight:600;margin-bottom:4px;letter-spacing:0.2px;">${tagline}</div>` : ''}
${statutory ? `<div style="font-size:7.5px;color:#94a3b8;line-height:1.6;font-weight:400;">${statutory}</div>` : ''}
</td>
<td style="vertical-align:top;text-align:right;padding:0 0 10px 0;border:none;white-space:nowrap;">
<div style="font-size:9px;color:#475569;line-height:2;font-weight:400;">
${contactLines.join('<br>')}${website ? `<br><span style="color:#2e7d32;font-weight:600;font-size:10px;">${website}</span>` : ''}
</div>
</td>
</tr>
</table>
<div style="height:2.5px;background:linear-gradient(90deg,#2e7d32,#1b5e20);margin-bottom:0;"></div>
${address ? `<div style="font-size:7.5px;color:#64748b;padding:4px 0 0;font-family:'Poppins',Arial,sans-serif;font-weight:400;">${address}</div>` : ''}`;
}

function defaultDocFooter(c) {
  const name = c.name || 'Company Name';
  const legalLine = c.legalLine || (c.legalName ? `A Brand of ${c.legalName}` : '');
  const regLine = [c.cin ? `CIN: ${c.cin}` : '', c.gstin ? `GSTIN: ${c.gstin}` : ''].filter(Boolean).join(' | ');
  const contactParts = [c.email, c.phone, c.website, c.address].filter(Boolean);

  return `<div style="height:1.5px;background:linear-gradient(90deg,#2e7d32,#1b5e20);margin-bottom:5px;"></div>
<table style="width:100%;border-collapse:collapse;font-family:'Poppins',Arial,Helvetica,sans-serif;">
<tr><td style="text-align:center;padding:0;border:none;">
<div style="font-size:7px;color:#64748b;line-height:1.6;">
<strong style="color:#1a1a1a;">${name}</strong>${legalLine ? ` (${legalLine})` : ''}${regLine ? ` | ${regLine}` : ''}
</div>
${contactParts.length ? `<div style="font-size:6.5px;color:#94a3b8;margin-top:1px;">${contactParts.join(' &bull; ')}</div>` : ''}
</td></tr></table>`;
}

function defaultInvHeader(c) {
  const name = (c.name || 'Company Name').toUpperCase();
  const legalLine = c.legalLine || (c.legalName ? `A Brand of ${c.legalName}` : '');
  const tagline = c.tagline || '';
  const statutory = [c.gstin ? `GSTIN: ${c.gstin}` : '', c.cin ? `CIN: ${c.cin}` : '', c.pan ? `PAN: ${c.pan}` : ''].filter(Boolean).join(' | ');
  const contactLines = [c.email, c.phone].filter(Boolean);
  const website = c.website || '';
  const address = c.address || '';

  return `<table style="width:100%;border-collapse:collapse;font-family:'Poppins',Arial,Helvetica,sans-serif;">
<tr>
<td style="vertical-align:top;padding:0 0 10px 0;border:none;width:55%;">
<div style="font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;line-height:1.15;margin-bottom:2px;">${name}</div>
${legalLine ? `<div style="font-size:9px;color:#64748b;margin-bottom:2px;font-weight:400;">${legalLine}</div>` : ''}
${tagline ? `<div style="font-size:10px;color:#2e7d32;font-weight:600;margin-bottom:4px;letter-spacing:0.2px;">${tagline}</div>` : ''}
${statutory ? `<div style="font-size:7.5px;color:#94a3b8;line-height:1.6;font-weight:400;">${statutory}</div>` : ''}
</td>
<td style="vertical-align:top;text-align:right;padding:0 0 10px 0;border:none;">
<div style="font-size:26px;font-weight:800;color:#2e7d32;letter-spacing:-0.5px;margin-bottom:4px;">TAX INVOICE</div>
<div style="font-size:9px;color:#475569;line-height:2;font-weight:400;">
${contactLines.join('<br>')}${website ? `<br><span style="color:#2e7d32;font-weight:600;font-size:10px;">${website}</span>` : ''}
</div>
</td>
</tr>
</table>
<div style="height:2.5px;background:linear-gradient(90deg,#2e7d32,#1b5e20);margin-bottom:0;"></div>
${address ? `<div style="font-size:7.5px;color:#64748b;padding:4px 0 0;font-family:'Poppins',Arial,sans-serif;font-weight:400;">${address}</div>` : ''}`;
}

// ─── LIST companies ──────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const snap = await db.collection('companies').orderBy('createdAt', 'desc').get();
  const companies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(companies);
}));

// ─── GET single company ──────────────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('companies').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Company not found' });
  res.json({ id: doc.id, ...doc.data() });
}));

// ─── CREATE company (superadmin only) ────────────────────────────────────────

router.post('/', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const { name, legalName, legalLine, tagline, gstin, cin, pan, address, phone, email, website, state, stateCode } = req.body;
  if (!name?.trim()) throw new ValidationError('Company validation failed', ['name is required']);

  const profile = {
    name: name.trim(),
    legalName: legalName?.trim() || '',
    legalLine: legalLine?.trim() || '',
    tagline: tagline?.trim() || '',
    gstin: gstin?.trim() || '',
    cin: cin?.trim() || '',
    pan: pan?.trim() || '',
    address: address?.trim() || '',
    phone: phone?.trim() || '',
    email: email?.trim() || '',
    website: website?.trim() || '',
    state: state?.trim() || '',
    stateCode: stateCode?.trim() || '',
    createdAt: new Date().toISOString(),
    createdBy: req.user.uid,
  };

  // Generate default templates based on profile
  profile.templates = {
    doc_header: defaultDocHeader(profile),
    doc_footer: defaultDocFooter(profile),
    inv_header: defaultInvHeader(profile),
    inv_footer: defaultDocFooter(profile),
  };

  const ref = await db.collection('companies').add(profile);
  res.status(201).json({ id: ref.id, ...profile });
}));

// ─── UPDATE company profile ──────────────────────────────────────────────────

router.put('/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const docRef = db.collection('companies').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) return res.status(404).json({ error: 'Company not found' });

  const allowed = ['name', 'legalName', 'legalLine', 'tagline', 'gstin', 'cin', 'pan', 'address', 'phone', 'email', 'website', 'state', 'stateCode',
    'canvasJson_doc_header', 'canvasJson_doc_footer', 'canvasJson_inv_header', 'canvasJson_inv_footer'];
  const updates = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
  }

  await docRef.update(updates);
  const updated = (await docRef.get()).data();
  res.json({ id: req.params.id, ...updated });
}));

// ─── DELETE company (superadmin only) ────────────────────────────────────────

router.delete('/:id', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const docRef = db.collection('companies').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) return res.status(404).json({ error: 'Company not found' });
  await docRef.delete();
  res.json({ message: 'Company deleted' });
}));

// ─── GET company templates ───────────────────────────────────────────────────

router.get('/:id/templates', asyncHandler(async (req, res) => {
  const doc = await db.collection('companies').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Company not found' });
  const data = doc.data();
  const profile = data;
  const saved = data.templates || {};
  res.json({
    doc_header: saved.doc_header || defaultDocHeader(profile),
    doc_footer: saved.doc_footer || defaultDocFooter(profile),
    inv_header: saved.inv_header || defaultInvHeader(profile),
    inv_footer: saved.inv_footer || defaultDocFooter(profile),
  });
}));

// ─── UPDATE single template ──────────────────────────────────────────────────

router.put('/:id/templates/:key', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const { key } = req.params;
  const validKeys = ['doc_header', 'doc_footer', 'inv_header', 'inv_footer'];
  if (!validKeys.includes(key)) return res.status(400).json({ error: 'Invalid template key' });

  const { html } = req.body;
  if (typeof html !== 'string') return res.status(400).json({ error: 'html must be a string' });

  const docRef = db.collection('companies').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) return res.status(404).json({ error: 'Company not found' });

  await docRef.update({ [`templates.${key}`]: html, updatedAt: new Date().toISOString() });
  res.json({ key, html, message: 'Template saved' });
}));

// ─── RESET template to default ───────────────────────────────────────────────

router.post('/:id/templates/:key/reset', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const { key } = req.params;
  const validKeys = ['doc_header', 'doc_footer', 'inv_header', 'inv_footer'];
  if (!validKeys.includes(key)) return res.status(400).json({ error: 'Invalid template key' });

  const docRef = db.collection('companies').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) return res.status(404).json({ error: 'Company not found' });

  const profile = doc.data();
  const defaults = { doc_header: defaultDocHeader(profile), doc_footer: defaultDocFooter(profile), inv_header: defaultInvHeader(profile), inv_footer: defaultDocFooter(profile) };
  const html = defaults[key];

  await docRef.update({ [`templates.${key}`]: html, updatedAt: new Date().toISOString() });
  res.json({ key, html, message: 'Template reset' });
}));

// ─── REGENERATE all templates from profile ───────────────────────────────────

router.post('/:id/templates/regenerate', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const docRef = db.collection('companies').doc(req.params.id);
  const doc = await docRef.get();
  if (!doc.exists) return res.status(404).json({ error: 'Company not found' });

  const profile = doc.data();
  const templates = {
    doc_header: defaultDocHeader(profile),
    doc_footer: defaultDocFooter(profile),
    inv_header: defaultInvHeader(profile),
    inv_footer: defaultDocFooter(profile),
  };

  await docRef.update({ templates, updatedAt: new Date().toISOString() });
  res.json(templates);
}));

// ─── AI Generate header/footer HTML ──────────────────────────────────────────

router.post('/:id/templates/ai-generate', verifyToken, asyncHandler(async (req, res) => {
  const { templateKey, prompt } = req.body;
  console.log('[AI-GENERATE] Request received:', { companyId: req.params.id, templateKey, prompt: prompt?.substring(0, 100) });

  if (!prompt?.trim()) throw new ValidationError('Prompt required', ['prompt is required']);
  const validKeys = ['doc_header', 'doc_footer', 'inv_header', 'inv_footer'];
  if (!validKeys.includes(templateKey)) {
    console.log('[AI-GENERATE] Invalid template key:', templateKey);
    throw new ValidationError('Invalid template key');
  }

  const doc = await db.collection('companies').doc(req.params.id).get();
  if (!doc.exists) {
    console.log('[AI-GENERATE] Company not found:', req.params.id);
    return res.status(404).json({ error: 'Company not found' });
  }
  const c = doc.data();
  console.log('[AI-GENERATE] Company loaded:', c.name);

  const isHdr = templateKey.includes('header');
  const isInv = templateKey.includes('inv');

  // Page dimensions — the header/footer renders inside a container that is
  // 595px wide (A4 at 72dpi) with 28px padding on each side = 539px usable.
  const PAGE_W = 539; // usable width in pixels inside the A4 preview
  const HDR_H = 120;  // max header height
  const FTR_H = 50;   // max footer height

  const companyName = (c.name || 'Company').toUpperCase();
  const legalLine = c.legalLine || 'A Brand of ' + (c.legalName || c.name);
  const tagline = c.tagline || '';
  const statutory = [c.gstin ? `GSTIN: ${c.gstin}` : '', c.cin ? `CIN: ${c.cin}` : '', c.pan ? `PAN: ${c.pan}` : ''].filter(Boolean).join(' &bull; ');
  const email = c.email || '';
  const phone = c.phone || '';
  const website = c.website || '';
  const address = c.address || '';

  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  console.log('[AI-GENERATE] Using model:', geminiModel, '| isHeader:', isHdr, '| isInvoice:', isInv);

  // For headers: provide the EXACT template with the user's style preference applied
  const model = getGenAI().getGenerativeModel({ model: geminiModel });

  let systemPrompt;
  if (isHdr) {
    systemPrompt = `You design letterhead HEADERS for printed A4 documents. NOT document content — ONLY the top banner/header strip.

User wants this style: "${prompt}"

Take this BASE HTML and MODIFY it according to the user's style preference. Change colors, fonts, layout, spacing — but keep ALL company data and the same structural approach (table-based, inline CSS, width:100%, NO max-width).

BASE HTML:
<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-family:'Poppins',Arial,sans-serif;">
<tr>
<td style="width:60%;border:none;padding:0 0 10px 0;vertical-align:top;">
<div style="font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;line-height:1.2;margin-bottom:2px;">${companyName}</div>
<div style="font-size:9px;color:#64748b;margin-bottom:3px;">${legalLine}</div>
${tagline ? `<div style="font-size:10px;color:#2e7d32;font-weight:600;margin-bottom:6px;">${tagline}</div>` : ''}
<div style="font-size:8px;color:#94a3b8;line-height:1.6;">${statutory}</div>
</td>
<td style="width:40%;border:none;padding:0 0 10px 0;vertical-align:top;text-align:right;">
<div style="font-size:9px;color:#475569;line-height:2.2;">${email}<br>${phone}<br><span style="color:#2e7d32;font-weight:600;font-size:10px;">${website}</span></div>
</td>
</tr>
</table>
<div style="width:100%;height:3px;background:#2e7d32;margin-bottom:0;"></div>
<div style="font-size:8px;color:#64748b;padding:4px 0 0;font-family:'Poppins',Arial,sans-serif;">${address}</div>

${isInv ? 'ALSO: Replace the contact column with "TAX INVOICE" (24px bold #2e7d32) at top, then contact details below it.' : ''}

RULES:
- Output the COMPLETE modified HTML — every opening tag must have a closing tag. Do NOT output partial/truncated HTML.
- Keep it as a HEADER STRIP only — never generate body content, paragraphs, service descriptions, or document text.
- Max height: ${HDR_H}px. Must be compact.
- All inline CSS. No classes. No <style> blocks.
- NO background-color on the table or outer container — the page background is white.
- Text must be clearly visible: use dark colors (#1a1a1a, #333, #475569) for text, not light gray.
- Use the exact company data provided — don't change names/numbers.
- The output must be a complete, self-contained HTML snippet ready to render.`;
  } else {
    systemPrompt = `You design letterhead FOOTERS for printed A4 documents. ONLY a 1-2 line footer strip.

User wants this style: "${prompt}"

Take this BASE HTML and MODIFY it according to the user's style preference:

BASE HTML:
<div style="width:100%;font-family:'Poppins',Arial,sans-serif;">
<div style="width:100%;height:2px;background:#2e7d32;margin-bottom:4px;"></div>
<div style="text-align:center;font-size:7px;color:#64748b;line-height:1.5;">
<strong style="color:#1a1a1a;">${c.name || ''}</strong> (${legalLine}) | ${statutory}<br>
${[email, phone, website, address].filter(Boolean).join(' &bull; ')}
</div>
</div>

RULES:
- Output the COMPLETE modified HTML — every opening tag must have a closing tag. Do NOT output partial/truncated HTML.
- Max 2 lines. Max height: ${FTR_H}px. Very compact.
- All inline CSS. No classes. No background-color on outer container.
- NEVER generate body content or paragraphs.
- The output must be a complete, self-contained HTML snippet ready to render.`;
  }

  console.log('[AI-GENERATE] System prompt length:', systemPrompt.length, 'chars');

  async function callGemini(attempt) {
    console.log(`[AI-GENERATE] Calling Gemini API (attempt ${attempt})...`);
    const startTime = Date.now();
    let result;
    try {
      result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: attempt > 1 ? 0.5 : 0.2, maxOutputTokens: 4096 },
      });
      console.log('[AI-GENERATE] Gemini responded in', Date.now() - startTime, 'ms');
    } catch (aiErr) {
      console.error('[AI-GENERATE] Gemini API error:', aiErr.message);
      throw aiErr;
    }

    const rawText = result.response.text();
    console.log('[AI-GENERATE] Raw response length:', rawText.length, 'chars');
    console.log('[AI-GENERATE] Raw response preview:', rawText.substring(0, 300));

    let html = rawText.trim();
    html = html.replace(/```html?\s*/gi, '').replace(/```\s*/g, '').trim();
    html = html.replace(/max-width:\s*\d+px;?/gi, '');
    // Remove background-color from the outermost table/div element
    html = html.replace(/^(<(?:table|div)[^>]*?)background-color:\s*[^;"]+;?/i, '$1');
    html = html.replace(/^(<(?:table|div)[^>]*?)background:\s*#[a-fA-F0-9]{3,8};?/i, '$1');

    // Safety: truncate overly long responses
    if (html.length > 3000) {
      const cutoff = html.indexOf('</table>');
      if (cutoff > 0) html = html.substring(0, cutoff + 8);
    }

    // Validate completeness
    const hasClosingTag = html.includes('</table>') || html.includes('</div>');
    const textContent = html.replace(/<[^>]*>/g, '').trim();
    console.log('[AI-GENERATE] Validation: hasClosingTag:', hasClosingTag, '| textLen:', textContent.length, '| htmlLen:', html.length);

    return { html, valid: hasClosingTag && textContent.length > 10 };
  }

  // Try up to 2 times — second attempt uses higher temperature
  let html;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callGemini(attempt);
    if (result.valid) {
      html = result.html;
      break;
    }
    console.log(`[AI-GENERATE] Attempt ${attempt} invalid, ${attempt < 2 ? 'retrying...' : 'giving up'}`);
  }

  if (!html) {
    console.log('[AI-GENERATE] REJECTED after 2 attempts');
    return res.status(422).json({ error: 'AI failed to generate valid HTML. Try a more descriptive prompt like "professional green accent header" or "clean modern blue theme".' });
  }

  console.log('[AI-GENERATE] Final HTML preview:', html.substring(0, 300));
  res.json({ html });
}));

export default router;
