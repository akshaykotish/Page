import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';
import { formatCurrency } from '../utils/formatters';
import { GST_RATES } from '../utils/gst';

// Financial year months: April to March
const FY_MONTHS = [
  { value: '04', label: 'April' }, { value: '05', label: 'May' }, { value: '06', label: 'June' },
  { value: '07', label: 'July' }, { value: '08', label: 'August' }, { value: '09', label: 'September' },
  { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
  { value: '01', label: 'January' }, { value: '02', label: 'February' }, { value: '03', label: 'March' }
];

const QUARTERS = [
  { label: 'Q1 (Apr-Jun)', months: ['04', '05', '06'] },
  { label: 'Q2 (Jul-Sep)', months: ['07', '08', '09'] },
  { label: 'Q3 (Oct-Dec)', months: ['10', '11', '12'] },
  { label: 'Q4 (Jan-Mar)', months: ['01', '02', '03'] }
];

function getFinancialYears() {
  const now = new Date();
  const currentFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const years = [];
  for (let y = currentFY; y >= currentFY - 4; y--) {
    years.push(`${y}-${y + 1}`);
  }
  return years;
}

function getFYRange(fyStr) {
  const [startYear] = fyStr.split('-').map(Number);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`
  };
}

function getMonthYear(dateStr) {
  if (!dateStr) return null;
  return dateStr.substring(0, 7); // YYYY-MM
}

export default function GST() {
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [financialYear, setFinancialYear] = useState(getFinancialYears()[0]);
  const [periodFilter, setPeriodFilter] = useState('all'); // 'all', 'Q1', 'Q2', 'Q3', 'Q4', or specific month
  const [companyGSTIN, setCompanyGSTIN] = useState('');

  // Fetch company settings for GSTIN
  useEffect(() => {
    async function loadCompanySettings() {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'company'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          setCompanyGSTIN(data.gstin || data.GSTIN || '');
        }
      } catch (err) {
        console.error('Error loading company settings:', err);
      }
    }
    loadCompanySettings();
  }, []);

  // Fetch all invoices and expenses
  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [invoiceSnap, expenseSnap] = await Promise.all([
        getDocs(query(collection(db, 'invoices'), orderBy('date', 'desc'))).catch(() =>
          getDocs(collection(db, 'invoices'))
        ),
        getDocs(query(collection(db, 'expenses'), orderBy('date', 'desc'))).catch(() =>
          getDocs(collection(db, 'expenses'))
        )
      ]);

      setInvoices(invoiceSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setExpenses(expenseSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching GST data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Filter data by financial year
  const { fyInvoices, fyExpenses } = useMemo(() => {
    const { start, end } = getFYRange(financialYear);

    const fInv = invoices.filter(inv => {
      const d = inv.date || inv.invoiceDate || '';
      return d >= start && d <= end;
    });
    const fExp = expenses.filter(exp => {
      const d = exp.date || '';
      return d >= start && d <= end;
    });

    return { fyInvoices: fInv, fyExpenses: fExp };
  }, [invoices, expenses, financialYear]);

  // Get active months based on period filter
  const activeMonths = useMemo(() => {
    if (periodFilter === 'all') return null; // no filtering
    const quarter = QUARTERS.find(q => q.label.startsWith(periodFilter));
    if (quarter) return quarter.months;
    // Single month filter
    const month = FY_MONTHS.find(m => m.value === periodFilter);
    if (month) return [month.value];
    return null;
  }, [periodFilter]);

  // Filter by period within FY
  const { filteredInvoices, filteredExpenses } = useMemo(() => {
    if (!activeMonths) return { filteredInvoices: fyInvoices, filteredExpenses: fyExpenses };

    const fInv = fyInvoices.filter(inv => {
      const d = inv.date || inv.invoiceDate || '';
      const m = d.substring(5, 7);
      return activeMonths.includes(m);
    });
    const fExp = fyExpenses.filter(exp => {
      const m = (exp.date || '').substring(5, 7);
      return activeMonths.includes(m);
    });

    return { filteredInvoices: fInv, filteredExpenses: fExp };
  }, [fyInvoices, fyExpenses, activeMonths]);

  // Summary totals
  const summary = useMemo(() => {
    let totalGSTCollected = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    let totalIGST = 0;
    let totalSales = 0;

    filteredInvoices.forEach(inv => {
      const cgst = parseFloat(inv.cgst) || 0;
      const sgst = parseFloat(inv.sgst) || 0;
      const igst = parseFloat(inv.igst) || 0;
      const totalTax = parseFloat(inv.totalTax) || (cgst + sgst + igst);
      totalCGST += cgst;
      totalSGST += sgst;
      totalIGST += igst;
      totalGSTCollected += totalTax;
      totalSales += parseFloat(inv.subtotal) || parseFloat(inv.amount) || 0;
    });

    let totalITC = 0;
    let totalPurchases = 0;

    filteredExpenses.forEach(exp => {
      totalITC += parseFloat(exp.gstAmount) || 0;
      totalPurchases += parseFloat(exp.amount) || 0;
    });

    const netLiability = totalGSTCollected - totalITC;

    return {
      totalGSTCollected,
      totalCGST,
      totalSGST,
      totalIGST,
      totalSales,
      totalITC,
      totalPurchases,
      netLiability
    };
  }, [filteredInvoices, filteredExpenses]);

  // Monthly breakdown
  const monthlyBreakdown = useMemo(() => {
    const [startYear] = financialYear.split('-').map(Number);
    const months = FY_MONTHS.map(m => {
      const year = parseInt(m.value, 10) >= 4 ? startYear : startYear + 1;
      return {
        key: `${year}-${m.value}`,
        label: `${m.label} ${year}`,
        month: m.value
      };
    });

    // Filter months by period
    const filteredMonths = activeMonths
      ? months.filter(m => activeMonths.includes(m.month))
      : months;

    return filteredMonths.map(m => {
      const monthInvoices = fyInvoices.filter(inv => getMonthYear(inv.date || inv.invoiceDate) === m.key);
      const monthExpenses = fyExpenses.filter(exp => getMonthYear(exp.date) === m.key);

      let sales = 0;
      let gstOnSales = 0;
      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      monthInvoices.forEach(inv => {
        sales += parseFloat(inv.subtotal) || parseFloat(inv.amount) || 0;
        const c = parseFloat(inv.cgst) || 0;
        const s = parseFloat(inv.sgst) || 0;
        const i = parseFloat(inv.igst) || 0;
        cgst += c;
        sgst += s;
        igst += i;
        gstOnSales += parseFloat(inv.totalTax) || (c + s + i);
      });

      let purchases = 0;
      let itc = 0;
      monthExpenses.forEach(exp => {
        purchases += parseFloat(exp.amount) || 0;
        itc += parseFloat(exp.gstAmount) || 0;
      });

      return {
        ...m,
        sales,
        gstOnSales,
        cgst,
        sgst,
        igst,
        purchases,
        itc,
        netPayable: gstOnSales - itc
      };
    });
  }, [fyInvoices, fyExpenses, financialYear, activeMonths]);

  // GSTR-1 Summary: Outward supplies grouped by GST rate
  const gstr1Summary = useMemo(() => {
    const byRate = {};
    GST_RATES.forEach(rate => {
      byRate[rate] = { rate, invoiceCount: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
    });

    filteredInvoices.forEach(inv => {
      // If invoice has line items, group by their individual rates
      const items = inv.items || inv.lineItems || [];
      if (items.length > 0) {
        items.forEach(item => {
          const rate = parseFloat(item.gstRate) || 18;
          if (!byRate[rate]) {
            byRate[rate] = { rate, invoiceCount: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
          }
          const amount = (parseFloat(item.qty) || parseFloat(item.quantity) || 1) * (parseFloat(item.rate) || parseFloat(item.price) || 0);
          const gstAmt = amount * (rate / 100);
          const isCGST = !inv.isInterstate;
          byRate[rate].taxableValue += amount;
          if (isCGST) {
            byRate[rate].cgst += gstAmt / 2;
            byRate[rate].sgst += gstAmt / 2;
          } else {
            byRate[rate].igst += gstAmt;
          }
          byRate[rate].totalTax += gstAmt;
        });
        byRate[items[0]?.gstRate || 18].invoiceCount += 1;
      } else {
        // Invoice without line items - use invoice-level GST
        const rate = parseFloat(inv.gstRate) || 18;
        if (!byRate[rate]) {
          byRate[rate] = { rate, invoiceCount: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
        }
        byRate[rate].invoiceCount += 1;
        byRate[rate].taxableValue += parseFloat(inv.subtotal) || parseFloat(inv.amount) || 0;
        byRate[rate].cgst += parseFloat(inv.cgst) || 0;
        byRate[rate].sgst += parseFloat(inv.sgst) || 0;
        byRate[rate].igst += parseFloat(inv.igst) || 0;
        byRate[rate].totalTax += parseFloat(inv.totalTax) || (
          (parseFloat(inv.cgst) || 0) + (parseFloat(inv.sgst) || 0) + (parseFloat(inv.igst) || 0)
        );
      }
    });

    return Object.values(byRate).filter(r => r.taxableValue > 0 || r.invoiceCount > 0);
  }, [filteredInvoices]);

  // GSTR-3B Summary
  const gstr3bSummary = useMemo(() => {
    return {
      outputTax: {
        cgst: summary.totalCGST,
        sgst: summary.totalSGST,
        igst: summary.totalIGST,
        total: summary.totalGSTCollected
      },
      inputTaxCredit: {
        total: summary.totalITC
      },
      netPayable: {
        total: summary.netLiability
      }
    };
  }, [summary]);

  // ===== GST FILING HELPERS =====
  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadGSTR1() {
    const [startYear] = financialYear.split('-').map(Number);
    const period = periodFilter === 'all' ? financialYear : periodFilter;

    const gstr1Data = {
      gstin: companyGSTIN,
      fp: period,
      version: 'GST3.0.4',
      hash: 'hash',
      b2b: filteredInvoices.filter(inv => inv.customer?.gstin).map(inv => ({
        ctin: inv.customer?.gstin || '',
        inv: [{
          inum: inv.invoiceNumber || '',
          idt: (inv.date || inv.invoiceDate || '').split('-').reverse().join('-'),
          val: parseFloat(inv.total) || 0,
          pos: inv.customer?.state || '',
          rchrg: 'N',
          itms: (inv.items || []).map(item => ({
            num: 1,
            itm_det: {
              txval: parseFloat(item.amount) || (item.qty * item.rate) || 0,
              rt: parseFloat(item.gstRate) || 18,
              camt: parseFloat(item.cgst) || 0,
              samt: parseFloat(item.sgst) || 0,
              iamt: parseFloat(item.igst) || 0,
            }
          }))
        }]
      })),
      b2cs: filteredInvoices.filter(inv => !inv.customer?.gstin).map(inv => ({
        pos: inv.customer?.state || '',
        typ: 'OE',
        txval: parseFloat(inv.subtotal) || 0,
        rt: 18,
        camt: parseFloat(inv.cgst) || 0,
        samt: parseFloat(inv.sgst) || 0,
        iamt: parseFloat(inv.igst) || 0,
      })),
    };

    downloadJSON(gstr1Data, `GSTR1_${financialYear}_${period}.json`);
  }

  function downloadGSTR3B() {
    const gstr3bData = {
      gstin: companyGSTIN,
      ret_period: periodFilter === 'all' ? financialYear : periodFilter,
      sup_details: {
        osup_det: {
          txval: summary.totalSales,
          camt: summary.totalCGST,
          samt: summary.totalSGST,
          iamt: summary.totalIGST,
        },
      },
      itc_elg: {
        itc_avl: [{
          ty: 'IMPG',
          iamt: 0, camt: 0, samt: 0,
        }],
        itc_net: {
          iamt: summary.totalITC,
          camt: summary.totalITC / 2,
          samt: summary.totalITC / 2,
        },
      },
      intr_ltfee: {
        intr_det: { iamt: 0, camt: 0, samt: 0 },
      },
      tax_pmt: {
        net_tax: summary.netLiability,
      },
    };

    downloadJSON(gstr3bData, `GSTR3B_${financialYear}_${periodFilter}.json`);
  }

  function downloadCSV() {
    const headers = ['Invoice No', 'Date', 'Customer', 'GSTIN', 'State', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax', 'Total'];
    const rows = filteredInvoices.map(inv => [
      inv.invoiceNumber || '',
      inv.date || inv.invoiceDate || '',
      inv.customer?.name || '',
      inv.customer?.gstin || '',
      inv.customer?.state || '',
      parseFloat(inv.subtotal) || 0,
      parseFloat(inv.cgst) || 0,
      parseFloat(inv.sgst) || 0,
      parseFloat(inv.igst) || 0,
      parseFloat(inv.totalTax) || 0,
      parseFloat(inv.total) || 0,
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GST_Invoices_${financialYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '4rem', color: '#6b7280' }}>
        Loading GST data...
      </div>
    );
  }

  return (
    <div className="page-gst">
      {/* Period Filter */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 500, color: '#374151' }}>Financial Year:</label>
            <select
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
              style={selectStyle}
            >
              {getFinancialYears().map(fy => (
                <option key={fy} value={fy}>FY {fy}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 500, color: '#374151' }}>Period:</label>
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              style={selectStyle}
            >
              <option value="all">Full Year</option>
              <optgroup label="Quarters">
                {QUARTERS.map(q => (
                  <option key={q.label} value={q.label.split(' ')[0]}>{q.label}</option>
                ))}
              </optgroup>
              <optgroup label="Months">
                {FY_MONTHS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <button
            onClick={fetchData}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              background: '#f1f5f9',
              color: '#374151',
              border: '1px solid #d1d5db',
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              marginLeft: 'auto'
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Filing & Download Actions */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            GST Filing & Export
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={downloadGSTR1} style={{
            padding: '0.5rem 1rem', borderRadius: '6px', background: '#059669', color: '#fff',
            border: 'none', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem'
          }}>
            GSTR-1 JSON
          </button>
          <button onClick={downloadGSTR3B} style={{
            padding: '0.5rem 1rem', borderRadius: '6px', background: '#2563eb', color: '#fff',
            border: 'none', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem'
          }}>
            GSTR-3B JSON
          </button>
          <button onClick={downloadCSV} style={{
            padding: '0.5rem 1rem', borderRadius: '6px', background: '#f1f5f9', color: '#374151',
            border: '1px solid #d1d5db', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem'
          }}>
            Export CSV
          </button>
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.5 }}>
          Download GSTR-1 and GSTR-3B JSON files for upload to the GST portal. CSV export includes all invoice data for the selected period.
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={cardLabelStyle}>Total GST Collected</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#22c55e' }}>
            {formatCurrency(summary.totalGSTCollected)}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.5rem', lineHeight: 1.6 }}>
            CGST: {formatCurrency(summary.totalCGST)}<br />
            SGST: {formatCurrency(summary.totalSGST)}<br />
            IGST: {formatCurrency(summary.totalIGST)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }}>
            From {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={cardLabelStyle}>Total GST Paid (ITC)</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f59e0b' }}>
            {formatCurrency(summary.totalITC)}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.5rem' }}>
            Input Tax Credit from expenses
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }}>
            From {filteredExpenses.length} expense{filteredExpenses.length !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', borderLeft: `4px solid ${summary.netLiability >= 0 ? '#ef4444' : '#22c55e'}` }}>
          <div style={cardLabelStyle}>Net GST Liability</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: summary.netLiability >= 0 ? '#ef4444' : '#22c55e' }}>
            {formatCurrency(Math.abs(summary.netLiability))}
          </div>
          <div style={{
            fontSize: '0.8rem',
            color: summary.netLiability >= 0 ? '#ef4444' : '#22c55e',
            marginTop: '0.5rem',
            fontWeight: 500
          }}>
            {summary.netLiability >= 0 ? 'Payable to Government' : 'Credit / Refund Due'}
          </div>
        </div>
      </div>

      {/* Monthly Breakdown Table */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: '1.5rem' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
            Monthly Breakdown
          </h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={thStyle}>Month</th>
                <th style={thRightStyle}>Sales</th>
                <th style={thRightStyle}>GST on Sales</th>
                <th style={thCenterStyle}>CGST + SGST + IGST</th>
                <th style={thRightStyle}>Purchases / Expenses</th>
                <th style={thRightStyle}>Input Tax Credit</th>
                <th style={thRightStyle}>Net Payable</th>
              </tr>
            </thead>
            <tbody>
              {monthlyBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                    No data available for the selected period.
                  </td>
                </tr>
              ) : (
                monthlyBreakdown.map(m => (
                  <tr key={m.key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{m.label}</td>
                    <td style={tdRightMonoStyle}>{formatCurrency(m.sales)}</td>
                    <td style={{ ...tdRightMonoStyle, color: '#22c55e' }}>{formatCurrency(m.gstOnSales)}</td>
                    <td style={{ ...tdStyle, textAlign: 'center', fontSize: '0.78rem', color: '#6b7280' }}>
                      {formatCurrency(m.cgst)} + {formatCurrency(m.sgst)} + {formatCurrency(m.igst)}
                    </td>
                    <td style={tdRightMonoStyle}>{formatCurrency(m.purchases)}</td>
                    <td style={{ ...tdRightMonoStyle, color: '#f59e0b' }}>{formatCurrency(m.itc)}</td>
                    <td style={{
                      ...tdRightMonoStyle,
                      fontWeight: 600,
                      color: m.netPayable >= 0 ? '#ef4444' : '#22c55e'
                    }}>
                      {m.netPayable < 0 ? '(' : ''}{formatCurrency(Math.abs(m.netPayable))}{m.netPayable < 0 ? ')' : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {monthlyBreakdown.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: '#1e293b' }}>Total</td>
                  <td style={{ ...tdRightMonoStyle, fontWeight: 700, color: '#1e293b' }}>
                    {formatCurrency(monthlyBreakdown.reduce((s, m) => s + m.sales, 0))}
                  </td>
                  <td style={{ ...tdRightMonoStyle, fontWeight: 700, color: '#22c55e' }}>
                    {formatCurrency(monthlyBreakdown.reduce((s, m) => s + m.gstOnSales, 0))}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>—</td>
                  <td style={{ ...tdRightMonoStyle, fontWeight: 700, color: '#1e293b' }}>
                    {formatCurrency(monthlyBreakdown.reduce((s, m) => s + m.purchases, 0))}
                  </td>
                  <td style={{ ...tdRightMonoStyle, fontWeight: 700, color: '#f59e0b' }}>
                    {formatCurrency(monthlyBreakdown.reduce((s, m) => s + m.itc, 0))}
                  </td>
                  <td style={{
                    ...tdRightMonoStyle,
                    fontWeight: 700,
                    color: summary.netLiability >= 0 ? '#ef4444' : '#22c55e'
                  }}>
                    {summary.netLiability < 0 ? '(' : ''}{formatCurrency(Math.abs(summary.netLiability))}{summary.netLiability < 0 ? ')' : ''}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* GSTR-1 and GSTR-3B side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>

        {/* GSTR-1 Summary */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', background: '#f0fdf4' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#166534' }}>
              GSTR-1 Summary
            </h3>
            <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.25rem' }}>
              Outward Supplies grouped by GST Rate
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={thStyle}>GST Rate</th>
                  <th style={thCenterStyle}>Invoices</th>
                  <th style={thRightStyle}>Taxable Value</th>
                  <th style={thRightStyle}>CGST</th>
                  <th style={thRightStyle}>SGST</th>
                  <th style={thRightStyle}>IGST</th>
                  <th style={thRightStyle}>Total Tax</th>
                </tr>
              </thead>
              <tbody>
                {gstr1Summary.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center', color: '#6b7280' }}>
                      No outward supplies recorded.
                    </td>
                  </tr>
                ) : (
                  gstr1Summary.map(row => (
                    <tr key={row.rate} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>
                        <span style={{
                          padding: '0.2rem 0.6rem',
                          borderRadius: '12px',
                          background: '#eff6ff',
                          color: '#2563eb',
                          fontWeight: 600,
                          fontSize: '0.8rem'
                        }}>
                          {row.rate}%
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>{row.invoiceCount}</td>
                      <td style={tdRightMonoStyle}>{formatCurrency(row.taxableValue)}</td>
                      <td style={tdRightMonoStyle}>{formatCurrency(row.cgst)}</td>
                      <td style={tdRightMonoStyle}>{formatCurrency(row.sgst)}</td>
                      <td style={tdRightMonoStyle}>{formatCurrency(row.igst)}</td>
                      <td style={{ ...tdRightMonoStyle, fontWeight: 600, color: '#22c55e' }}>
                        {formatCurrency(row.totalTax)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {gstr1Summary.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>Total</td>
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>
                      {gstr1Summary.reduce((s, r) => s + r.invoiceCount, 0)}
                    </td>
                    <td style={{ ...tdRightMonoStyle, fontWeight: 700 }}>
                      {formatCurrency(gstr1Summary.reduce((s, r) => s + r.taxableValue, 0))}
                    </td>
                    <td style={{ ...tdRightMonoStyle, fontWeight: 700 }}>
                      {formatCurrency(gstr1Summary.reduce((s, r) => s + r.cgst, 0))}
                    </td>
                    <td style={{ ...tdRightMonoStyle, fontWeight: 700 }}>
                      {formatCurrency(gstr1Summary.reduce((s, r) => s + r.sgst, 0))}
                    </td>
                    <td style={{ ...tdRightMonoStyle, fontWeight: 700 }}>
                      {formatCurrency(gstr1Summary.reduce((s, r) => s + r.igst, 0))}
                    </td>
                    <td style={{ ...tdRightMonoStyle, fontWeight: 700, color: '#22c55e' }}>
                      {formatCurrency(gstr1Summary.reduce((s, r) => s + r.totalTax, 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* GSTR-3B Summary */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', background: '#fef3c7' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#92400e' }}>
              GSTR-3B Summary
            </h3>
            <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.25rem' }}>
              Return summary for the selected period
            </div>
          </div>
          <div style={{ padding: '1.25rem' }}>
            {/* 3.1 - Output Tax */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{
                fontSize: '0.78rem', fontWeight: 600, color: '#64748b',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem',
                paddingBottom: '0.5rem', borderBottom: '1px solid #e2e8f0'
              }}>
                3.1 Outward Supplies (Output Tax)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={gstr3bRowStyle}>
                  <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>CGST</span>
                  <span style={gstr3bValueStyle}>{formatCurrency(gstr3bSummary.outputTax.cgst)}</span>
                </div>
                <div style={gstr3bRowStyle}>
                  <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>SGST</span>
                  <span style={gstr3bValueStyle}>{formatCurrency(gstr3bSummary.outputTax.sgst)}</span>
                </div>
                <div style={gstr3bRowStyle}>
                  <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>IGST</span>
                  <span style={gstr3bValueStyle}>{formatCurrency(gstr3bSummary.outputTax.igst)}</span>
                </div>
                <div style={{ ...gstr3bRowStyle, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                  <span style={{ color: '#166534', fontSize: '0.85rem', fontWeight: 600 }}>Total Output Tax</span>
                  <span style={{ ...gstr3bValueStyle, color: '#22c55e', fontWeight: 700 }}>
                    {formatCurrency(gstr3bSummary.outputTax.total)}
                  </span>
                </div>
              </div>
            </div>

            {/* 4 - Input Tax Credit */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{
                fontSize: '0.78rem', fontWeight: 600, color: '#64748b',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem',
                paddingBottom: '0.5rem', borderBottom: '1px solid #e2e8f0'
              }}>
                4. Eligible Input Tax Credit (ITC)
              </div>
              <div style={{ ...gstr3bRowStyle, background: '#fffbeb', border: '1px solid #fde68a' }}>
                <span style={{ color: '#92400e', fontSize: '0.85rem', fontWeight: 600 }}>Total ITC Available</span>
                <span style={{ ...gstr3bValueStyle, color: '#f59e0b', fontWeight: 700 }}>
                  {formatCurrency(gstr3bSummary.inputTaxCredit.total)}
                </span>
              </div>
            </div>

            {/* 6.1 - Net Tax Payable */}
            <div>
              <div style={{
                fontSize: '0.78rem', fontWeight: 600, color: '#64748b',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem',
                paddingBottom: '0.5rem', borderBottom: '1px solid #e2e8f0'
              }}>
                6.1 Net Tax Payable
              </div>
              <div style={{
                padding: '1rem',
                borderRadius: '8px',
                background: summary.netLiability >= 0 ? '#fef2f2' : '#f0fdf4',
                border: `1px solid ${summary.netLiability >= 0 ? '#fecaca' : '#bbf7d0'}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <span style={{
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: summary.netLiability >= 0 ? '#991b1b' : '#166534'
                  }}>
                    {summary.netLiability >= 0 ? 'Net GST Payable' : 'Net ITC Carry Forward'}
                  </span>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                    Output Tax ({formatCurrency(gstr3bSummary.outputTax.total)})
                    {' '}-{' '}
                    ITC ({formatCurrency(gstr3bSummary.inputTaxCredit.total)})
                  </div>
                </div>
                <span style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: summary.netLiability >= 0 ? '#ef4444' : '#22c55e'
                }}>
                  {formatCurrency(Math.abs(gstr3bSummary.netPayable.total))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Shared styles
const selectStyle = {
  padding: '0.5rem 0.75rem',
  borderRadius: '6px',
  border: '1px solid #d1d5db',
  fontSize: '0.85rem',
  background: '#fff',
  color: '#1e293b'
};

const cardLabelStyle = {
  fontSize: '0.8rem',
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.5rem'
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.85rem'
};

const thStyle = {
  padding: '0.75rem 1rem',
  textAlign: 'left',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap'
};

const thRightStyle = {
  ...thStyle,
  textAlign: 'right'
};

const thCenterStyle = {
  ...thStyle,
  textAlign: 'center'
};

const tdStyle = {
  padding: '0.75rem 1rem',
  color: '#1e293b',
  whiteSpace: 'nowrap'
};

const tdRightMonoStyle = {
  ...tdStyle,
  textAlign: 'right',
  fontFamily: "'JetBrains Mono', monospace"
};

const gstr3bRowStyle = {
  padding: '0.75rem 1rem',
  borderRadius: '6px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center'
};

const gstr3bValueStyle = {
  fontWeight: 600,
  fontFamily: "'JetBrains Mono', monospace",
  color: '#1e293b'
};
