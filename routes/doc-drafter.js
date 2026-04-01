import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';

const router = express.Router();

let _genAI;
function getGenAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

router.use(verifyToken);

// ─── Helper: load company profile + templates ────────────────────────────────

async function loadCompany(companyId) {
  const doc = await db.collection('companies').doc(companyId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// ─── Helper: extract URLs from prompt and fetch their content ────────────────

const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;

async function fetchUrlContent(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocDrafter/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const description = descMatch ? descMatch[1].trim() : '';
    // Extract visible text from body (strip tags, limit to 2000 chars)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    let bodyText = '';
    if (bodyMatch) {
      bodyText = bodyMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 2000);
    }
    return { url, title, description, bodyText };
  } catch (err) {
    console.log('[DOC-DRAFTER] Failed to fetch URL:', url, err.message);
    return null;
  }
}

async function extractUrlContext(prompt) {
  const urls = prompt.match(URL_REGEX);
  if (!urls || urls.length === 0) return '';

  const results = await Promise.all(urls.slice(0, 3).map(u => fetchUrlContent(u)));
  const valid = results.filter(Boolean);
  if (valid.length === 0) return '';

  return '\n\nWEBSITE CONTEXT (fetched from URLs mentioned in the prompt):\n' +
    valid.map(r =>
      `--- ${r.url} ---\nTitle: ${r.title}\nDescription: ${r.description}\nContent: ${r.bodyText.substring(0, 1500)}\n---`
    ).join('\n');
}

// ─── Helper: generate serial/ref/date context ───────────────────────────────

function getDocumentMeta(company, docType) {
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateShort = now.toISOString().split('T')[0].replace(/-/g, '');
  const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Company abbreviation: first letters of each word
  const abbr = (company.name || 'CO')
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .substring(0, 4);

  // Type codes
  const typeCodes = {
    letter: 'LTR', agreement: 'AGR', notice: 'NTC', certificate: 'CRT', general: 'GEN',
  };
  const typeCode = typeCodes[docType] || 'DOC';

  // Serial: 3-digit number based on date seed
  const serial = String(((now.getDate() * 7 + now.getHours() * 3) % 900) + 100);

  const refNumber = `${abbr}/${typeCode}/${monthYear}/${serial}`;

  return { dateFormatted, refNumber, abbr, typeCode, serial };
}

// ─── POST /:companyId/draft — AI-generate document body ─────────────────────

router.post('/:companyId/draft', asyncHandler(async (req, res) => {
  const { prompt, type } = req.body;
  if (!prompt?.trim()) throw new ValidationError('Prompt is required', ['prompt is required']);

  const validTypes = ['letter', 'agreement', 'notice', 'certificate', 'general'];
  const docType = validTypes.includes(type) ? type : 'general';

  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const companyName = company.name || 'Company';
  const meta = getDocumentMeta(company, docType);

  // Fetch website content if URLs are in the prompt
  const urlContext = await extractUrlContext(prompt);
  if (urlContext) console.log('[DOC-DRAFTER] URL context fetched, length:', urlContext.length);

  const model = getGenAI().getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });

  const systemPrompt = `You are a senior legal document drafter at "${companyName}", an Indian professional services firm. Generate ONLY the document BODY as clean, minimal HTML.

Document type: ${docType}
User request: "${prompt}"

METADATA (use exactly):
- Date: ${meta.dateFormatted}
- Ref: ${meta.refNumber}
- Company: ${companyName}
- Address: ${company.address || ''}
- GSTIN: ${company.gstin || ''} | PAN: ${company.pan || ''} | CIN: ${company.cin || ''}
${urlContext}

CRITICAL HTML RULES:
1. Wrap EVERYTHING in a single <div style="font-family:'Poppins',Arial,sans-serif;font-size:11px;line-height:1.7;color:#1a1a1a;">
2. Do NOT repeat font-family or font-size on every element. Child elements inherit from the wrapper.
3. Use <p style="margin:0 0 8px"> for paragraphs. Keep margins tight (6-10px).
4. For numbered clauses use <ol style="margin:0 0 8px;padding-left:20px"> with <li style="margin:0 0 6px">.
5. Combine related lines into single elements. Address block = one <p> with <br> between lines.
6. Subject line: <p style="font-size:12px;font-weight:700;text-decoration:underline;margin:14px 0 10px">
7. Section headings inside body: just use <strong> inside <p>, not separate elements.
8. Signature block: use a single <div style="margin-top:30px"> containing all sign-off lines.

CONTENT RULES:
- Use the EXACT date and ref number above.
- If the user mentions specific names, designations, salaries — use them. If not specified, use the actual details naturally (e.g. "Dear Mr. Sharma," if name is in prompt). Do NOT use ugly bracket placeholders like [Candidate Name] or [Salary].
- If some details aren't provided, write the document with realistic placeholder text that reads naturally (e.g. "your designated position" instead of "[Job Title]").
- Write in proper Indian legal/business English. Formal but readable.
- For agreements/NDAs: proper legal clauses using <ol> numbered lists, definitions, obligations, term, governing law (Indian jurisdiction).
- For letters: compact business letter format. Address block on one <p> with <br> line breaks.
- NEVER include company header/letterhead/logo — rendered separately.
- NEVER include a page footer — rendered separately.
- NEVER use [square bracket placeholders]. Fill details from the prompt or write naturally without them.
- For long documents, generate ALL sections completely. Do NOT truncate.
- No markdown, no backticks, no explanation — ONLY the HTML.

EXAMPLE of good output structure:
<div style="font-family:'Poppins',Arial,sans-serif;font-size:11px;line-height:1.7;color:#1a1a1a;">
<p style="text-align:right;margin:0 0 6px">${meta.dateFormatted}</p>
<p style="margin:0 0 10px">Ref: ${meta.refNumber}</p>
<p style="margin:0 0 10px">To,<br>The Manager<br>ABC Company<br>New Delhi</p>
<p style="font-size:12px;font-weight:700;text-decoration:underline;margin:14px 0 10px">Subject: ...</p>
<p style="margin:0 0 8px">Dear Sir/Madam,</p>
<p style="margin:0 0 8px">Body text...</p>
<ol style="margin:0 0 8px;padding-left:20px">
<li style="margin:0 0 6px"><strong>Clause Title:</strong> Clause text...</li>
</ol>
<div style="margin-top:30px">
<p style="margin:0 0 4px">Yours faithfully,</p>
<p style="margin:40px 0 4px"><strong>For ${companyName}</strong></p>
<p style="margin:0">Authorized Signatory</p>
</div>
</div>`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
  });

  let content = result.response.text().trim();
  content = content.replace(/```html?\s*/gi, '').replace(/```\s*/g, '').trim();

  const subjectMatch = content.match(/(?:subject|re|sub)\s*[:—–-]\s*([^<\n]+)/i);
  const title = subjectMatch ? subjectMatch[1].trim() : `${docType.charAt(0).toUpperCase() + docType.slice(1)} Document`;

  res.json({
    title,
    content,
    type: docType,
    companyId: req.params.companyId,
  });
}));

