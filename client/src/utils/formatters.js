// Currency formatter (INR)
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2
  }).format(amount || 0);
}

// Date formatter
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

// DateTime formatter
export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Short date for inputs
export function toInputDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toISOString().split('T')[0];
}

// Month string (YYYY-MM)
export function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Status badge color mapping
export function getStatusColor(status) {
  const map = {
    draft: '#6b7280',
    sent: '#3b82f6',
    paid: '#22c55e',
    overdue: '#ef4444',
    pending: '#f59e0b',
    completed: '#22c55e',
    active: '#22c55e',
    inactive: '#6b7280',
    present: '#22c55e',
    absent: '#ef4444',
    'half-day': '#f59e0b',
    leave: '#3b82f6',
    processing: '#a78bfa',
    failed: '#ef4444',
    planning: '#6b7280',
    'on-hold': '#f59e0b'
  };
  return map[status] || '#6b7280';
}

// Percentage
export function formatPercent(value) {
  return `${(value || 0).toFixed(1)}%`;
}

// Financial year
export function getFinancialYear() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${year + 1}`;
}

// Truncate text
export function truncate(str, len = 40) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}
