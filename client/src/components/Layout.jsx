import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';

const ICONS = {
  ai: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79 2.73 2.71 7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.5-9.11 0-12.58 3.51-3.47 9.14-3.49 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"/></svg>,
  dashboard: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>,
  receipt: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v7h7v9H6z"/></svg>,
  account_balance: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z"/></svg>,
  payments: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>,
  percent: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7.5 11C9.43 11 11 9.43 11 7.5S9.43 4 7.5 4 4 5.57 4 7.5 5.57 11 7.5 11zm0-5C8.33 6 9 6.67 9 7.5S8.33 9 7.5 9 6 8.33 6 7.5 6.67 6 7.5 6zM16.5 13c-1.93 0-3.5 1.57-3.5 3.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5-1.57-3.5-3.5-3.5zm0 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5.41 20L4 18.59 18.59 4 20 5.41 5.41 20z"/></svg>,
  group: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>,
  event: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg>,
  wallet: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>,
  work: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"/></svg>,
  description: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>,
  credit_card: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>,
  settings: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>,
  people: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>,
  logs: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>,
  share: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg>,
  mail: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>,
  loan: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>,
  notification: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>,
};

function getNavSections(role) {
  const sections = [];

  if (role === 'client') {
    sections.push({ label: 'Main', items: [
      { to: '', icon: 'dashboard', label: 'View Your Bills', end: true },
      { to: 'my-shares', icon: 'share', label: 'Documents' },
    ]});
    return sections;
  }

  sections.push({ label: 'Main', items: [
    { to: '', icon: 'dashboard', label: 'Dashboard', end: true },
    { to: 'ai', icon: 'ai', label: 'AI Assistant' },
  ]});

  sections.push({ label: 'Finance', items: [
    { to: 'billing', icon: 'receipt', label: 'Billing & Invoices' },
    { to: 'accounting', icon: 'account_balance', label: 'Accounting' },
    { to: 'expenses', icon: 'payments', label: 'Expenses' },
    { to: 'gst', icon: 'percent', label: 'GST Management' },
    { to: 'loans', icon: 'loan', label: 'Loans & EMI' },
  ]});

  sections.push({ label: 'Human Resources', items: [
    { to: 'employees', icon: 'group', label: 'Employees' },
    { to: 'attendance', icon: 'event', label: 'Attendance' },
    { to: 'payroll', icon: 'wallet', label: 'Payroll' },
  ]});

  sections.push({ label: 'Operations', items: [
    { to: 'projects', icon: 'work', label: 'Projects' },
    { to: 'documents', icon: 'description', label: 'Documents' },
    { to: 'payments', icon: 'credit_card', label: 'Payments & API' },
    { to: 'mail', icon: 'mail', label: 'Mail & Mailboxes' },
  ]});

  const systemItems = [{ to: 'settings', icon: 'settings', label: 'Settings' }];

  if (role === 'superadmin' || role === 'admin') {
    systemItems.unshift({ to: 'users', icon: 'people', label: 'Users & Clients' });
  }
  if (role === 'superadmin') {
    systemItems.push({ to: 'auth-logs', icon: 'logs', label: 'Auth Logs' });
  }

  sections.push({ label: 'System', items: systemItems });
  return sections;
}

const PAGE_TITLES = {
  '': 'Dashboard', ai: 'AI Assistant', billing: 'Billing & Invoices', accounting: 'Accounting',
  expenses: 'Expenses', gst: 'GST Management', loans: 'Loans & EMI', mail: 'Mail', employees: 'Employees',
  attendance: 'Attendance', payroll: 'Payroll', projects: 'Projects',
  documents: 'Documents', payments: 'Payments & API', settings: 'Settings',
  users: 'Users & Clients', 'auth-logs': 'Auth Logs', 'my-shares': 'Documents',
  templates: 'Template Builder',
};

// ─── Notification Bell ────────────────────────────────────────────────────────

function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const data = await api.get('/mail/inbox/unread-count');
      setUnreadCount(data?.count || 0);
    } catch {
      // Silently fail — notifications are non-critical
    }
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 60_000); // Poll every minute
    return () => clearInterval(interval);
  }, [fetchUnread]);

  if (unreadCount === 0) return null;

  return (
    <div className="notification-bell" title={`${unreadCount} unread email${unreadCount !== 1 ? 's' : ''}`}>
      {ICONS.notification}
      <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
    </div>
  );
}

// ─── Layout Component ─────────────────────────────────────────────────────────

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const { user, logout } = useAuth();
  const location = useLocation();

  const currentPath = location.pathname.replace('/dashboard/', '').replace('/dashboard', '');
  const pageTitle = PAGE_TITLES[currentPath] || 'Dashboard';
  const navSections = getNavSections(user?.role);

  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', collapsed); } catch {}
  }, [collapsed]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  function toggleCollapse() {
    setCollapsed(prev => !prev);
  }

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-emblem small"><span className="logo-letter">AK</span></div>
          {!collapsed && <span className="sidebar-brand">AK & Co.</span>}
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>&times;</button>
          <button
            className="sidebar-collapse-btn"
            onClick={toggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              <path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
            </svg>
          </button>
        </div>
        <nav className="sidebar-nav">
          {navSections.map(section => (
            <div className="nav-section" key={section.label}>
              {!collapsed && <span className="nav-section-label">{section.label}</span>}
              {section.items.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                  title={collapsed ? item.label : undefined}>
                  {ICONS[item.icon]}
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar">{(user?.name || 'U')[0].toUpperCase()}</div>
            {!collapsed && (
              <div className="user-info">
                <span className="user-name">{user?.name || 'User'}</span>
                <span className="user-email">{user?.role?.toUpperCase()} — {user?.phone || user?.email}</span>
              </div>
            )}
          </div>
          <button className="btn-logout" onClick={logout} title="Logout">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
          </button>
        </div>
      </aside>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <main className="main-content">
        <header className="main-header">
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          </button>
          <h2 className="page-title">{pageTitle}</h2>
          <div className="header-actions">
            <NotificationBell />
            <span className="header-date">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </header>
        <div className="content-area"><Outlet /></div>
      </main>
    </div>
  );
}