// ─── POST /:companyId/edit-section — AI-edit a specific section ──────────────

router.post('/:companyId/edit-section', asyncHandler(async (req, res) => {
  const { sectionHtml, prompt, fullDocumentHtml } = req.body;
  if (!sectionHtml?.trim()) throw new ValidationError('sectionHtml is required');
  if (!prompt?.trim()) throw new ValidationError('prompt is required');

  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const companyName = company.name || 'Company';
  const urlContext = await extractUrlContext(prompt);

  const model = getGenAI().getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });

  const systemPrompt = `You are editing a specific section of a legal document for "${companyName}".

The user selected this HTML section from the document:
<SELECTED>
${sectionHtml}
</SELECTED>

${fullDocumentHtml ? `Full document context (for reference only — do NOT regenerate the whole document):\n${fullDocumentHtml.substring(0, 3000)}\n` : ''}

User's edit instruction: "${prompt}"
${urlContext}

RULES:
- Output ONLY the replacement HTML for the selected section. Nothing else.
- Keep the same inline styling approach (font-family: 'Poppins', inline CSS).
- Apply the user's instruction to modify the selected section.
- Maintain the same formatting style as the original.
- No markdown, no backticks, no explanation — just the HTML.
- If the user wants to add content, expand the section. If they want to change tone/wording, rewrite it.
- Keep font-size consistent with the original (11px body, 12px headings).`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  });

  let html = result.response.text().trim();
  html = html.replace(/```html?\s*/gi, '').replace(/```\s*/g, '').trim();

  res.json({ html });
}));

// ─── POST /:companyId/render — combine header + body + footer ───────────────

router.post('/:companyId/render', asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') throw new ValidationError('content must be a string', ['content is required']);

  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const templates = company.templates || {};
  const header = templates.doc_header || '';
  const footer = templates.doc_footer || '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Document</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap');
@page {
  size: A4;
  margin: 0;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Poppins', Arial, sans-serif;
  font-size: 11px;
  color: #1a1a1a;
  line-height: 1.6;
  background: #fff;
}
.page {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 20mm 15mm 20mm 15mm;
  position: relative;
  display: flex;
  flex-direction: column;
}
.header { flex-shrink: 0; margin-bottom: 18px; }
.body-content { flex: 1; padding: 10px 0; }
.footer { flex-shrink: 0; margin-top: auto; padding-top: 12px; }
@media print {
  body { background: none; }
  .page { width: 100%; min-height: auto; margin: 0; }
}
</style>
</head>
<body>
<div class="page">
  <div class="header">${header}</div>
  <div class="body-content">${content}</div>
  <div class="footer">${footer}</div>
</div>
</body>
</html>`;

  res.json({ html });
}));

// ─── GET /:companyId/templates — return header/footer for client-side use ───

router.get('/:companyId/templates', asyncHandler(async (req, res) => {
  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const templates = company.templates || {};
  res.json({
    doc_header: templates.doc_header || '',
    doc_footer: templates.doc_footer || '',
  });
}));

export default router;
