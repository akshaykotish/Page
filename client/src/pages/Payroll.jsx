import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, where } from 'firebase/firestore';
import { formatCurrency, formatDate, getStatusColor, getCurrentMonth } from '../utils/formatters';
import { api } from '../utils/api';

const PAYROLL_STATUSES = ['Pending', 'Processed', 'Paid'];

export default function Payroll() {
  const [employees, setEmployees] = useState([]);
  const [payrollRecords, setPayrollRecords] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [viewingPayslip, setViewingPayslip] = useState(null);
  const [paying, setPaying] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState(new Set());
  const [emailingSingle, setEmailingSingle] = useState(null);
  const payslipRef = useRef(null);

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    if (selectedMonth) {
      fetchPayroll();
    }
  }, [selectedMonth]);

  async function fetchEmployees() {
    try {
      const q = query(collection(db, 'employees'), orderBy('name'));
      const snapshot = await getDocs(q);
      setEmployees(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  }

  async function fetchPayroll() {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'payroll'),
        where('month', '==', selectedMonth)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setPayrollRecords(data);
    } catch (err) {
      console.error('Error fetching payroll:', err);
      setPayrollRecords([]);
    } finally {
      setLoading(false);
    }
  }

  // Build a lookup from employee id to employee data
  const employeeMap = useMemo(() => {
    const map = {};
    employees.forEach(e => { map[e.id] = e; });
    return map;
  }, [employees]);

  async function handleGeneratePayroll() {
    if (!selectedMonth) return;
    if (payrollRecords.length > 0) {
      if (!window.confirm(`Payroll records already exist for ${selectedMonth}. This will regenerate missing ones. Continue?`)) return;
    }

    setGenerating(true);
    try {
      const activeEmployees = employees.filter(e => e.status === 'active');
      const existingEmployeeIds = new Set(payrollRecords.map(r => r.employeeId));
      let created = 0;

      for (const emp of activeEmployees) {
        if (existingEmployeeIds.has(emp.id)) continue;

        const basic = Number(emp.salary?.basic) || 0;
        const hra = Number(emp.salary?.hra) || 0;
        const da = Number(emp.salary?.da) || 0;
        const other = Number(emp.salary?.other) || 0;
        const grossSalary = basic + hra + da + other;

        const pf = Math.round(basic * 0.12);
        const tax = basic > 25000 ? 200 : 0; // Professional Tax simplified
        const otherDeductions = 0;
        const totalDeductions = pf + tax + otherDeductions;
        const netSalary = grossSalary - totalDeductions;

        const payload = {
          employeeId: emp.id,
          month: selectedMonth,
          basic,
          hra,
          da,
          other,
          grossSalary,
          deductions: {
            pf,
            tax,
            other: otherDeductions
          },
          totalDeductions,
          netSalary,
          status: 'Pending',
          createdAt: new Date().toISOString()
        };

        await addDoc(collection(db, 'payroll'), payload);
        created++;
      }

      await fetchPayroll();
      if (created > 0) {
        alert(`Payroll generated for ${created} employee(s).`);
      } else {
        alert('All active employees already have payroll records for this month.');
      }
    } catch (err) {
      console.error('Error generating payroll:', err);
      alert('Error generating payroll. Check console for details.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleUpdateStatus(record, newStatus) {
    try {
      const updates = {
        status: newStatus,
        updatedAt: new Date().toISOString()
      };

      if (newStatus === 'Paid') {
        updates.paidAt = new Date().toISOString();
      }

      await updateDoc(doc(db, 'payroll', record.id), updates);

      // If marking as Paid, create a payment record
      if (newStatus === 'Paid') {
        const emp = employeeMap[record.employeeId];
        await addDoc(collection(db, 'payments'), {
          type: 'salary',
          payrollId: record.id,
          employeeId: record.employeeId,
          employeeName: emp?.name || 'Unknown',
          amount: record.netSalary,
          month: record.month,
          description: `Salary payment for ${record.month} - ${emp?.name || 'Unknown'}`,
          status: 'completed',
          paidAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        });
      }

      await fetchPayroll();
    } catch (err) {
      console.error('Error updating payroll status:', err);
    }
  }

  async function handleUpdateDeductions(record, field, value) {
    try {
      const newDeductions = { ...record.deductions, [field]: Number(value) || 0 };
      const totalDeductions = newDeductions.pf + newDeductions.tax + newDeductions.other;
      const netSalary = record.grossSalary - totalDeductions;

      await updateDoc(doc(db, 'payroll', record.id), {
        deductions: newDeductions,
        totalDeductions,
        netSalary,
        updatedAt: new Date().toISOString()
      });
      await fetchPayroll();
    } catch (err) {
      console.error('Error updating deductions:', err);
    }
  }

  function handleViewPayslip(record) {
    setViewingPayslip(viewingPayslip?.id === record.id ? null : record);
  }

  function handlePrintPayslip() {
    if (!viewingPayslip) return;
    const emp = employeeMap[viewingPayslip.employeeId];
    const html = buildPayslipHTML(viewingPayslip, emp);
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<html><head><title>Payslip - ${selectedMonth}</title></head><body>${html}</body></html>`);
    printWindow.document.close();
    printWindow.print();
  }

  async function handleEmailPayslipPDF(record) {
    const emp = employeeMap[record?.employeeId || viewingPayslip?.employeeId];
    const rec = record || viewingPayslip;
    if (!rec) {
      alert('No payroll record selected.');
      return;
    }
    if (!emp) {
      alert('Employee record not found. Cannot send email.');
      return;
    }
    if (!emp.email || !emp.email.trim()) {
      alert(`No email address on file for ${emp.name || 'this employee'}. Please add an email in the Employees page first.`);
      return;
    }

    const ml = selectedMonth ? new Date(selectedMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '';

    if (!window.confirm(`Email payslip to ${emp.email}?`)) return;

    setEmailingSingle(rec.id);
    try {
      const html = buildPayslipHTML(rec, emp);
      await api.post('/mail/send', {
        to: emp.email,
        subject: `Payslip - ${ml} | Akshay Kotish & Co.`,
        html: html,
      });
      alert(`Payslip emailed to ${emp.email}`);
    } catch (err) {
      alert('Failed to send email: ' + (err.message || 'Unknown error'));
    }
    setEmailingSingle(null);
  }

  function buildPayslipHTML(record, emp) {
    const ml = selectedMonth
      ? new Date(selectedMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      : '';
    const fmtCur = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(v || 0);
    const stampUrl = window.location.origin + '/images/stamp_nobroder_1x.png';

    return `
      <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 760px; margin: 0 auto; color: #1a1a1a;">
        <!-- Company Letterhead Header -->
        <div style="border-bottom: 4px solid #2e7d32; padding-bottom: 16px; margin-bottom: 24px;">
          <table style="width: 100%; border: none; border-collapse: collapse;">
            <tr>
              <td style="vertical-align: top; border: none; padding: 0;">
                <h1 style="font-family: 'Georgia', serif; font-size: 26px; font-weight: 900; color: #1a1a1a; margin: 0 0 2px;">Akshay Kotish & Co.</h1>
                <div style="font-size: 11px; color: #888; font-style: italic; margin-bottom: 4px;">Akshay Lakshay Kotish Private Limited</div>
                <div style="font-size: 12px; color: #555; line-height: 1.7;">
                  CIN: U72900HR2022PTC101170<br/>
                  GSTIN: 06AAWCA4919K1Z3<br/>
                  H.No. 61A/11, Gali No. 4, Nehru Garden Colony, Kaithal, Haryana - 136027
                </div>
              </td>
              <td style="text-align: right; vertical-align: top; border: none; padding: 0;">
                <div style="font-size: 11px; color: #666; line-height: 1.8; text-align: right;">
                  akshaykotish@gmail.com<br/>
                  +91 98967 70369<br/>
                  www.akshaykotish.com
                </div>
              </td>
            </tr>
          </table>
        </div>

        <!-- Document Title -->
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="font-family: 'Georgia', serif; font-size: 20px; font-weight: 700; color: #2e7d32; margin: 0; letter-spacing: 2px; text-transform: uppercase;">Salary Slip</h2>
          <div style="font-size: 13px; color: #666; margin-top: 4px;">For the month of <strong>${ml}</strong></div>
        </div>

        <!-- Employee Details -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; border: 1px solid #e0e0e0;">
          <tr style="background: #f8f8f8;">
            <td style="padding: 8px 12px; color: #666; width: 25%; border: 1px solid #e0e0e0; font-weight: 600;">Employee Name</td>
            <td style="padding: 8px 12px; font-weight: 700; border: 1px solid #e0e0e0;">${emp?.name || 'Unknown'}</td>
            <td style="padding: 8px 12px; color: #666; width: 20%; border: 1px solid #e0e0e0; font-weight: 600;">Department</td>
            <td style="padding: 8px 12px; font-weight: 700; border: 1px solid #e0e0e0;">${emp?.department || '--'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; color: #666; border: 1px solid #e0e0e0; font-weight: 600;">Designation</td>
            <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">${emp?.role || '--'}</td>
            <td style="padding: 8px 12px; color: #666; border: 1px solid #e0e0e0; font-weight: 600;">PAN</td>
            <td style="padding: 8px 12px; font-family: monospace; border: 1px solid #e0e0e0;">${emp?.pan || '--'}</td>
          </tr>
          <tr style="background: #f8f8f8;">
            <td style="padding: 8px 12px; color: #666; border: 1px solid #e0e0e0; font-weight: 600;">UAN</td>
            <td style="padding: 8px 12px; font-family: monospace; border: 1px solid #e0e0e0;">${emp?.uan || '--'}</td>
            <td style="padding: 8px 12px; color: #666; border: 1px solid #e0e0e0; font-weight: 600;">Bank A/C</td>
            <td style="padding: 8px 12px; font-family: monospace; border: 1px solid #e0e0e0;">${emp?.bankDetails?.accountNumber || '--'} (${emp?.bankDetails?.ifsc || '--'})</td>
          </tr>
        </table>

        <!-- Earnings & Deductions Table -->
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; border: 1px solid #e0e0e0;">
          <thead>
            <tr>
              <th style="padding: 10px 12px; text-align: left; font-weight: 700; color: #fff; background: #2e7d32; border: 1px solid #2e7d32;" colspan="2">Earnings</th>
              <th style="padding: 10px 12px; text-align: left; font-weight: 700; color: #fff; background: #c62828; border: 1px solid #c62828;" colspan="2">Deductions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">Basic Salary</td>
              <td style="padding: 8px 12px; text-align: right; font-family: monospace; border: 1px solid #e0e0e0;">${fmtCur(record.basic)}</td>
              <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">Provident Fund (12%)</td>
              <td style="padding: 8px 12px; text-align: right; font-family: monospace; border: 1px solid #e0e0e0;">${fmtCur(record.deductions?.pf)}</td>
            </tr>
            <tr style="background: #fafafa;">
              <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">HRA</td>
              <td style="padding: 8px 12px; text-align: right; font-family: monospace; border: 1px solid #e0e0e0;">${fmtCur(record.hra)}</td>
              <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">Professional Tax</td>
              <td style="padding: 8px 12px; text-align: right; font-family: monospace; border: 1px solid #e0e0e0;">${fmtCur(record.deductions?.tax)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">DA</td>
              <td style="padding: 8px 12px; text-align: right; font-family: monospace; border: 1px solid #e0e0e0;">${fmtCur(record.da)}</td>
              <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">Other Deductions</td>
              <td style="padding: 8px 12px; text-align: right; font-family: monospace; border: 1px solid #e0e0e0;">${fmtCur(record.deductions?.other)}</td>
            </tr>
            <tr style="background: #fafafa;">
              <td style="padding: 8px 12px; border: 1px solid #e0e0e0;">Other Allowances</td>
              <td style="padding: 8px 12px; text-align: right; font-family: monospace; border: 1px solid #e0e0e0;">${fmtCur(record.other)}</td>
              <td style="padding: 8px 12px; border: 1px solid #e0e0e0;"></td>
              <td style="padding: 8px 12px; border: 1px solid #e0e0e0;"></td>
            </tr>
          </tbody>
          <tfoot>
            <tr style="background: #f0f0f0;">
              <td style="padding: 10px 12px; font-weight: 700; border: 1px solid #e0e0e0;">Gross Salary</td>
              <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #2e7d32; font-family: monospace; border: 1px solid #e0e0e0;">${fmtCur(record.grossSalary)}</td>
              <td style="padding: 10px 12px; font-weight: 700; border: 1px solid #e0e0e0;">Total Deductions</td>
              <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #c62828; font-family: monospace; border: 1px solid #e0e0e0;">${fmtCur(record.totalDeductions)}</td>
            </tr>
          </tfoot>
        </table>

        <!-- Net Salary -->
        <div style="background: #e8f5e9; border: 2px solid #2e7d32; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 24px;">
          <div style="font-size: 13px; color: #1a1a1a; margin-bottom: 4px; font-weight: 600;">Net Salary Payable</div>
          <div style="font-size: 28px; font-weight: 900; color: #2e7d32; font-family: monospace;">${fmtCur(record.netSalary)}</div>
        </div>

        ${record.paidAt ? `<div style="font-size: 12px; color: #666; text-align: right; margin-bottom: 16px;">Payment Date: <strong>${new Date(record.paidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</strong></div>` : ''}

        <!-- Stamp & Signature -->
        <div style="margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-end;">
          <div style="font-size: 11px; color: #999; max-width: 300px; line-height: 1.6;">
            This is a computer-generated salary slip from the ERP system of Akshay Kotish & Co. and does not require a physical signature.
          </div>
          <div style="text-align: center;">
            <img src="${stampUrl}" alt="Official Stamp" style="width: 100px; height: auto; margin-bottom: 8px; opacity: 0.85;" />
            <div style="border-top: 1px solid #999; padding-top: 6px; font-size: 11px; color: #555; min-width: 180px;">
              Authorized Signatory<br/>
              <strong style="color: #1a1a1a;">Akshay Kotish & Co.</strong>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="margin-top: 30px; padding-top: 12px; border-top: 2px solid #2e7d32; text-align: center; font-size: 10px; color: #888; line-height: 1.6;">
          Akshay Kotish & Co. | CIN: U72900HR2022PTC101170 | GSTIN: 06AAWCA4919K1Z3 | akshaykotish@gmail.com | www.akshaykotish.com
        </div>
      </div>
    `;
  }

  async function handleBulkPay() {
    let payrollIds;
    if (selectedRecords.size > 0) {
      payrollIds = Array.from(selectedRecords);
    } else {
      // Default to all Processed records
      payrollIds = payrollRecords.filter(r => r.status === 'Processed').map(r => r.id);
    }

    if (payrollIds.length === 0) {
      alert('No payroll records selected or available for payment.');
      return;
    }

    // Validate that selected employees have bank details before calling API
    const missingBankDetails = [];
    const validPayrollIds = [];
    for (const pid of payrollIds) {
      const record = payrollRecords.find(r => r.id === pid);
      if (!record) continue;
      const emp = employeeMap[record.employeeId];
      if (!emp) {
        missingBankDetails.push(`Unknown employee (payroll ${pid}): employee record not found`);
        continue;
      }
      if (!emp.bankDetails?.accountNumber || !emp.bankDetails?.ifsc) {
        missingBankDetails.push(`${emp.name}: missing bank account number or IFSC`);
      } else {
        validPayrollIds.push(pid);
      }
    }

    if (missingBankDetails.length > 0) {
      const proceed = validPayrollIds.length > 0;
      const msg = `The following employees are missing bank details and will be skipped:\n\n${missingBankDetails.join('\n')}${proceed ? `\n\nProceed with ${validPayrollIds.length} valid employee(s)?` : '\n\nNo valid employees to pay.'}`;
      if (!proceed) {
        alert(msg);
        return;
      }
      if (!window.confirm(msg)) return;
    } else {
      if (!window.confirm(`Pay ${validPayrollIds.length} record(s) via Razorpay NEFT?`)) return;
    }

    if (validPayrollIds.length === 0) {
      alert('No employees with valid bank details to process.');
      return;
    }

    setPaying(true);
    try {
      const result = await api.post('/payouts/bulk-salary', {
        payrollIds: validPayrollIds,
        mode: 'NEFT',
        sendSlips: true
      });

      const successList = Array.isArray(result.success) ? result.success : [];
      const failedList = Array.isArray(result.failed) ? result.failed : [];
      const emailsSentList = Array.isArray(result.emailsSent) ? result.emailsSent : [];

      let alertMsg = `Bulk Pay Complete!\n\nSuccess: ${successList.length}\nFailed: ${failedList.length}\nEmails Sent: ${emailsSentList.length}`;

      if (failedList.length > 0) {
        alertMsg += '\n\nFailed details:';
        failedList.forEach(f => {
          alertMsg += `\n- ${f.error || 'Unknown error'}`;
        });
      }

      alert(alertMsg);

      setSelectedRecords(new Set());
      await fetchPayroll();
    } catch (err) {
      console.error('Error in bulk pay:', err);
      const errorMsg = err?.response?.data?.error || err.message || 'Unknown error';
      alert('Error processing bulk pay: ' + errorMsg);
    } finally {
      setPaying(false);
    }
  }

  async function handleSendSlipEmail(record) {
    const emp = employeeMap[record.employeeId];
    if (!emp) {
      alert('Employee record not found. Cannot send email.');
      return;
    }
    if (!emp.email || !emp.email.trim()) {
      alert(`No email address on file for ${emp.name || 'this employee'}. Please add an email in the Employees page first.`);
      return;
    }

    setEmailingSingle(record.id);
    try {
      const ml = selectedMonth
        ? new Date(selectedMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        : selectedMonth;

      const subject = `Salary Slip - ${ml} | Akshay Kotish & Co.`;
      const html = buildPayslipHTML(record, emp);

      await api.post('/mail/send', { to: emp.email, subject, html });
      alert(`Payslip emailed to ${emp.email}`);
    } catch (err) {
      console.error('Error sending payslip email:', err);
      alert('Error sending email: ' + err.message);
    } finally {
      setEmailingSingle(null);
    }
  }

  function toggleSelectRecord(id) {
    setSelectedRecords(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedRecords.size === payrollRecords.length) {
      setSelectedRecords(new Set());
    } else {
      setSelectedRecords(new Set(payrollRecords.map(r => r.id)));
    }
  }

  // Summary totals
  const totals = useMemo(() => {
    return payrollRecords.reduce((acc, r) => ({
      gross: acc.gross + (r.grossSalary || 0),
      deductions: acc.deductions + (r.totalDeductions || 0),
      net: acc.net + (r.netSalary || 0),
      pending: acc.pending + (r.status === 'Pending' ? 1 : 0),
      processed: acc.processed + (r.status === 'Processed' ? 1 : 0),
      paid: acc.paid + (r.status === 'Paid' ? 1 : 0)
    }), { gross: 0, deductions: 0, net: 0, pending: 0, processed: 0, paid: 0 });
  }, [payrollRecords]);

  const monthLabel = selectedMonth
    ? new Date(selectedMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="page-payroll">
      {/* Controls */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Month</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
          />
        </div>
        <button
          onClick={handleGeneratePayroll}
          disabled={generating}
          style={{
            padding: '8px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px',
            cursor: 'pointer', fontWeight: '600', fontSize: '14px', opacity: generating ? 0.7 : 1
          }}
        >
          {generating ? 'Generating...' : 'Generate Payroll'}
        </button>
        <button
          onClick={handleBulkPay}
          disabled={paying}
          style={{
            padding: '8px 24px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px',
            cursor: 'pointer', fontWeight: '600', fontSize: '14px', opacity: paying ? 0.7 : 1
          }}
        >
          {paying ? 'Processing...' : 'Pay via Razorpay'}
        </button>
        {selectedRecords.size > 0 && (
          <span style={{ fontSize: '13px', color: '#2563eb', fontWeight: '600', alignSelf: 'center' }}>
            {selectedRecords.size} selected
          </span>
        )}
        <div style={{ marginLeft: 'auto', fontSize: '13px', color: '#6b7280' }}>
          {payrollRecords.length} record(s) for {monthLabel}
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#2563eb' }}>{formatCurrency(totals.gross)}</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Gross</div>
        </div>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#ef4444' }}>{formatCurrency(totals.deductions)}</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Deductions</div>
        </div>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#22c55e' }}>{formatCurrency(totals.net)}</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Net Pay</div>
        </div>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <span style={{ color: '#f59e0b', fontWeight: '700' }}>{totals.pending}</span>
            <span style={{ color: '#a78bfa', fontWeight: '700' }}>{totals.processed}</span>
            <span style={{ color: '#22c55e', fontWeight: '700' }}>{totals.paid}</span>
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Pending / Processed / Paid</div>
        </div>
      </div>

      {/* Payroll Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '600', color: '#374151', width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={payrollRecords.length > 0 && selectedRecords.size === payrollRecords.length}
                    onChange={toggleSelectAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', color: '#374151', whiteSpace: 'nowrap' }}>Employee</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>Basic</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>HRA</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>DA</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>Other</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151', background: '#f0f9ff' }}>Gross</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>PF</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>Tax</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>Ded. Other</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151', background: '#fef2f2' }}>Deductions</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#374151', background: '#f0fdf4' }}>Net Salary</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>Status</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="14" style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading payroll...</td>
                </tr>
              ) : payrollRecords.length === 0 ? (
                <tr>
                  <td colSpan="14" style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
                    No payroll records for {monthLabel}. Click "Generate Payroll" to create them.
                  </td>
                </tr>
              ) : (
                payrollRecords.map(record => {
                  const emp = employeeMap[record.employeeId];
                  const statusColor = record.status === 'Paid' ? '#22c55e' : record.status === 'Processed' ? '#a78bfa' : '#f59e0b';
                  const statusBg = record.status === 'Paid' ? '#f0fdf4' : record.status === 'Processed' ? '#f5f3ff' : '#fffbeb';

                  return (
                    <tr key={record.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedRecords.has(record.id)}
                          onChange={() => toggleSelectRecord(record.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: '500', whiteSpace: 'nowrap' }}>
                        <div>{emp?.name || 'Unknown'}</div>
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>{emp?.department || ''}</div>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(record.basic)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(record.hra)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(record.da)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(record.other)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', fontVariantNumeric: 'tabular-nums', background: '#f0f9ff' }}>{formatCurrency(record.grossSalary)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {record.status === 'Pending' ? (
                          <input
                            type="number"
                            defaultValue={record.deductions?.pf || 0}
                            onBlur={e => handleUpdateDeductions(record, 'pf', e.target.value)}
                            style={{ width: '80px', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', textAlign: 'right' }}
                          />
                        ) : (
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(record.deductions?.pf)}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {record.status === 'Pending' ? (
                          <input
                            type="number"
                            defaultValue={record.deductions?.tax || 0}
                            onBlur={e => handleUpdateDeductions(record, 'tax', e.target.value)}
                            style={{ width: '80px', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', textAlign: 'right' }}
                          />
                        ) : (
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(record.deductions?.tax)}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {record.status === 'Pending' ? (
                          <input
                            type="number"
                            defaultValue={record.deductions?.other || 0}
                            onBlur={e => handleUpdateDeductions(record, 'other', e.target.value)}
                            style={{ width: '80px', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', textAlign: 'right' }}
                          />
                        ) : (
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(record.deductions?.other)}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: '#ef4444', fontVariantNumeric: 'tabular-nums', background: '#fef2f2' }}>{formatCurrency(record.totalDeductions)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', color: '#059669', fontVariantNumeric: 'tabular-nums', background: '#f0fdf4' }}>{formatCurrency(record.netSalary)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '600',
                          background: statusBg, color: statusColor
                        }}>
                          {record.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          {record.status === 'Pending' && (
                            <button
                              onClick={() => handleUpdateStatus(record, 'Processed')}
                              style={{ padding: '3px 8px', background: '#f5f3ff', color: '#7c3aed', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}
                            >
                              Process
                            </button>
                          )}
                          {(record.status === 'Pending' || record.status === 'Processed') && (
                            <button
                              onClick={() => handleUpdateStatus(record, 'Paid')}
                              style={{ padding: '3px 8px', background: '#f0fdf4', color: '#16a34a', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}
                            >
                              Mark Paid
                            </button>
                          )}
                          <button
                            onClick={() => handleViewPayslip(record)}
                            style={{ padding: '3px 8px', background: '#eff6ff', color: '#2563eb', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}
                          >
                            Payslip
                          </button>
                          {record.status === 'Paid' && (
                            <button
                              onClick={() => handleSendSlipEmail(record)}
                              disabled={emailingSingle === record.id}
                              style={{
                                padding: '3px 8px', background: '#fef3c7', color: '#b45309', border: 'none', borderRadius: '4px',
                                cursor: 'pointer', fontSize: '11px', fontWeight: '600', opacity: emailingSingle === record.id ? 0.7 : 1
                              }}
                            >
                              {emailingSingle === record.id ? 'Sending...' : 'Email Slip'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {payrollRecords.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                  <td style={{ padding: '10px 12px' }} />
                  <td style={{ padding: '10px 12px', fontWeight: '700' }}>TOTAL ({payrollRecords.length})</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600' }}>{formatCurrency(payrollRecords.reduce((s, r) => s + r.basic, 0))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600' }}>{formatCurrency(payrollRecords.reduce((s, r) => s + r.hra, 0))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600' }}>{formatCurrency(payrollRecords.reduce((s, r) => s + r.da, 0))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600' }}>{formatCurrency(payrollRecords.reduce((s, r) => s + r.other, 0))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', background: '#f0f9ff' }}>{formatCurrency(totals.gross)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600' }}>{formatCurrency(payrollRecords.reduce((s, r) => s + (r.deductions?.pf || 0), 0))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600' }}>{formatCurrency(payrollRecords.reduce((s, r) => s + (r.deductions?.tax || 0), 0))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600' }}>{formatCurrency(payrollRecords.reduce((s, r) => s + (r.deductions?.other || 0), 0))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', color: '#ef4444', background: '#fef2f2' }}>{formatCurrency(totals.deductions)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', color: '#059669', background: '#f0fdf4' }}>{formatCurrency(totals.net)}</td>
                  <td colSpan="2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Payslip View */}
      {viewingPayslip && (
        <div className="card" style={{ padding: '24px', marginTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>Payslip — Company Letterhead</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={handlePrintPayslip}
                style={{ padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
              >
                Print / Save PDF
              </button>
              <button
                onClick={() => handleEmailPayslipPDF(viewingPayslip)}
                disabled={emailingSingle === viewingPayslip.id}
                style={{
                  padding: '6px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px',
                  cursor: 'pointer', fontSize: '13px', fontWeight: '600', opacity: emailingSingle === viewingPayslip.id ? 0.7 : 1
                }}
              >
                {emailingSingle === viewingPayslip.id ? 'Sending...' : 'Email Payslip'}
              </button>
              <button
                onClick={() => setViewingPayslip(null)}
                style={{ padding: '6px 16px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
              >
                Close
              </button>
            </div>
          </div>

          <div ref={payslipRef} style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '8px', background: '#fff' }}>
            <div dangerouslySetInnerHTML={{ __html: buildPayslipHTML(viewingPayslip, employeeMap[viewingPayslip.employeeId]) }} />
          </div>

          {/* Legacy code below replaced by letterhead render above */}
          {false && (() => {
              const emp = employeeMap[viewingPayslip.employeeId];
              return (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '14px' }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '6px 0', color: '#6b7280', width: '30%' }}>Employee Name</td>
                        <td style={{ padding: '6px 0', fontWeight: '600' }}>{emp?.name || 'Unknown'}</td>
                        <td style={{ padding: '6px 0', color: '#6b7280', width: '20%' }}>Department</td>
                        <td style={{ padding: '6px 0', fontWeight: '600' }}>{emp?.department || '--'}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '6px 0', color: '#6b7280' }}>Role</td>
                        <td style={{ padding: '6px 0', fontWeight: '600' }}>{emp?.role || '--'}</td>
                        <td style={{ padding: '6px 0', color: '#6b7280' }}>PAN</td>
                        <td style={{ padding: '6px 0', fontWeight: '600' }}>{emp?.pan || '--'}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '6px 0', color: '#6b7280' }}>Bank A/C</td>
                        <td style={{ padding: '6px 0', fontWeight: '600' }}>{emp?.bankDetails?.accountNumber || '--'}</td>
                        <td style={{ padding: '6px 0', color: '#6b7280' }}>IFSC</td>
                        <td style={{ padding: '6px 0', fontWeight: '600' }}>{emp?.bankDetails?.ifsc || '--'}</td>
                      </tr>
                    </tbody>
                  </table>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    {/* Earnings */}
                    <div>
                      <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px', color: '#059669' }}>Earnings</h4>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <th style={{ padding: '8px 0', textAlign: 'left', fontWeight: '600' }}>Component</th>
                            <th style={{ padding: '8px 0', textAlign: 'right', fontWeight: '600' }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 0' }}>Basic Salary</td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{formatCurrency(viewingPayslip.basic)}</td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 0' }}>HRA</td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{formatCurrency(viewingPayslip.hra)}</td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 0' }}>DA</td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{formatCurrency(viewingPayslip.da)}</td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 0' }}>Other Allowances</td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{formatCurrency(viewingPayslip.other)}</td>
                          </tr>
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                            <td style={{ padding: '10px 0', fontWeight: '700' }}>Gross Salary</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: '700', color: '#059669' }}>{formatCurrency(viewingPayslip.grossSalary)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Deductions */}
                    <div>
                      <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px', color: '#dc2626' }}>Deductions</h4>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <th style={{ padding: '8px 0', textAlign: 'left', fontWeight: '600' }}>Component</th>
                            <th style={{ padding: '8px 0', textAlign: 'right', fontWeight: '600' }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 0' }}>Provident Fund (12%)</td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{formatCurrency(viewingPayslip.deductions?.pf)}</td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 0' }}>Professional Tax</td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{formatCurrency(viewingPayslip.deductions?.tax)}</td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 0' }}>Other Deductions</td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{formatCurrency(viewingPayslip.deductions?.other)}</td>
                          </tr>
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                            <td style={{ padding: '10px 0', fontWeight: '700' }}>Total Deductions</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: '700', color: '#dc2626' }}>{formatCurrency(viewingPayslip.totalDeductions)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  <div style={{
                    marginTop: '24px', padding: '16px', background: '#f0fdf4', borderRadius: '8px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #bbf7d0'
                  }}>
                    <span style={{ fontSize: '16px', fontWeight: '700', color: '#374151' }}>Net Salary Payable</span>
                    <span style={{ fontSize: '22px', fontWeight: '700', color: '#059669' }}>{formatCurrency(viewingPayslip.netSalary)}</span>
                  </div>

                  {viewingPayslip.paidAt && (
                    <div style={{ marginTop: '12px', fontSize: '13px', color: '#6b7280', textAlign: 'right' }}>
                      Paid on: {formatDate(viewingPayslip.paidAt)}
                    </div>
                  )}
                </>
              );
            })()}
        </div>
      )}
    </div>
  );
}
