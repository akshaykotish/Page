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

  const systemPrompt = `You are a professional legal document drafter for "${companyName}". Generate ONLY the document BODY as clean, minimal HTML. The letterhead header and footer are rendered separately — NEVER include them.

Document type: ${docType}
User request: "${prompt}"

COMPANY DATA:
- Company: ${companyName}
- Address: ${company.address || ''}
- GSTIN: ${company.gstin || ''} | CIN: ${company.cin || ''} | PAN: ${company.pan || ''}
- Date: ${meta.dateFormatted}
- Ref: ${meta.refNumber}
${urlContext}

HTML STRUCTURE — wrap everything in ONE outer div with shared styles:
<div style="font-family:'Poppins',Arial,sans-serif;font-size:11px;color:#1a1a1a;line-height:1.7;">
  <!-- date right-aligned -->
  <!-- ref number -->
  <!-- recipient block -->
  <!-- subject (bold, underlined, 12px) -->
  <!-- salutation -->
  <!-- body content with numbered clauses using <ol> -->
  <!-- closing + signature -->
</div>

CRITICAL RULES:
1. ONE outer <div> with font-family, font-size, color, line-height. Inner elements inherit — do NOT repeat styles on every <p>.
2. Use <p style="margin-bottom:8px;"> for paragraphs. Only add extra styles when different from parent (bold, alignment, size).
3. Use <ol> and <li> for numbered clauses — NOT manually numbered paragraphs.
4. NEVER use [bracket placeholders] like [Name] or [Date]. Use realistic sample data based on the user's prompt. If a name is mentioned, use it. If not, use "Mr. Sharma" or similar. Fill ALL fields with realistic values.
5. Use the EXACT date "${meta.dateFormatted}" and ref "${meta.refNumber}".
6. If the user mentions a website, use the WEBSITE CONTEXT above for real company details.
7. Keep signature block compact: "For ${companyName}" + "Authorized Signatory" on separate lines.
8. NO company header/letterhead/logo. NO footer. The body starts with date and ends with signature.
9. For agreements/NDAs: full legal clauses with definitions, obligations, term, termination, jurisdiction, governing law. Generate ALL sections completely.
10. Output ONLY HTML. No markdown, no backticks, no explanation.`;

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
