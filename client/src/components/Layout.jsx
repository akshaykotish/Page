import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-emblem small"><span className="logo-letter">AK</span></div>
          <span className="sidebar-brand">AK & Co.</span>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>&times;</button>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section-label">MANAGEMENT</div>
          <NavLink to="/companies" className={({ isActive }) => `nav-item sidebar-link ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>
            Companies
          </NavLink>
          <NavLink to="/documents" className={({ isActive }) => `nav-item sidebar-link ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            Documents
          </NavLink>
          <div className="nav-section-label">API</div>
          <NavLink to="/api-gateway" className={({ isActive }) => `nav-item sidebar-link ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M13 13h-2V7h2m0 10h-2v-2h2M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2z"/></svg>
            Payment APIs
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar">{(user?.name || 'U')[0].toUpperCase()}</div>
            <div className="user-info">
              <span className="user-name">{user?.name || 'User'}</span>
              <span className="user-email">{user?.role?.toUpperCase()} — {user?.phone || user?.email}</span>
            </div>
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
          <h2 className="page-title">Dashboard</h2>
          <div className="header-actions">
            <span className="header-date">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </header>
        <div className="content-area"><Outlet /></div>
      </main>
    </div>
  );
}
