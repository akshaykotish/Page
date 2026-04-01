import express from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';
import crypto from 'crypto';

const router = express.Router();

// Debug: log every request hitting this router
router.use((req, res, next) => {
  console.log('[STAMPS-SIG] Incoming:', req.method, req.originalUrl, req.path);
  next();
});

router.use(verifyToken);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadCompany(id) {
  const doc = await db.collection('companies').doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

function uid() { return crypto.randomUUID(); }

// ─── PRE-MADE STAMP SVG GENERATORS ──────────────────────────────────────────

function generateRoundSeal(company, color = '#1a3a6b') {
  const name = (company.name || 'COMPANY').toUpperCase();
  const sub = company.cin ? `CIN: ${company.cin}` : (company.pan ? `PAN: ${company.pan}` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
<circle cx="100" cy="100" r="94" fill="none" stroke="${color}" stroke-width="3" opacity="0.85"/>
<circle cx="100" cy="100" r="86" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.85"/>
<circle cx="100" cy="100" r="42" fill="none" stroke="${color}" stroke-width="1" opacity="0.4"/>
<defs>
<path id="ts" d="M 30,100 A 70,70 0 0,1 170,100"/>
<path id="bs" d="M 170,100 A 70,70 0 0,1 30,100"/>
</defs>
<text fill="${color}" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="11" letter-spacing="2" opacity="0.85">
<textPath href="#ts" startOffset="50%" text-anchor="middle">${name.length > 24 ? name.substring(0, 24) : name}</textPath>
</text>
<text fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="8" letter-spacing="1.5" opacity="0.85">
<textPath href="#bs" startOffset="50%" text-anchor="middle">AUTHORIZED SIGNATORY</textPath>
</text>
<text x="100" y="98" text-anchor="middle" font-size="24" fill="${color}" opacity="0.75">&#9733;</text>
${sub ? `<text x="100" y="115" text-anchor="middle" font-size="6" fill="${color}" font-family="Arial,sans-serif" opacity="0.6">${sub}</text>` : ''}
</svg>`;
}

function generateCommonSeal(company, color = '#1a3a6b') {
  const name = (company.name || 'COMPANY').toUpperCase();
  const legal = (company.legalName || company.name || '').toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
<circle cx="100" cy="100" r="94" fill="none" stroke="${color}" stroke-width="4" opacity="0.85"/>
<circle cx="100" cy="100" r="88" fill="none" stroke="${color}" stroke-width="1" opacity="0.6"/>
<circle cx="100" cy="100" r="50" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"/>
<defs>
<path id="tcs" d="M 28,100 A 72,72 0 0,1 172,100"/>
<path id="bcs" d="M 172,100 A 72,72 0 0,1 28,100"/>
</defs>
<text fill="${color}" font-family="'Times New Roman',serif" font-weight="bold" font-size="11" letter-spacing="2" opacity="0.85">
<textPath href="#tcs" startOffset="50%" text-anchor="middle">${name.length > 24 ? name.substring(0, 24) : name}</textPath>
</text>
<text fill="${color}" font-family="'Times New Roman',serif" font-size="8" letter-spacing="1" opacity="0.85">
<textPath href="#bcs" startOffset="50%" text-anchor="middle">COMMON SEAL</textPath>
</text>
<text x="100" y="95" text-anchor="middle" font-size="8" font-weight="bold" fill="${color}" font-family="'Times New Roman',serif" opacity="0.7">${legal.length > 18 ? legal.substring(0, 18) : legal}</text>
<text x="100" y="110" text-anchor="middle" font-size="7" fill="${color}" font-family="'Times New Roman',serif" opacity="0.6">PVT. LTD.</text>
</svg>`;
}

function generateRectStamp(text, color = '#c0392b') {
  const len = text.length;
  const w = Math.max(180, len * 14 + 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="70" viewBox="0 0 ${w} 70">
<rect x="3" y="3" width="${w - 6}" height="64" fill="none" stroke="${color}" stroke-width="4" rx="4" opacity="0.85"/>
<rect x="8" y="8" width="${w - 16}" height="54" fill="none" stroke="${color}" stroke-width="1.5" rx="2" opacity="0.6"/>
<text x="${w / 2}" y="44" text-anchor="middle" font-size="22" font-weight="bold" fill="${color}" font-family="Arial,Helvetica,sans-serif" letter-spacing="3" opacity="0.85">${text}</text>
</svg>`;
}

function generateRectStampWithDate(text, date, color = '#c0392b') {
  const len = Math.max(text.length, date.length);
  const w = Math.max(200, len * 12 + 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="80" viewBox="0 0 ${w} 80">
<rect x="3" y="3" width="${w - 6}" height="74" fill="none" stroke="${color}" stroke-width="4" rx="4" opacity="0.85"/>
<rect x="8" y="8" width="${w - 16}" height="64" fill="none" stroke="${color}" stroke-width="1.5" rx="2" opacity="0.6"/>
<text x="${w / 2}" y="38" text-anchor="middle" font-size="20" font-weight="bold" fill="${color}" font-family="Arial,Helvetica,sans-serif" letter-spacing="2" opacity="0.85">${text}</text>
<text x="${w / 2}" y="58" text-anchor="middle" font-size="10" fill="${color}" font-family="Arial,Helvetica,sans-serif" opacity="0.7">${date}</text>
</svg>`;
}

function generateRevenueStamp(amount = '₹100', color = '#8B4513') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="140" viewBox="0 0 120 140">
<rect x="4" y="4" width="112" height="132" fill="#fdf6ec" stroke="${color}" stroke-width="3" rx="3" opacity="0.9"/>
<rect x="8" y="8" width="104" height="124" fill="none" stroke="${color}" stroke-width="1" rx="2" opacity="0.5"/>
<line x1="10" y1="32" x2="110" y2="32" stroke="${color}" stroke-width="1" opacity="0.4"/>
<text x="60" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}" font-family="'Times New Roman',serif" letter-spacing="1" opacity="0.9">REVENUE</text>
<text x="60" y="70" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}" font-family="'Times New Roman',serif" opacity="0.8">GOVT OF INDIA</text>
<text x="60" y="95" text-anchor="middle" font-size="22" font-weight="bold" fill="${color}" font-family="'Times New Roman',serif" opacity="0.9">${amount}</text>
<line x1="10" y1="108" x2="110" y2="108" stroke="${color}" stroke-width="1" opacity="0.4"/>
<text x="60" y="123" text-anchor="middle" font-size="8" fill="${color}" font-family="'Times New Roman',serif" opacity="0.7">NON-JUDICIAL</text>
</svg>`;
}

function generateDscStamp(name, date, serial, issuer = 'eMudhra', color = '#0d47a1') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="100" viewBox="0 0 260 100">
<rect x="2" y="2" width="256" height="96" fill="#f0f7ff" stroke="${color}" stroke-width="2" rx="6" opacity="0.9"/>
<rect x="6" y="6" width="248" height="88" fill="none" stroke="${color}" stroke-width="0.5" rx="4" opacity="0.4" stroke-dasharray="4,2"/>
<text x="16" y="24" font-size="8" font-weight="bold" fill="${color}" font-family="Arial,sans-serif" opacity="0.9">DIGITALLY SIGNED</text>
<line x1="16" y1="30" x2="244" y2="30" stroke="${color}" stroke-width="0.5" opacity="0.3"/>
<text x="16" y="44" font-size="9" fill="#333" font-family="'Courier New',monospace">Signer: <tspan font-weight="bold">${name || 'N/A'}</tspan></text>
<text x="16" y="58" font-size="9" fill="#333" font-family="'Courier New',monospace">Date: ${date || new Date().toISOString().split('T')[0]}</text>
<text x="16" y="72" font-size="8" fill="#555" font-family="'Courier New',monospace">Serial: ${serial || 'XXXX-XXXX-XXXX'}</text>
<text x="16" y="86" font-size="8" fill="#555" font-family="'Courier New',monospace">Issuer: ${issuer} Sub-CA | Class 3</text>
<text x="244" y="86" text-anchor="end" font-size="7" fill="${color}" font-family="Arial,sans-serif" opacity="0.6">Verified ✓</text>
</svg>`;
}

