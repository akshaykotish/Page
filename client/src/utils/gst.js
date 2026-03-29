// GST Rates in India
export const GST_RATES = [0, 5, 12, 18, 28];

// Indian State codes for GST
export const STATE_CODES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar',
  '36': 'Telangana', '37': 'Andhra Pradesh'
};

export const STATES = Object.entries(STATE_CODES).map(([code, name]) => ({ code, name }));

// Calculate GST for line items
export function calculateGST(items, isInterstate = false) {
  let subtotal = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;

  const calculated = items.map(item => {
    const amount = (item.qty || 0) * (item.rate || 0);
    const gstRate = item.gstRate || 18;
    const gstAmount = amount * (gstRate / 100);

    subtotal += amount;

    if (isInterstate) {
      totalIGST += gstAmount;
    } else {
      totalCGST += gstAmount / 2;
      totalSGST += gstAmount / 2;
    }

    return {
      ...item,
      amount,
      gstAmount,
      cgst: isInterstate ? 0 : gstAmount / 2,
      sgst: isInterstate ? 0 : gstAmount / 2,
      igst: isInterstate ? gstAmount : 0
    };
  });

  return {
    items: calculated,
    subtotal,
    cgst: totalCGST,
    sgst: totalSGST,
    igst: totalIGST,
    totalTax: totalCGST + totalSGST + totalIGST,
    total: subtotal + totalCGST + totalSGST + totalIGST
  };
}

// Extract state code from GSTIN
export function getStateFromGSTIN(gstin) {
  if (!gstin || gstin.length < 2) return null;
  const code = gstin.substring(0, 2);
  return { code, name: STATE_CODES[code] || 'Unknown' };
}

// Validate GSTIN
export function isValidGSTIN(gstin) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin);
}

// Number to words (Indian numbering)
export function numberToWords(num) {
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

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let result = convert(rupees) + ' Rupees';
  if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
  result += ' Only';
  return result;
}
