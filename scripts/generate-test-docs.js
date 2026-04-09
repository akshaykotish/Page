#!/usr/bin/env node
/**
 * Generate 10 production-quality company documents as PDFs and validate them.
 * Uses puppeteer for HTML → PDF conversion.
 *
 * Usage: node scripts/generate-test-docs.js
 * Output: test-docs/*.pdf
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'test-docs');

// ─── Company Profile ─────────────────────────────────────────────────────────

const company = {
  name: 'Akshay Kotish & Co.',
  legalName: 'Akshay Lakshay Kotish Private Limited',
  legalLine: 'A Brand of Akshay Lakshay Kotish Private Limited',
  tagline: 'Chartered Accountants & Business Consultants',
  gstin: '06AAWCA4919K1Z3',
  cin: 'U72900HR2022PTC101170',
  pan: 'AAWCA4919K',
  phone: '+91 98967 70369',
  email: 'connect@akshaykotish.com',
  website: 'www.akshaykotish.com',
  address: 'H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027, India',
  state: 'Haryana',
  stateCode: '06',
};

// ─── Number to Words (Indian system) ─────────────────────────────────────────

function numberToWords(num) {
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }

  const whole = Math.floor(num);
  const paise = Math.round((num - whole) * 100);
  let result = 'Rupees ' + convert(whole);
  if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
  return result + ' Only';
}

function inr(n) { return '₹' + Number(n).toLocaleString('en-IN'); }

// ─── Template Functions ──────────────────────────────────────────────────────

function docHeader(c) {
  const name = (c.name || 'Company Name').toUpperCase();
  const legalLine = c.legalLine || '';
  const tagline = c.tagline || '';
  const statutory = [c.gstin ? `GSTIN: ${c.gstin}` : '', c.cin ? `CIN: ${c.cin}` : '', c.pan ? `PAN: ${c.pan}` : ''].filter(Boolean).join(' &nbsp;|&nbsp; ');
  const contactLines = [c.email, c.phone].filter(Boolean);
  const website = c.website || '';
  const address = c.address || '';
  return `<table style="width:100%;border-collapse:collapse;font-family:'Poppins',Arial,sans-serif;">
<tr>
<td style="vertical-align:top;padding:0 0 10px 0;border:none;width:62%;">
<div style="font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;line-height:1.15;margin-bottom:2px;">${name}</div>
${legalLine ? `<div style="font-size:9px;color:#64748b;margin-bottom:2px;">${legalLine}</div>` : ''}
${tagline ? `<div style="font-size:10px;color:#2e7d32;font-weight:600;margin-bottom:4px;letter-spacing:0.2px;">${tagline}</div>` : ''}
${statutory ? `<div style="font-size:7.5px;color:#94a3b8;line-height:1.6;">${statutory}</div>` : ''}
</td>
<td style="vertical-align:top;text-align:right;padding:0 0 10px 0;border:none;white-space:nowrap;">
<div style="font-size:9px;color:#475569;line-height:2.2;">
${contactLines.join('<br>')}${website ? `<br><span style="color:#2e7d32;font-weight:600;font-size:10px;">${website}</span>` : ''}
</div>
</td>
</tr>
</table>
<div style="height:3px;background:linear-gradient(90deg,#2e7d32 0%,#1b5e20 100%);margin-bottom:0;"></div>
${address ? `<div style="font-size:7.5px;color:#64748b;padding:5px 0 0;">${address}</div>` : ''}`;
}

function docFooter(c) {
  const name = c.name || 'Company Name';
  const legalLine = c.legalLine || '';
  const regLine = [c.cin ? `CIN: ${c.cin}` : '', c.gstin ? `GSTIN: ${c.gstin}` : ''].filter(Boolean).join(' &nbsp;|&nbsp; ');
  const contactParts = [c.email, c.phone, c.website, c.address].filter(Boolean);
  return `<div style="height:2px;background:linear-gradient(90deg,#2e7d32,#1b5e20);margin-bottom:6px;"></div>
<table style="width:100%;border-collapse:collapse;font-family:'Poppins',Arial,sans-serif;">
<tr><td style="text-align:center;padding:0;border:none;">
<div style="font-size:7px;color:#64748b;line-height:1.6;">
<strong style="color:#1a1a1a;">${name}</strong>${legalLine ? ` (${legalLine})` : ''}${regLine ? ` &nbsp;|&nbsp; ${regLine}` : ''}
</div>
${contactParts.length ? `<div style="font-size:6.5px;color:#94a3b8;margin-top:1px;">${contactParts.join(' &bull; ')}</div>` : ''}
</td></tr></table>`;
}

function invHeader(c) {
  const name = (c.name || 'Company Name').toUpperCase();
  const legalLine = c.legalLine || '';
  const tagline = c.tagline || '';
  const statutory = [c.gstin ? `GSTIN: ${c.gstin}` : '', c.cin ? `CIN: ${c.cin}` : '', c.pan ? `PAN: ${c.pan}` : ''].filter(Boolean).join(' &nbsp;|&nbsp; ');
  const contactLines = [c.email, c.phone].filter(Boolean);
  const website = c.website || '';
  const address = c.address || '';
  return `<table style="width:100%;border-collapse:collapse;font-family:'Poppins',Arial,sans-serif;">
<tr>
<td style="vertical-align:top;padding:0 0 10px 0;border:none;width:55%;">
<div style="font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;line-height:1.15;margin-bottom:2px;">${name}</div>
${legalLine ? `<div style="font-size:9px;color:#64748b;margin-bottom:2px;">${legalLine}</div>` : ''}
${tagline ? `<div style="font-size:10px;color:#2e7d32;font-weight:600;margin-bottom:4px;letter-spacing:0.2px;">${tagline}</div>` : ''}
${statutory ? `<div style="font-size:7.5px;color:#94a3b8;line-height:1.6;">${statutory}</div>` : ''}
</td>
<td style="vertical-align:top;text-align:right;padding:0 0 10px 0;border:none;">
<div style="font-size:26px;font-weight:800;color:#2e7d32;letter-spacing:-0.5px;margin-bottom:4px;">TAX INVOICE</div>
<div style="font-size:9px;color:#475569;line-height:2.2;">
${contactLines.join('<br>')}${website ? `<br><span style="color:#2e7d32;font-weight:600;font-size:10px;">${website}</span>` : ''}
</div>
</td>
</tr>
</table>
<div style="height:3px;background:linear-gradient(90deg,#2e7d32 0%,#1b5e20 100%);margin-bottom:0;"></div>
${address ? `<div style="font-size:7.5px;color:#64748b;padding:5px 0 0;">${address}</div>` : ''}`;
}

// ─── Common helpers ──────────────────────────────────────────────────────────

const F = "'Poppins', Arial, sans-serif";
const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const currentMonth = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const prevMonth = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

function p(text, o = {}) {
  return `<p style="font-family:${F};font-size:${o.size || '11px'};color:${o.color || '#1a1a1a'};line-height:${o.lh || '1.7'};margin-bottom:${o.mb || '8px'};${o.bold ? 'font-weight:700;' : ''}${o.center ? 'text-align:center;' : ''}${o.right ? 'text-align:right;' : ''}${o.under ? 'text-decoration:underline;' : ''}">${text}</p>`;
}

function h1(text) { return p(text, { size: '16px', bold: true, center: true, under: true, mb: '18px' }); }
function h2(text) { return `<p style="font-family:${F};font-size:12px;font-weight:700;text-decoration:underline;margin:18px 0 10px;color:#1a1a1a;">${text}</p>`; }

function refBlock(num) {
  return `<div style="text-align:right;margin-bottom:16px;font-family:${F};">
<div style="font-size:10px;color:#64748b;">Ref: AK&amp;Co/${num}</div>
<div style="font-size:11px;font-weight:500;color:#1a1a1a;">Date: ${today}</div>
</div>`;
}

function sig(name, title) {
  // Signature with handwriting-style name
  return `<div style="margin-top:44px;font-family:${F};">
<p style="font-weight:600;font-size:11px;color:#1a1a1a;margin-bottom:4px;">For ${company.name}</p>
<div style="margin:12px 0;padding:8px 0;">
  <div style="font-family:'Brush Script MT','Segoe Script',cursive;font-size:28px;color:#1a3a6b;opacity:0.8;transform:rotate(-2deg);display:inline-block;">${name}</div>
</div>
<div style="width:200px;border-top:1.5px solid #1a1a1a;padding-top:4px;">
<p style="font-weight:700;font-size:11px;color:#1a1a1a;margin:0;">${name}</p>
<p style="font-size:9px;color:#64748b;margin:2px 0 0;">${title}</p>
</div>
</div>`;
}

function dualSig(leftName, leftTitle, leftOrg, rightName, rightTitle, rightOrg) {
  const side = (n, t, o) => `<div style="width:45%;">
<p style="font-weight:600;font-size:10px;margin-bottom:4px;">For ${o}</p>
<div style="margin:10px 0;padding:6px 0;font-family:'Brush Script MT','Segoe Script',cursive;font-size:24px;color:#1a3a6b;opacity:0.8;transform:rotate(-2deg);display:inline-block;">${n}</div>
<div style="width:180px;border-top:1.5px solid #1a1a1a;padding-top:4px;">
<p style="font-weight:700;font-size:10px;color:#1a1a1a;margin:0;">${n}</p>
<p style="font-size:8px;color:#64748b;margin:2px 0 0;">${t}</p>
</div></div>`;
  return `<div style="display:flex;justify-content:space-between;margin-top:44px;font-family:${F};">
${side(leftName, leftTitle, leftOrg)}
${side(rightName, rightTitle, rightOrg)}
</div>`;
}

function tblHdr(cells) {
  return `<tr>${cells.map(c => {
    const align = typeof c === 'object' ? (c.align || 'left') : 'left';
    const text = typeof c === 'object' ? c.text : c;
    return `<th style="padding:8px 10px;border:1px solid #d1d5db;background:#f1f5f9;font-weight:600;font-size:9px;color:#475569;text-transform:uppercase;letter-spacing:0.5px;text-align:${align};">${text}</th>`;
  }).join('')}</tr>`;
}

function tblRow(cells) {
  return `<tr>${cells.map(c => {
    const align = typeof c === 'object' ? (c.align || 'left') : 'left';
    const text = typeof c === 'object' ? c.text : c;
    const extra = typeof c === 'object' ? (c.bold ? 'font-weight:700;' : '') + (c.color ? `color:${c.color};` : '') : '';
    return `<td style="padding:7px 10px;border:1px solid #e5e7eb;font-size:10px;color:#1a1a1a;text-align:${align};${extra}">${text}</td>`;
  }).join('')}</tr>`;
}

function tblTotal(label, value, highlight = false) {
  const bg = highlight ? 'background:#f0fdf4;' : '';
  const fw = highlight ? 'font-weight:800;font-size:12px;color:#2e7d32;' : 'font-weight:600;';
  return `<tr style="${bg}"><td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;font-size:10px;">${label}</td><td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;${fw}">${value}</td></tr>`;
}

// ─── Stamp SVG (visual seal for signatures) ──────────────────────────────────

const companySeal = `<div style="position:relative;display:inline-block;margin-left:40px;opacity:0.7;">
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 200 200">
<circle cx="100" cy="100" r="94" fill="none" stroke="#1a3a6b" stroke-width="3" opacity="0.7"/>
<circle cx="100" cy="100" r="86" fill="none" stroke="#1a3a6b" stroke-width="1.5" opacity="0.7"/>
<circle cx="100" cy="100" r="42" fill="none" stroke="#1a3a6b" stroke-width="1" opacity="0.3"/>
<defs><path id="ts" d="M 30,100 A 70,70 0 0,1 170,100"/><path id="bs" d="M 170,100 A 70,70 0 0,1 30,100"/></defs>
<text fill="#1a3a6b" font-family="Arial,sans-serif" font-weight="bold" font-size="11" letter-spacing="2" opacity="0.7"><textPath href="#ts" startOffset="50%" text-anchor="middle">AKSHAY KOTISH &amp; CO.</textPath></text>
<text fill="#1a3a6b" font-family="Arial,sans-serif" font-size="8" letter-spacing="1.5" opacity="0.7"><textPath href="#bs" startOffset="50%" text-anchor="middle">AUTHORIZED SIGNATORY</textPath></text>
<text x="100" y="98" text-anchor="middle" font-size="24" fill="#1a3a6b" opacity="0.6">&#9733;</text>
<text x="100" y="115" text-anchor="middle" font-size="6" fill="#1a3a6b" opacity="0.5">CIN: U72900HR2022PTC101170</text>
</svg></div>`;

function sigWithSeal(name, title) {
  return `<div style="margin-top:44px;font-family:${F};display:flex;align-items:flex-end;gap:20px;">
<div>
<p style="font-weight:600;font-size:11px;color:#1a1a1a;margin-bottom:4px;">For ${company.name}</p>
<div style="margin:10px 0;font-family:'Brush Script MT','Segoe Script',cursive;font-size:28px;color:#1a3a6b;opacity:0.8;transform:rotate(-2deg);display:inline-block;">${name}</div>
<div style="width:200px;border-top:1.5px solid #1a1a1a;padding-top:4px;">
<p style="font-weight:700;font-size:11px;color:#1a1a1a;margin:0;">${name}</p>
<p style="font-size:9px;color:#64748b;margin:2px 0 0;">${title}</p>
</div>
</div>
${companySeal}
</div>`;
}

// ─── 10 Document Bodies ──────────────────────────────────────────────────────

const documents = [
  // 1. TAX INVOICE
  {
    name: '01-Tax-Invoice',
    header: invHeader(company),
    footer: docFooter(company),
    body: () => {
      const items = [
        { desc: 'GST Return Filing (Monthly) — April 2026', hsn: '998231', qty: 1, rate: 5000, gst: 18 },
        { desc: 'TDS Return Filing — Q4 FY 2025-26', hsn: '998231', qty: 1, rate: 3000, gst: 18 },
        { desc: 'Financial Statement Preparation', hsn: '998221', qty: 1, rate: 15000, gst: 18 },
        { desc: 'Tax Planning & Advisory (5 sessions)', hsn: '998231', qty: 5, rate: 2000, gst: 18 },
      ];
      const subtotal = items.reduce((s, i) => s + i.qty * i.rate, 0);
      const cgst = items.reduce((s, i) => s + (i.qty * i.rate * i.gst / 200), 0);
      const sgst = cgst;
      const total = subtotal + cgst + sgst;

      return `
${refBlock('INV/2026-04/001')}
<table style="width:100%;font-family:${F};font-size:10px;margin-bottom:16px;">
<tr><td style="width:50%;vertical-align:top;padding:0;">
<div style="font-size:9px;color:#64748b;font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Bill To</div>
<div style="font-weight:700;font-size:12px;color:#1a1a1a;margin-bottom:2px;">Sharma Enterprises Pvt. Ltd.</div>
<div style="color:#475569;line-height:1.6;">Plot No. 45, Sector 18<br>Gurugram, Haryana — 122015<br>GSTIN: 06AABCS1234A1Z5</div>
</td>
<td style="width:50%;vertical-align:top;text-align:right;padding:0;">
<div style="font-size:9px;color:#64748b;font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Invoice Details</div>
<div style="line-height:2;color:#1a1a1a;">
Invoice No: <strong>AK/INV/2026-04/001</strong><br>
Invoice Date: <strong>${today}</strong><br>
Due Date: <strong>30 April, 2026</strong><br>
Place of Supply: <strong>Haryana (06)</strong>
</div>
</td></tr></table>

<table style="width:100%;border-collapse:collapse;font-family:${F};margin-bottom:16px;">
${tblHdr([{text:'#',align:'center'}, 'Description', 'HSN/SAC', {text:'Qty',align:'center'}, {text:'Rate (₹)',align:'right'}, {text:'GST',align:'center'}, {text:'Amount (₹)',align:'right'}])}
${items.map((it, i) => tblRow([{text:i+1,align:'center'}, it.desc, it.hsn, {text:it.qty,align:'center'}, {text:inr(it.rate),align:'right'}, {text:it.gst+'%',align:'center'}, {text:inr(it.qty*it.rate),align:'right'}])).join('\n')}
</table>

<table style="width:45%;margin-left:auto;font-family:${F};font-size:10px;border-collapse:collapse;">
${tblTotal('Subtotal', inr(subtotal))}
${tblTotal('CGST @ 9%', inr(cgst))}
${tblTotal('SGST @ 9%', inr(sgst))}
${tblTotal('Grand Total', inr(total), true)}
</table>

<div style="margin-top:14px;font-family:${F};font-size:9px;color:#475569;background:#f8fafc;padding:12px;border-radius:4px;border:1px solid #e5e7eb;">
<strong>Amount in Words:</strong> ${numberToWords(total)}<br>
<strong>Bank Details:</strong> Akshay Lakshay Kotish Pvt. Ltd. &nbsp;|&nbsp; A/C: 50200012345678 &nbsp;|&nbsp; IFSC: HDFC0001234 &nbsp;|&nbsp; HDFC Bank, Kaithal<br>
<strong>Terms:</strong> Payment due within 15 days. Interest @18% p.a. on overdue amounts.
</div>
${sigWithSeal('Akshay Kotish', 'Managing Partner')}`;
    },
  },

  // 2. PAYMENT RECEIPT
  {
    name: '02-Payment-Receipt',
    header: docHeader(company),
    footer: docFooter(company),
    body: () => {
      const amt = 9440;
      return `
${refBlock('REC/2026-04/015')}
${h1('PAYMENT RECEIPT')}
<table style="width:100%;font-family:${F};font-size:10px;margin-bottom:18px;">
<tr><td style="width:50%;">
${p('<strong>Received From:</strong>', { mb: '4px' })}
${p('M/s Sharma Enterprises Pvt. Ltd.<br>Plot No. 45, Sector 18, Gurugram<br>Haryana — 122015')}
</td><td style="width:50%;text-align:right;">
${p(`Receipt No: <strong>AK/REC/2026-04/015</strong><br>Date: <strong>${today}</strong><br>Payment Mode: <strong>NEFT</strong>`, { right: true })}
</td></tr></table>

<table style="width:100%;border-collapse:collapse;font-family:${F};margin-bottom:16px;">
${tblHdr([{text:'#',align:'center'}, 'Description', 'Invoice Ref', {text:'Amount (₹)',align:'right'}])}
${tblRow([{text:'1',align:'center'}, 'GST Return Filing Services — March 2026', 'AK/INV/2026-03/042', {text:inr(5900),align:'right'}])}
${tblRow([{text:'2',align:'center'}, 'TDS Return Filing — Q4 FY 2025-26', 'AK/INV/2026-03/043', {text:inr(3540),align:'right'}])}
</table>

<table style="width:40%;margin-left:auto;font-family:${F};font-size:10px;border-collapse:collapse;">
${tblTotal('Total Received', inr(amt), true)}
</table>

${p(`<strong>Amount in Words:</strong> ${numberToWords(amt)}`, { size: '9px', color: '#475569' })}
${p('<strong>Transaction Ref:</strong> NEFT/UTR: HDFC20260401234567', { size: '9px', color: '#475569' })}
${sigWithSeal('Akshay Kotish', 'Managing Partner')}`;
    },
  },

  // 3. EXPERIENCE LETTER
  {
    name: '03-Experience-Letter',
    header: docHeader(company),
    footer: docFooter(company),
    body: () => `
${refBlock('HR/EXP/2026-04/003')}
${p('<strong>To Whomsoever It May Concern</strong>')}
${h1('EXPERIENCE CERTIFICATE')}
${p(`This is to certify that <strong>Mr. Rahul Verma</strong> (Employee ID: AK-EMP-0042) was employed with ${company.name}, a brand of ${company.legalName}, from <strong>15 June, 2022</strong> to <strong>31 March, 2026</strong>.`)}
${p(`During his tenure, Mr. Verma held the position of <strong>Senior Accountant</strong> in our Taxation & Compliance Department. His primary responsibilities included:`)}
<ul style="font-family:${F};font-size:11px;line-height:1.9;color:#1a1a1a;margin-bottom:14px;padding-left:24px;">
<li>Preparation and filing of GST returns (GSTR-1, GSTR-3B, GSTR-9)</li>
<li>Income tax computation and return filing for corporate clients</li>
<li>TDS/TCS compliance and quarterly return filing</li>
<li>Financial statement preparation and statutory audit assistance</li>
<li>Client relationship management and advisory services</li>
</ul>
${p(`Mr. Verma demonstrated exceptional proficiency in taxation laws, exhibited strong analytical skills, and consistently maintained high standards of professional ethics. His attention to detail and commitment to deadlines were commendable.`)}
${p(`We found Mr. Verma to be a diligent, reliable, and valuable member of our team. He leaves the organization on his own accord, and we wish him every success in his future endeavors.`)}
${p(`His last drawn CTC was <strong>₹7,20,000 per annum</strong> (${numberToWords(720000).replace(' Only', ' Per Annum Only')}).`)}
${sigWithSeal('Akshay Kotish', 'Managing Partner')}`,
  },

  // 4. OFFER LETTER
  {
    name: '04-Offer-Letter',
    header: docHeader(company),
    footer: docFooter(company),
    body: () => `
${refBlock('HR/OFF/2026-04/007')}
${p('<strong>To,</strong>')}
${p('Ms. Priya Sharma<br>A-12, Sunshine Apartments<br>Sector 14, Rohtak, Haryana — 124001')}
${h1('OFFER OF EMPLOYMENT')}
${p(`Dear Ms. Sharma,`)}
${p(`We are pleased to offer you the position of <strong>Tax Consultant</strong> at ${company.name}. We were impressed with your qualifications and experience, and believe you will be a valuable addition to our team.`)}
${p(`The details of your engagement are as follows:`)}
<table style="width:100%;border-collapse:collapse;font-family:${F};margin:14px 0;">
${tblHdr(['Particulars', 'Details'])}
${tblRow(['Designation', 'Tax Consultant'])}
${tblRow(['Department', 'Direct Taxation'])}
${tblRow(['Reporting To', 'Akshay Kotish, Managing Partner'])}
${tblRow(['Date of Joining', '15 May, 2026'])}
${tblRow(['Location', 'Kaithal, Haryana'])}
${tblRow(['Annual CTC', {text: `${inr(600000)} (${numberToWords(600000)})`, bold: true}])}
${tblRow(['Probation Period', '6 Months'])}
</table>
${p(`This offer is contingent upon satisfactory verification of your educational qualifications, professional certifications, and previous employment records.`)}
${p(`Please confirm your acceptance by signing and returning a copy of this letter on or before <strong>25 April, 2026</strong>.`)}
${p(`We look forward to welcoming you to our team.`)}
${sig('Akshay Kotish', 'Managing Partner')}
<div style="margin-top:30px;font-family:${F};font-size:10px;border-top:2px solid #e5e7eb;padding-top:12px;">
<p style="font-weight:700;margin-bottom:6px;">Acceptance</p>
<p>I, Priya Sharma, accept this offer of employment on the terms stated above.</p>
<p style="margin-top:30px;">Signature: ________________________ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</p>
</div>`,
  },

  // 5. BLANK LETTERPAD
  {
    name: '05-Blank-Letterpad',
    header: docHeader(company),
    footer: docFooter(company),
    body: () => `
<div style="font-family:${F};">
  <div style="text-align:right;margin-bottom:24px;font-size:11px;color:#94a3b8;">Date: ________________________</div>
  <div style="margin-bottom:24px;font-size:11px;color:#94a3b8;">Ref: ________________________</div>
</div>`,
  },

  // 6. SERVICE AGREEMENT
  {
    name: '06-Service-Agreement',
    header: docHeader(company),
    footer: docFooter(company),
    body: () => `
${refBlock('AGR/2026-04/002')}
${h1('SERVICE AGREEMENT')}
${p(`This Service Agreement ("Agreement") is entered into on <strong>${today}</strong> by and between:`, { mb: '14px' })}
${p(`<strong>Party A (Service Provider):</strong><br>${company.name}, ${company.legalLine}<br>${company.address}<br>GSTIN: ${company.gstin} &nbsp;|&nbsp; PAN: ${company.pan}`)}
${p(`<strong>Party B (Client):</strong><br>TechVista Solutions Pvt. Ltd.<br>Tower B, 5th Floor, DLF Cyber City, Gurugram, Haryana — 122002<br>GSTIN: 06AABCT5678B1Z9`)}
${h2('1. SCOPE OF SERVICES')}
${p(`The Service Provider agrees to provide the following professional services:`)}
<ol style="font-family:${F};font-size:11px;line-height:1.9;color:#1a1a1a;margin-bottom:12px;padding-left:24px;">
<li>Monthly GST return filing (GSTR-1, GSTR-3B)</li>
<li>Annual GST reconciliation and GSTR-9/9C filing</li>
<li>Quarterly TDS return filing and certificate issuance</li>
<li>Income tax return preparation and filing</li>
<li>Tax planning and advisory services as needed</li>
</ol>
${h2('2. TERM')}
${p(`Effective from <strong>1 May, 2026</strong> for <strong>12 months</strong>. Either party may terminate with 30 days written notice.`)}
${h2('3. FEES')}
${p(`Retainer fee: <strong>${inr(25000)} per month</strong> (plus applicable GST). Payment due within 15 days of invoice date.`)}
${h2('4. CONFIDENTIALITY')}
${p(`Both parties agree to maintain strict confidentiality of all financial data, business information, and proprietary materials shared during this engagement.`)}
${h2('5. GOVERNING LAW')}
${p(`Governed by the laws of India, subject to jurisdiction of courts in Kaithal, Haryana.`)}
${dualSig('Akshay Kotish', 'Managing Partner', company.name, 'Vikram Mehta', 'Director', 'TechVista Solutions Pvt. Ltd.')}`,
  },

  // 7. GST NOTICE
  {
    name: '07-GST-Compliance-Notice',
    header: docHeader(company),
    footer: docFooter(company),
    watermark: 'URGENT',
    body: () => `
${refBlock('NTC/GST/2026-04/001')}
${p('<strong>To,</strong>')}
${p('The Managing Director<br>Gupta Trading Co.<br>Shop No. 12, Main Market, Kaithal<br>Haryana — 136027<br>GSTIN: 06AABCG9876D1Z5')}
${h2('Subject: Non-Filing of GST Returns & Compliance Advisory')}
${p('Dear Sir/Madam,')}
${p(`This notice is issued on behalf of our client regarding the following GST compliance irregularities:`)}
<table style="width:100%;border-collapse:collapse;font-family:${F};margin:14px 0;">
${tblHdr(['Return', 'Period', 'Due Date', 'Status'])}
${tblRow(['GSTR-3B', 'January 2026', '20 Feb 2026', {text:'NOT FILED',color:'#dc2626',bold:true}])}
${tblRow(['GSTR-3B', 'February 2026', '20 Mar 2026', {text:'NOT FILED',color:'#dc2626',bold:true}])}
${tblRow(['GSTR-1', 'January 2026', '11 Feb 2026', {text:'NOT FILED',color:'#dc2626',bold:true}])}
${tblRow(['GSTR-1', 'February 2026', '11 Mar 2026', {text:'FILED LATE',color:'#f59e0b',bold:true}])}
</table>
${p(`<strong>Consequences of Non-Compliance:</strong>`, { mb: '4px' })}
<ul style="font-family:${F};font-size:11px;line-height:1.9;color:#1a1a1a;margin-bottom:12px;padding-left:24px;">
<li>Late fee: ₹50/day (CGST) + ₹50/day (SGST) per return</li>
<li>Interest: 18% p.a. on outstanding tax liability</li>
<li>Risk of GSTIN suspension under Section 29(2) of CGST Act</li>
<li>Inability to claim Input Tax Credit (ITC)</li>
</ul>
${p(`We <strong>strongly advise</strong> you to file all pending returns within <strong>15 days</strong> of this notice to avoid further penalties and enforcement action.`)}
${sigWithSeal('Akshay Kotish', 'Managing Partner')}`,
  },

  // 8. SALARY SLIP
  {
    name: '08-Salary-Slip',
    header: docHeader(company),
    footer: docFooter(company),
    body: () => {
      const earn = { basic: 30000, hra: 12000, da: 6000, conveyance: 3000, special: 9000 };
      const ded = { pf: 3600, pt: 200, tds: 2500, esi: 0, other: 0 };
      const gross = Object.values(earn).reduce((a, b) => a + b, 0);
      const totalDed = Object.values(ded).reduce((a, b) => a + b, 0);
      const net = gross - totalDed;
      return `
${h1(`SALARY SLIP — ${prevMonth}`)}
<table style="width:100%;font-family:${F};font-size:10px;margin-bottom:18px;line-height:1.8;">
<tr><td style="width:50%;">
<strong>Employee Name:</strong> Rahul Verma<br>
<strong>Employee ID:</strong> AK-EMP-0042<br>
<strong>Designation:</strong> Senior Accountant
</td><td style="width:50%;text-align:right;">
<strong>Department:</strong> Taxation & Compliance<br>
<strong>Pay Period:</strong> 01 — 31 ${prevMonth}<br>
<strong>Payment Date:</strong> ${today}
</td></tr></table>

<table style="width:100%;border-collapse:collapse;font-family:${F};margin-bottom:16px;">
<tr>
<th colspan="2" style="padding:10px;border:1px solid #d1d5db;background:#f0fdf4;color:#16a34a;font-size:10px;text-align:center;font-weight:700;letter-spacing:0.5px;">EARNINGS</th>
<th colspan="2" style="padding:10px;border:1px solid #d1d5db;background:#fef2f2;color:#dc2626;font-size:10px;text-align:center;font-weight:700;letter-spacing:0.5px;">DEDUCTIONS</th>
</tr>
${[
  ['Basic Salary', earn.basic, 'Provident Fund (12%)', ded.pf],
  ['House Rent Allowance', earn.hra, 'Professional Tax', ded.pt],
  ['Dearness Allowance', earn.da, 'TDS (Income Tax)', ded.tds],
  ['Conveyance Allowance', earn.conveyance, 'ESI Contribution', ded.esi],
  ['Special Allowance', earn.special, 'Other Deductions', ded.other],
].map(([e1, e2, d1, d2]) =>
  `<tr><td style="padding:7px 10px;border:1px solid #e5e7eb;font-size:10px;">${e1}</td><td style="padding:7px 10px;border:1px solid #e5e7eb;text-align:right;font-size:10px;font-weight:500;">${inr(e2)}</td><td style="padding:7px 10px;border:1px solid #e5e7eb;font-size:10px;">${d1}</td><td style="padding:7px 10px;border:1px solid #e5e7eb;text-align:right;font-size:10px;font-weight:500;">${d2 > 0 ? inr(d2) : '—'}</td></tr>`
).join('\n')}
<tr style="font-weight:700;background:#f8fafc;">
<td style="padding:9px 10px;border:1px solid #d1d5db;font-size:10px;">Gross Earnings</td>
<td style="padding:9px 10px;border:1px solid #d1d5db;text-align:right;font-size:11px;color:#16a34a;">${inr(gross)}</td>
<td style="padding:9px 10px;border:1px solid #d1d5db;font-size:10px;">Total Deductions</td>
<td style="padding:9px 10px;border:1px solid #d1d5db;text-align:right;font-size:11px;color:#dc2626;">${inr(totalDed)}</td>
</tr>
</table>

<table style="width:60%;margin:0 auto;border-collapse:collapse;font-family:${F};">
<tr style="background:#f0fdf4;"><td style="padding:14px 20px;border:2px solid #2e7d32;text-align:center;">
<span style="font-size:10px;color:#64748b;display:block;margin-bottom:2px;">NET PAY</span>
<span style="font-weight:800;font-size:18px;color:#2e7d32;">${inr(net)}</span>
</td></tr>
</table>
${p(`<strong>Amount in Words:</strong> ${numberToWords(net)}`, { size: '9px', color: '#475569', center: true })}
<div style="margin-top:8px;text-align:center;">
${p('This is a system-generated payslip and does not require a physical signature.', { size: '8px', color: '#94a3b8', center: true })}
</div>`;
    },
  },

  // 9. CERTIFICATE OF COMPLETION
  {
    name: '09-Certificate-of-Completion',
    header: docHeader(company),
    footer: docFooter(company),
    body: () => `
${refBlock('CERT/2026-04/001')}
<div style="text-align:center;margin:24px 0;font-family:${F};">
<div style="display:inline-block;border:2px solid #2e7d32;padding:8px 40px;border-radius:4px;">
<p style="font-size:20px;font-weight:800;color:#2e7d32;letter-spacing:2px;margin:0;">CERTIFICATE OF COMPLETION</p>
</div>
<div style="width:80px;height:3px;background:#2e7d32;margin:12px auto 20px;"></div>
</div>
${p(`This is to certify that the following professional engagement has been successfully completed:`, { center: true })}
<table style="width:80%;margin:20px auto;border-collapse:collapse;font-family:${F};">
${tblHdr(['Particulars', 'Details'])}
${tblRow(['Client', {text:'Bharat Industries Ltd.', bold:true}])}
${tblRow(['Engagement', 'Statutory Audit for FY 2025-26'])}
${tblRow(['Scope', 'Audit of financial statements per Companies Act, 2013'])}
${tblRow(['Period Covered', '1 April, 2025 to 31 March, 2026'])}
${tblRow(['Completion Date', today])}
${tblRow(['Audit Opinion', {text:'Unmodified (Clean) Opinion',color:'#16a34a',bold:true}])}
</table>
${p(`The engagement was conducted in accordance with the Standards on Auditing (SAs) issued by the Institute of Chartered Accountants of India (ICAI). All deliverables have been duly submitted.`, { center: true })}
${p(`This certificate is issued at the request of the client for their records.`, { center: true, size: '10px', color: '#64748b' })}
${sigWithSeal('Akshay Kotish', 'Managing Partner')}`,
  },

  // 10. NDA
  {
    name: '10-Non-Disclosure-Agreement',
    header: docHeader(company),
    footer: docFooter(company),
    watermark: 'CONFIDENTIAL',
    body: () => `
${refBlock('NDA/2026-04/005')}
${h1('NON-DISCLOSURE AGREEMENT')}
${p(`This Non-Disclosure Agreement ("Agreement") is entered into as of <strong>${today}</strong> by and between:`)}
${p(`<strong>Disclosing Party:</strong> Capital Growth Partners LLP<br>302, Financial Tower, Connaught Place, New Delhi — 110001<br>PAN: AAFFC4567K`)}
${p(`<strong>Receiving Party:</strong> ${company.name} (${company.legalLine})<br>${company.address}<br>PAN: ${company.pan}`)}
${h2('1. DEFINITION OF CONFIDENTIAL INFORMATION')}
${p(`"Confidential Information" shall mean all financial records, tax filings, business strategies, client lists, investment portfolios, trade secrets, proprietary data, and any other information disclosed by the Disclosing Party, whether in written, oral, electronic, or any other form.`)}
${h2('2. OBLIGATIONS OF RECEIVING PARTY')}
<ol style="font-family:${F};font-size:11px;line-height:1.9;color:#1a1a1a;margin-bottom:12px;padding-left:24px;">
<li>Hold all Confidential Information in strict confidence</li>
<li>Not disclose to third parties without prior written consent</li>
<li>Use solely for the purpose of providing professional services</li>
<li>Take all reasonable measures to protect confidentiality</li>
<li>Return or destroy all materials upon termination of engagement</li>
</ol>
${h2('3. TERM')}
${p(`This Agreement remains in effect for <strong>3 years</strong> from execution, or until terminated by mutual written consent.`)}
${h2('4. REMEDIES')}
${p(`The Disclosing Party shall be entitled to injunctive relief and any other remedies available at law for breach.`)}
${h2('5. GOVERNING LAW')}
${p(`Governed by the laws of India, with exclusive jurisdiction of courts in New Delhi.`)}
${dualSig('Rajiv Malhotra', 'Managing Partner', 'Capital Growth Partners LLP', 'Akshay Kotish', 'Managing Partner', company.name)}`,
  },
];

// ─── HTML Page Wrapper ───────────────────────────────────────────────────────

function wrapPage(header, body, footer, watermark = null) {
  const watermarkCSS = watermark ? `
    .page::before {
      content: '${watermark}';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-35deg);
      font-size: 80px;
      font-weight: 900;
      color: rgba(220, 38, 38, 0.06);
      letter-spacing: 12px;
      font-family: Arial, sans-serif;
      pointer-events: none;
      z-index: 0;
      white-space: nowrap;
    }` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Document</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 210mm; min-height: 297mm; font-family: 'Poppins', Arial, sans-serif; background: #fff; color: #1a1a1a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page {
  width: 210mm;
  min-height: 297mm;
  padding: 18mm 20mm 24mm 20mm;
  position: relative;
  page-break-after: always;
  display: flex;
  flex-direction: column;
}
.header { flex-shrink: 0; margin-bottom: 14px; }
.body { flex: 1; padding: 6px 0; position: relative; z-index: 1; }
.footer { flex-shrink: 0; margin-top: auto; padding-top: 14px; }
table { border-collapse: collapse; }
${watermarkCSS}
</style>
</head>
<body>
<div class="page">
  <div class="header">${header}</div>
  <div class="body">${body}</div>
  <div class="footer">${footer}</div>
</div>
</body>
</html>`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\\n📄 Generating 10 production-quality PDFs...\\n');

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const results = [];

  for (const doc of documents) {
    const t0 = Date.now();
    const pdfPath = path.join(OUT_DIR, `${doc.name}.pdf`);
    const htmlPath = path.join(OUT_DIR, `${doc.name}.html`);

    try {
      const bodyHtml = doc.body();
      const fullHtml = wrapPage(doc.header, bodyHtml, doc.footer, doc.watermark || null);

      fs.writeFileSync(htmlPath, fullHtml, 'utf8');

      const page = await browser.newPage();
      await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      await new Promise(r => setTimeout(r, 500));

      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        preferCSSPageSize: true,
      });

      await page.close();

      const stats = fs.statSync(pdfPath);
      const sizeKB = (stats.size / 1024).toFixed(1);
      const elapsed = Date.now() - t0;
      const valid = stats.size > 5000;

      results.push({ name: doc.name, valid, sizeKB, elapsed });
      console.log(`  ${valid ? '✅' : '❌'} ${doc.name}.pdf — ${sizeKB} KB (${elapsed}ms)`);
    } catch (err) {
      results.push({ name: doc.name, valid: false, error: err.message });
      console.log(`  ❌ ${doc.name}.pdf — ERROR: ${err.message}`);
    }
  }

  await browser.close();

  const passed = results.filter(r => r.valid).length;
  const failed = results.filter(r => !r.valid).length;
  console.log(`\\n${'═'.repeat(60)}`);
  console.log(`📊 Results: ${passed} passed, ${failed} failed out of ${results.length}`);
  console.log(`📁 Output: ${OUT_DIR}/`);
  if (failed > 0) {
    console.log('\\n❌ Failed:');
    results.filter(r => !r.valid).forEach(r => console.log(`   - ${r.name}: ${r.error || 'Too small'}`));
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
