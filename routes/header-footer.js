import express from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();
router.use(verifyToken);
router.use(requireRole('superadmin', 'admin'));

// ─── Default Templates ──────────────────────────────────────────────────────

const DEFAULT_DOC_HEADER = `<table style="width:100%;border-collapse:collapse;font-family:'Poppins',Arial,Helvetica,sans-serif;">
<tr>
<td style="vertical-align:top;padding:0 0 14px 0;border:none;width:62%;">
<div style="font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;line-height:1.2;margin-bottom:2px;">AKSHAY KOTISH &amp; CO.</div>
<div style="font-size:9px;color:#64748b;margin-bottom:3px;font-weight:400;">A Brand of Akshay Lakshay Kotish Private Limited</div>
<div style="font-size:10px;color:#2e7d32;font-weight:600;margin-bottom:7px;letter-spacing:0.2px;">Chartered Accountants &amp; Business Consultants</div>
<div style="font-size:8px;color:#94a3b8;line-height:1.7;font-weight:400;">GSTIN: 06AAWCA4919K1Z3 &bull; CIN: U72900HR2022PTC101170 &bull; PAN: AAWCA4919K</div>
</td>
<td style="vertical-align:top;text-align:right;padding:0 0 14px 0;border:none;white-space:nowrap;">
<div style="font-size:9px;color:#475569;line-height:2.2;font-weight:400;">
connect@akshaykotish.com<br>+91 98967 70369<br>
<span style="color:#2e7d32;font-weight:600;font-size:10px;">www.akshaykotish.com</span>
</div>
</td>
</tr>
</table>
<div style="height:3px;background:#2e7d32;margin-bottom:0;"></div>
<div style="font-size:8px;color:#64748b;padding:5px 0 0;font-family:'Poppins',Arial,sans-serif;font-weight:400;">H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027, India</div>`;

const DEFAULT_DOC_FOOTER = `<div style="height:2px;background:#2e7d32;margin-bottom:6px;"></div>
<table style="width:100%;border-collapse:collapse;font-family:'Poppins',Arial,Helvetica,sans-serif;">
<tr>
<td style="text-align:center;padding:0;border:none;">
<div style="font-size:7px;color:#64748b;line-height:1.6;">
<strong style="color:#1a1a1a;">Akshay Kotish &amp; Co.</strong> (A Brand of Akshay Lakshay Kotish Private Limited) &nbsp;|&nbsp; CIN: U72900HR2022PTC101170 &nbsp;|&nbsp; GSTIN: 06AAWCA4919K1Z3
</div>
<div style="font-size:6.5px;color:#94a3b8;margin-top:1px;">
connect@akshaykotish.com &bull; +91 98967 70369 &bull; www.akshaykotish.com &bull; H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027, India
</div>
</td>
</tr>
</table>`;

const DEFAULT_INV_HEADER = `<table style="width:100%;border-collapse:collapse;font-family:'Poppins',Arial,Helvetica,sans-serif;">
<tr>
<td style="vertical-align:top;padding:0 0 14px 0;border:none;width:55%;">
<div style="font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;line-height:1.2;margin-bottom:2px;">AKSHAY KOTISH &amp; CO.</div>
<div style="font-size:9px;color:#64748b;margin-bottom:3px;font-weight:400;">A Brand of Akshay Lakshay Kotish Private Limited</div>
<div style="font-size:10px;color:#2e7d32;font-weight:600;margin-bottom:7px;letter-spacing:0.2px;">Chartered Accountants &amp; Business Consultants</div>
<div style="font-size:8px;color:#94a3b8;line-height:1.7;font-weight:400;">GSTIN: 06AAWCA4919K1Z3 &bull; CIN: U72900HR2022PTC101170 &bull; PAN: AAWCA4919K</div>
</td>
<td style="vertical-align:top;text-align:right;padding:0 0 14px 0;border:none;">
<div style="font-size:26px;font-weight:800;color:#2e7d32;letter-spacing:-0.5px;margin-bottom:4px;">TAX INVOICE</div>
<div style="font-size:9px;color:#475569;line-height:2.2;font-weight:400;">
connect@akshaykotish.com<br>+91 98967 70369<br>
<span style="color:#2e7d32;font-weight:600;font-size:10px;">www.akshaykotish.com</span>
</div>
</td>
</tr>
</table>
<div style="height:3px;background:#2e7d32;margin-bottom:0;"></div>
<div style="font-size:8px;color:#64748b;padding:5px 0 0;font-family:'Poppins',Arial,sans-serif;font-weight:400;">H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027, India</div>`;

const DEFAULT_INV_FOOTER = DEFAULT_DOC_FOOTER;

const DEFAULTS = {
  doc_header: DEFAULT_DOC_HEADER,
  doc_footer: DEFAULT_DOC_FOOTER,
  inv_header: DEFAULT_INV_HEADER,
  inv_footer: DEFAULT_INV_FOOTER,
};

// ─── GET all templates ───────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const doc = await db.collection('settings').doc('header_footer_templates').get();
  const saved = doc.exists ? doc.data() : {};
  res.json({
    doc_header: saved.doc_header || DEFAULTS.doc_header,
    doc_footer: saved.doc_footer || DEFAULTS.doc_footer,
    inv_header: saved.inv_header || DEFAULTS.inv_header,
    inv_footer: saved.inv_footer || DEFAULTS.inv_footer,
  });
}));

// ─── GET single template ─────────────────────────────────────────────────────

router.get('/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!DEFAULTS[key]) return res.status(400).json({ error: 'Invalid template key' });
  const doc = await db.collection('settings').doc('header_footer_templates').get();
  const saved = doc.exists ? doc.data() : {};
  res.json({ key, html: saved[key] || DEFAULTS[key] });
}));

// ─── PUT update template ─────────────────────────────────────────────────────

router.put('/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { html } = req.body;
  if (!DEFAULTS[key]) return res.status(400).json({ error: 'Invalid template key' });
  if (typeof html !== 'string') return res.status(400).json({ error: 'html must be a string' });
  await db.collection('settings').doc('header_footer_templates').set({ [key]: html, updatedAt: new Date().toISOString() }, { merge: true });
  res.json({ key, html, message: 'Template updated' });
}));

// ─── POST reset to default ───────────────────────────────────────────────────

router.post('/:key/reset', asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!DEFAULTS[key]) return res.status(400).json({ error: 'Invalid template key' });
  await db.collection('settings').doc('header_footer_templates').set({ [key]: DEFAULTS[key], updatedAt: new Date().toISOString() }, { merge: true });
  res.json({ key, html: DEFAULTS[key], message: 'Template reset to default' });
}));

export default router;
