import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Billing from './pages/Billing';
import Accounting from './pages/Accounting';
import Expenses from './pages/Expenses';
import GST from './pages/GST';
import Employees from './pages/Employees';
import Attendance from './pages/Attendance';
import Payroll from './pages/Payroll';
import Projects from './pages/Projects';
import Documents from './pages/Documents';
import Payments from './pages/Payments';
import Settings from './pages/Settings';
import Users from './pages/Users';
import AuthLogs from './pages/AuthLogs';
import ClientPortal from './pages/ClientPortal';
import TemplateBuilder from './pages/TemplateBuilder';
import AIAssistant from './pages/AIAssistant';
import Mail from './pages/Mail';
import Loans from './pages/Loans';

// ─── Error Boundary ──────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui' }}>
          <h2 style={{ color: '#333', marginBottom: '12px' }}>Something went wrong</h2>
          <p style={{ color: '#666', marginBottom: '20px' }}>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ padding: '10px 24px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Protected Route ──────────────────────────────────────────────────────────

function ProtectedRoute({ children }) {
  const { user, loading, authError } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loader"></div>
        <p style={{ marginTop: '16px', color: '#666', fontSize: '14px' }}>Loading your workspace...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ error: authError }} />;
  }

  return children;
}

// ─── Role-Based Route ─────────────────────────────────────────────────────────

function RoleRoute({ children, roles }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

// ─── Session Expiry Listener ──────────────────────────────────────────────────

function SessionExpiryHandler() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  useEffect(() => {
    const handler = async () => {
      await logout();
      navigate('/login', { replace: true, state: { error: 'Session expired. Please login again.' } });
    };

    window.addEventListener('auth:session-expired', handler);
    return () => window.removeEventListener('auth:session-expired', handler);
  }, [logout, navigate]);

  return null;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { user } = useAuth();
  const isClient = user?.role === 'client';

  return (
    <ErrorBoundary>
      <SessionExpiryHandler />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          {/* Client sees portal, others see dashboard */}
          <Route index element={isClient ? <ClientPortal /> : <Overview />} />
          <Route path="my-shares" element={<ClientPortal />} />

          {/* Admin/Employee routes */}
          <Route path="billing" element={<Billing />} />
          <Route path="accounting" element={<Accounting />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="gst" element={<GST />} />
          <Route path="employees" element={<Employees />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="payroll" element={<Payroll />} />
          <Route path="projects" element={<Projects />} />
          <Route path="documents" element={<Documents />} />
          <Route path="payments" element={<Payments />} />
          <Route path="loans" element={<Loans />} />
          <Route path="settings" element={<Settings />} />
          <Route path="templates" element={<TemplateBuilder />} />
          <Route path="ai" element={<AIAssistant />} />
          <Route path="mail" element={<Mail />} />

          {/* Admin routes */}
          <Route path="users" element={
            <RoleRoute roles={['superadmin', 'admin']}><Users /></RoleRoute>
          } />
          <Route path="auth-logs" element={
            <RoleRoute roles={['superadmin']}><AuthLogs /></RoleRoute>
          } />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