const PREMADE_STAMPS = [
  { key: 'round_seal', label: 'Company Round Seal', type: 'round-seal' },
  { key: 'common_seal', label: 'Common Seal', type: 'common-seal' },
  { key: 'approved', label: 'APPROVED', type: 'rectangular' },
  { key: 'paid', label: 'PAID', type: 'rectangular' },
  { key: 'received', label: 'RECEIVED', type: 'rectangular' },
  { key: 'certified', label: 'CERTIFIED TRUE COPY', type: 'rectangular' },
  { key: 'original', label: 'ORIGINAL', type: 'rectangular' },
  { key: 'duplicate', label: 'DUPLICATE', type: 'rectangular' },
  { key: 'confidential', label: 'CONFIDENTIAL', type: 'rectangular' },
  { key: 'draft', label: 'DRAFT', type: 'rectangular' },
  { key: 'revenue', label: 'Revenue Stamp', type: 'revenue' },
];

function generatePremadeStamp(key, company, color) {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  switch (key) {
    case 'round_seal': return generateRoundSeal(company, color || '#1a3a6b');
    case 'common_seal': return generateCommonSeal(company, color || '#1a3a6b');
    case 'approved': return generateRectStamp('APPROVED', color || '#2e7d32');
    case 'paid': return generateRectStampWithDate('PAID', today, color || '#2e7d32');
    case 'received': return generateRectStampWithDate('RECEIVED', today, color || '#6366f1');
    case 'certified': return generateRectStamp('CERTIFIED TRUE COPY', color || '#0d47a1');
    case 'original': return generateRectStamp('ORIGINAL', color || '#2e7d32');
    case 'duplicate': return generateRectStamp('DUPLICATE', color || '#c0392b');
    case 'confidential': return generateRectStamp('CONFIDENTIAL', color || '#c0392b');
    case 'draft': return generateRectStamp('DRAFT', color || '#94a3b8');
    case 'revenue': return generateRevenueStamp('₹100', color || '#8B4513');
    default: return null;
  }
}

