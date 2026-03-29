import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { sendEmail } from '../utils/mailer.js';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validator.js';

const router = Router();
router.use(verifyToken);

const RZP_KEY = process.env.RAZORPAY_KEY_ID;
const RZP_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RZP_AUTH = 'Basic ' + Buffer.from(`${RZP_KEY}:${RZP_SECRET}`).toString('base64');
const RZP_BASE = 'https://api.razorpay.com/v1';
const RZP_TIMEOUT = 30000; // 30 seconds

// Structured logger for payout events
function logPayoutEvent(eventType, data) {
  console.log(JSON.stringify({
    level: 'info',
    service: 'payouts',
    eventType,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

async function rzpFetch(endpoint, method = 'GET', body = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RZP_TIMEOUT);

  try {
    const opts = {
      method,
      headers: {
        'Authorization': RZP_AUTH,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${RZP_BASE}${endpoint}`, opts);
    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data.error?.description || JSON.stringify(data);
      throw new Error(errorMsg);
    }
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ===== CREATE CONTACT =====
router.post('/contacts', asyncHandler(async (req, res) => {
  const { name, email, phone, type, referenceId, notes } = req.body;

  if (!name || name.trim().length === 0) {
    throw new ValidationError('Contact name is required');
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new ValidationError('Invalid email format');
  }

  if (phone && !/^\+?\d{10,15}$/.test(phone.replace(/[\s-]/g, ''))) {
    throw new ValidationError('Invalid phone number format');
  }

  const contact = await rzpFetch('/contacts', 'POST', {
    name,
    email: email || undefined,
    contact: phone || undefined,
    type: type || 'employee',
    reference_id: referenceId || undefined,
    notes: notes || {},
  });

  logPayoutEvent('contact_created', {
    contactId: contact.id,
    name,
    email: email || 'none',
  });

  res.status(201).json(contact);
}));

// ===== CREATE FUND ACCOUNT =====
router.post('/fund-accounts', asyncHandler(async (req, res) => {
  const { contactId, accountType, bankAccount, vpa } = req.body;

  if (!contactId || contactId.trim().length === 0) {
    throw new ValidationError('Contact ID is required');
  }

  if (!accountType || !['bank_account', 'vpa'].includes(accountType)) {
    throw new ValidationError('Account type must be "bank_account" or "vpa"');
  }

  if (accountType === 'bank_account') {
    if (!bankAccount?.name || bankAccount.name.trim().length === 0) {
      throw new ValidationError('Bank account holder name is required');
    }
    if (!bankAccount?.ifsc || bankAccount.ifsc.trim().length === 0) {
      throw new ValidationError('IFSC code is required');
    }
    if (!bankAccount?.accountNumber || bankAccount.accountNumber.trim().length === 0) {
      throw new ValidationError('Account number is required');
    }

    // Validate IFSC: 11 chars, format: AAAA0XXXXXX
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(bankAccount.ifsc.toUpperCase())) {
      throw new ValidationError(
        'Invalid IFSC format. Must be 11 characters: 4 letters + 0 + 6 alphanumeric characters (e.g., SBIN0001234)'
      );
    }

    // Validate account number: 9-18 digits
    const acctNum = bankAccount.accountNumber.replace(/\s/g, '');
    if (!/^\d{9,18}$/.test(acctNum)) {
      throw new ValidationError('Account number must be 9-18 digits');
    }
  } else if (accountType === 'vpa') {
    if (!vpa || vpa.trim().length === 0) {
      throw new ValidationError('VPA address is required');
    }
    if (!/^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(vpa.trim())) {
      throw new ValidationError('Invalid UPI/VPA format (e.g., user@paytm)');
    }
  }

  const payload = { contact_id: contactId, account_type: accountType };

  if (accountType === 'bank_account') {
    payload.bank_account = {
      name: bankAccount.name,
      ifsc: bankAccount.ifsc.toUpperCase(),
      account_number: bankAccount.accountNumber.replace(/\s/g, ''),
    };
  } else if (accountType === 'vpa') {
    payload.vpa = { address: vpa };
  }

  const fundAccount = await rzpFetch('/fund_accounts', 'POST', payload);

  logPayoutEvent('fund_account_created', {
    fundAccountId: fundAccount.id,
    contactId,
    accountType,
  });

  res.status(201).json(fundAccount);
}));

// ===== CREATE PAYOUT =====
router.post('/payouts', asyncHandler(async (req, res) => {
  const { fundAccountId, amount, currency, mode, purpose, referenceId, narration, notes } = req.body;

  if (!fundAccountId || fundAccountId.trim().length === 0) {
    throw new ValidationError('Fund account ID is required');
  }

  if (!amount || amount <= 0) {
    throw new ValidationError('Amount must be greater than 0');
  }

  if (!process.env.RAZORPAY_ACCOUNT_NUMBER || process.env.RAZORPAY_ACCOUNT_NUMBER.trim().length === 0) {
    throw new ValidationError('Razorpay account number not configured');
  }

  const payout = await rzpFetch('/payouts', 'POST', {
    account_number: process.env.RAZORPAY_ACCOUNT_NUMBER,
    fund_account_id: fundAccountId,
    amount: Math.round(amount * 100), // Convert to paise
    currency: currency || 'INR',
    mode: mode || 'NEFT',
    purpose: purpose || 'salary',
    reference_id: referenceId || undefined,
    narration: narration || 'Salary Payment',
    notes: notes || {},
  });

  // Save payout record
  await db.collection('payouts').add({
    razorpayPayoutId: payout.id,
    fundAccountId,
    amount,
    currency: currency || 'INR',
    mode: mode || 'NEFT',
    purpose: purpose || 'salary',
    status: payout.status,
    referenceId: referenceId || '',
    narration: narration || '',
    notes: notes || {},
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  });

  logPayoutEvent('payout_created', {
    payoutId: payout.id,
    fundAccountId,
    amount,
    mode: mode || 'NEFT',
  });

  res.status(201).json(payout);
}));

// ===== BULK SALARY PAYOUT =====
router.post('/bulk-salary', asyncHandler(async (req, res) => {
  const { payrollIds, mode, sendSlips } = req.body;

  if (!payrollIds || !Array.isArray(payrollIds) || payrollIds.length === 0) {
    throw new ValidationError('No payroll records selected');
  }

  const razorpayConfigured = !!(process.env.RAZORPAY_ACCOUNT_NUMBER && process.env.RAZORPAY_ACCOUNT_NUMBER.trim());

  const results = { success: [], failed: [], emailsSent: [] };

  for (const payrollId of payrollIds) {
    try {
      // Get payroll record
      const payrollDoc = await db.collection('payroll').doc(payrollId).get();
      if (!payrollDoc.exists) {
        results.failed.push({ payrollId, error: 'Payroll record not found' });
        continue;
      }
      const payroll = payrollDoc.data();

      if (payroll.status === 'Paid') {
        results.failed.push({ payrollId, error: `Already paid (${payroll.employeeId})` });
        continue;
      }

      // Get employee
      const empDoc = await db.collection('employees').doc(payroll.employeeId).get();
      if (!empDoc.exists) {
        results.failed.push({ payrollId, error: 'Employee not found' });
        continue;
      }
      const emp = empDoc.data();

      // Validate bank details before proceeding
      if (!emp.bankDetails?.accountNumber || !emp.bankDetails?.ifsc) {
        results.failed.push({ payrollId, error: `No bank details for ${emp.name}` });
        continue;
      }

      // Validate IFSC format: 11 chars, starts with 4 alpha + 0 + 6 alphanum (e.g. SBIN0001234)
      const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
      if (!ifscRegex.test(emp.bankDetails.ifsc.toUpperCase())) {
        results.failed.push({
          payrollId,
          error: `Invalid IFSC format for ${emp.name}: "${emp.bankDetails.ifsc}" (must be 11 characters: 4 letters + 0 + 6 alphanumeric)`,
        });
        continue;
      }

      // Validate account number: 9-18 digits
      const acctNum = emp.bankDetails.accountNumber.replace(/\s/g, '');
      if (!/^\d{9,18}$/.test(acctNum)) {
        results.failed.push({
          payrollId,
          error: `Invalid account number for ${emp.name}: must be 9-18 digits`,
        });
        continue;
      }

      if (razorpayConfigured) {
        // ---- Razorpay X payout flow ----
        // Check if employee has Razorpay fund account
        if (!emp.razorpayFundAccountId) {
          try {
            const contact = await rzpFetch('/contacts', 'POST', {
              name: emp.name,
              email: emp.email || undefined,
              contact: emp.phone || undefined,
              type: 'employee',
              reference_id: payroll.employeeId,
            });

            const fundAccount = await rzpFetch('/fund_accounts', 'POST', {
              contact_id: contact.id,
              account_type: 'bank_account',
              bank_account: {
                name: emp.bankDetails.accountName || emp.name,
                ifsc: emp.bankDetails.ifsc.toUpperCase(),
                account_number: acctNum,
              },
            });

            // Save to employee
            await db.collection('employees').doc(payroll.employeeId).update({
              razorpayContactId: contact.id,
              razorpayFundAccountId: fundAccount.id,
              updatedAt: new Date().toISOString(),
            });
            emp.razorpayFundAccountId = fundAccount.id;
            emp.razorpayContactId = contact.id;

            logPayoutEvent('employee_fund_account_created', {
              employeeId: payroll.employeeId,
              contactId: contact.id,
              fundAccountId: fundAccount.id,
            });
          } catch (rzpErr) {
            results.failed.push({ payrollId, error: `Razorpay setup failed for ${emp.name}: ${rzpErr.message}` });
            continue;
          }
        }

        // Create payout via Razorpay
        let payout;
        try {
          payout = await rzpFetch('/payouts', 'POST', {
            account_number: process.env.RAZORPAY_ACCOUNT_NUMBER,
            fund_account_id: emp.razorpayFundAccountId,
            amount: Math.round(payroll.netSalary * 100),
            currency: 'INR',
            mode: mode || 'NEFT',
            purpose: 'salary',
            reference_id: `SAL-${payroll.month}-${payroll.employeeId.substring(0, 8)}`,
            narration: `Salary ${payroll.month} - ${emp.name}`,
          });
        } catch (payoutErr) {
          results.failed.push({ payrollId, error: `Payout failed for ${emp.name}: ${payoutErr.message}` });
          continue;
        }

        // Update payroll status
        await db.collection('payroll').doc(payrollId).update({
          status: 'Paid',
          paidAt: new Date().toISOString(),
          razorpayPayoutId: payout.id,
          payoutStatus: payout.status,
          updatedAt: new Date().toISOString(),
        });

        // Create payment record
        await db.collection('payments').add({
          paymentId: `SAL-${payout.id}`,
          amount: payroll.netSalary,
          type: 'outgoing',
          method: mode || 'NEFT',
          reference: payout.id,
          description: `Salary ${payroll.month} - ${emp.name}`,
          payrollId,
          employeeId: payroll.employeeId,
          status: 'completed',
          source: 'razorpay_payout',
          createdAt: new Date().toISOString(),
        });

        // Save payout record
        await db.collection('payouts').add({
          razorpayPayoutId: payout.id,
          fundAccountId: emp.razorpayFundAccountId,
          amount: payroll.netSalary,
          currency: 'INR',
          mode: mode || 'NEFT',
          purpose: 'salary',
          status: payout.status,
          employeeId: payroll.employeeId,
          employeeName: emp.name,
          payrollId,
          month: payroll.month,
          createdBy: req.user.uid,
          createdAt: new Date().toISOString(),
        });

        logPayoutEvent('salary_payout_completed', {
          payoutId: payout.id,
          employeeId: payroll.employeeId,
          employeeName: emp.name,
          amount: payroll.netSalary,
          month: payroll.month,
        });

        results.success.push({ payrollId, payoutId: payout.id, employee: emp.name, amount: payroll.netSalary });
      } else {
        // ---- Manual fallback: Razorpay X not configured ----
        const manualRef = `MANUAL-${payroll.month}-${payroll.employeeId.substring(0, 8)}-${Date.now()}`;

        await db.collection('payroll').doc(payrollId).update({
          status: 'Paid',
          paidAt: new Date().toISOString(),
          payoutMode: 'manual',
          updatedAt: new Date().toISOString(),
        });

        // Create payment record
        await db.collection('payments').add({
          paymentId: manualRef,
          amount: payroll.netSalary,
          type: 'outgoing',
          method: 'manual',
          reference: manualRef,
          description: `Salary ${payroll.month} - ${emp.name} (manual - Razorpay not configured)`,
          payrollId,
          employeeId: payroll.employeeId,
          status: 'completed',
          source: 'manual',
          createdAt: new Date().toISOString(),
        });

        logPayoutEvent('salary_marked_paid_manual', {
          manualRef,
          employeeId: payroll.employeeId,
          employeeName: emp.name,
          amount: payroll.netSalary,
        });

        results.success.push({ payrollId, payoutId: manualRef, employee: emp.name, amount: payroll.netSalary, mode: 'manual' });
      }

      // Send salary slip email (regardless of Razorpay or manual)
      if (sendSlips && emp.email) {
        try {
          const monthLabel = new Date(payroll.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
          const formatINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n || 0);

          await sendEmail({
            to: emp.email,
            subject: `Salary Slip - ${monthLabel} | Akshay Kotish & Co.`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                <div style="background:#1e293b;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
                  <h1 style="margin:0;font-size:20px;">Akshay Kotish & Co.</h1>
                  <p style="margin:4px 0 0;opacity:0.8;font-size:14px;">Salary Slip for ${monthLabel}</p>
                </div>
                <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
                  <p style="margin:0 0 16px;font-size:14px;">Dear <strong>${emp.name}</strong>,</p>
                  <p style="margin:0 0 20px;font-size:14px;color:#475569;">Your salary for <strong>${monthLabel}</strong> has been processed. Please find the details below.</p>
                  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                    <tr style="background:#f8fafc;">
                      <td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;color:#059669;" colspan="2">Earnings</td>
                    </tr>
                    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;">Basic Salary</td><td style="padding:8px 14px;border:1px solid #e2e8f0;text-align:right;">${formatINR(payroll.basic)}</td></tr>
                    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;">HRA</td><td style="padding:8px 14px;border:1px solid #e2e8f0;text-align:right;">${formatINR(payroll.hra)}</td></tr>
                    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;">DA</td><td style="padding:8px 14px;border:1px solid #e2e8f0;text-align:right;">${formatINR(payroll.da)}</td></tr>
                    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;">Other Allowances</td><td style="padding:8px 14px;border:1px solid #e2e8f0;text-align:right;">${formatINR(payroll.other)}</td></tr>
                    <tr style="background:#f0fdf4;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:700;">Gross Salary</td><td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#059669;">${formatINR(payroll.grossSalary)}</td></tr>
                    <tr style="background:#f8fafc;">
                      <td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;color:#dc2626;" colspan="2">Deductions</td>
                    </tr>
                    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;">Provident Fund</td><td style="padding:8px 14px;border:1px solid #e2e8f0;text-align:right;">${formatINR(payroll.deductions?.pf)}</td></tr>
                    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;">Professional Tax</td><td style="padding:8px 14px;border:1px solid #e2e8f0;text-align:right;">${formatINR(payroll.deductions?.tax)}</td></tr>
                    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;">Other Deductions</td><td style="padding:8px 14px;border:1px solid #e2e8f0;text-align:right;">${formatINR(payroll.deductions?.other)}</td></tr>
                    <tr style="background:#fef2f2;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:700;">Total Deductions</td><td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#dc2626;">${formatINR(payroll.totalDeductions)}</td></tr>
                  </table>
                  <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:8px;padding:16px;text-align:center;margin:20px 0;">
                    <div style="font-size:14px;color:#374151;margin-bottom:4px;">Net Salary Payable</div>
                    <div style="font-size:28px;font-weight:800;color:#059669;">${formatINR(payroll.netSalary)}</div>
                  </div>
                  <p style="font-size:12px;color:#94a3b8;margin:16px 0 0;">This is a system-generated salary slip. For any queries, please contact HR.</p>
                </div>
              </div>`,
          });
          results.emailsSent.push(emp.email);

          logPayoutEvent('salary_slip_email_sent', {
            to: emp.email,
            employeeId: payroll.employeeId,
            month: payroll.month,
          });

          // Log sent email
          await db.collection('sent_emails').add({
            to: emp.email,
            subject: `Salary Slip - ${monthLabel}`,
            type: 'salary_slip',
            employeeId: payroll.employeeId,
            payrollId,
            sentBy: req.user.uid,
            sentAt: new Date().toISOString(),
          });
        } catch (emailErr) {
          console.error(`Email failed for ${emp.email}:`, emailErr.message);
          logPayoutEvent('salary_slip_email_failed', {
            to: emp.email,
            employeeId: payroll.employeeId,
            error: emailErr.message,
          });
        }
      }
    } catch (err) {
      results.failed.push({ payrollId, error: err.message });
      logPayoutEvent('payroll_processing_error', {
        payrollId,
        error: err.message,
      });
    }
  }

  res.json(results);
}));

// ===== GET PAYOUTS =====
router.get('/', asyncHandler(async (req, res) => {
  const snapshot = await db.collection('payouts')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  const results = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(results);
}));

// ===== GET PAYOUT STATUS =====
router.get('/:payoutId', asyncHandler(async (req, res) => {
  const { payoutId } = req.params;

  if (!payoutId || payoutId.trim().length === 0) {
    throw new ValidationError('Payout ID is required');
  }

  const payout = await rzpFetch(`/payouts/${payoutId}`);
  res.json(payout);
}));

export default router;