// ─── STATIC ROUTES (before parameterized) ────────────────────────────────────

// Get premade stamp list (for UI)
router.get('/premade-list', asyncHandler(async (req, res) => {
  res.json(PREMADE_STAMPS);
}));

// ─── STAMPS CRUD ─────────────────────────────────────────────────────────────

// List stamps
router.get('/:companyId/stamps', asyncHandler(async (req, res) => {
  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  res.json(company.stamps || []);
}));

// Add stamp
router.post('/:companyId/stamps', asyncHandler(async (req, res) => {
  const { name, type, data, color } = req.body;
  if (!name?.trim()) throw new ValidationError('Stamp validation failed', ['name is required']);
  if (!data) throw new ValidationError('Stamp validation failed', ['data (image) is required']);

  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const stamps = company.stamps || [];
  const stamp = {
    id: uid(),
    name: name.trim(),
    type: type || 'custom',
    data,
    color: color || '#1a3a6b',
    createdAt: new Date().toISOString(),
    createdBy: req.user.uid,
  };
  stamps.push(stamp);

  await db.collection('companies').doc(req.params.companyId).update({
    stamps,
    updatedAt: new Date().toISOString(),
  });

  res.status(201).json(stamp);
}));

// Generate pre-made stamp
router.post('/:companyId/stamps/premade', asyncHandler(async (req, res) => {
  const { key, color } = req.body;
  if (!key) throw new ValidationError('Stamp key required');

  const info = PREMADE_STAMPS.find(s => s.key === key);
  if (!info) throw new ValidationError('Invalid stamp key');

  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const svg = generatePremadeStamp(key, company, color);
  if (!svg) throw new ValidationError('Failed to generate stamp');

  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

  const stamps = company.stamps || [];
  const stamp = {
    id: uid(),
    name: info.label,
    type: info.type,
    data: dataUri,
    color: color || '#1a3a6b',
    createdAt: new Date().toISOString(),
    createdBy: req.user.uid,
  };
  stamps.push(stamp);

  await db.collection('companies').doc(req.params.companyId).update({
    stamps,
    updatedAt: new Date().toISOString(),
  });

  res.status(201).json(stamp);
}));

// Delete stamp
router.delete('/:companyId/stamps/:stampId', asyncHandler(async (req, res) => {
  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const stamps = (company.stamps || []).filter(s => s.id !== req.params.stampId);

  await db.collection('companies').doc(req.params.companyId).update({
    stamps,
    updatedAt: new Date().toISOString(),
  });

  res.json({ message: 'Stamp deleted' });
}));

// Preview premade stamp (without saving)
router.post('/:companyId/stamps/preview', asyncHandler(async (req, res) => {
  const { key, color } = req.body;
  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const svg = generatePremadeStamp(key, company, color);
  if (!svg) return res.status(400).json({ error: 'Invalid stamp key' });

  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  res.json({ data: dataUri });
}));

// ─── SIGNATURES CRUD ─────────────────────────────────────────────────────────

// List signatures
router.get('/:companyId/signatures', asyncHandler(async (req, res) => {
  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  res.json(company.signatures || []);
}));

// Add signature
router.post('/:companyId/signatures', asyncHandler(async (req, res) => {
  const { name, type, data, font } = req.body;
  if (!name?.trim()) throw new ValidationError('Signature validation failed', ['name is required']);
  if (!data) throw new ValidationError('Signature validation failed', ['data (image) is required']);

  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const signatures = company.signatures || [];
  const sig = {
    id: uid(),
    name: name.trim(),
    type: type || 'drawn',
    data,
    font: font || null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.uid,
  };
  signatures.push(sig);

  await db.collection('companies').doc(req.params.companyId).update({
    signatures,
    updatedAt: new Date().toISOString(),
  });

  res.status(201).json(sig);
}));

// Delete signature
router.delete('/:companyId/signatures/:sigId', asyncHandler(async (req, res) => {
  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const signatures = (company.signatures || []).filter(s => s.id !== req.params.sigId);

  await db.collection('companies').doc(req.params.companyId).update({
    signatures,
    updatedAt: new Date().toISOString(),
  });

  res.json({ message: 'Signature deleted' });
}));

// ─── DSC (Digital Signature Certificate) ─────────────────────────────────────

// Generate DSC visual stamp
router.post('/:companyId/signatures/dsc', asyncHandler(async (req, res) => {
  const { signerName, serialNumber, issuer, color } = req.body;
  if (!signerName?.trim()) throw new ValidationError('Signer name required');

  const company = await loadCompany(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const date = new Date().toISOString().split('T')[0];
  const serial = serialNumber || `EMUDHRA-${Date.now().toString(36).toUpperCase()}`;
  const svg = generateDscStamp(signerName.trim(), date, serial, issuer || 'eMudhra', color || '#0d47a1');
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

  const signatures = company.signatures || [];
  const sig = {
    id: uid(),
    name: `DSC - ${signerName.trim()}`,
    type: 'dsc',
    data: dataUri,
    dscInfo: { signerName: signerName.trim(), date, serialNumber: serial, issuer: issuer || 'eMudhra' },
    createdAt: new Date().toISOString(),
    createdBy: req.user.uid,
  };
  signatures.push(sig);

  await db.collection('companies').doc(req.params.companyId).update({
    signatures,
    updatedAt: new Date().toISOString(),
  });

  res.status(201).json(sig);
}));

export default router;
