import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import HeaderFooterEditor from './pages/HeaderFooterEditor';
import ApiGateway from './pages/ApiGateway';
import Companies from './pages/Companies';
import CompanyDetail from './pages/CompanyDetail';
import DocumentDrafter from './pages/DocumentDrafter';

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

// ─── Empty Dashboard ─────────────────────────────────────────────────────────

function EmptyDashboard() {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 28, color: '#1a1a1a', marginBottom: 12 }}>
        Dashboard
      </h2>
      <p style={{ color: '#666', fontSize: 15 }}>No features configured yet.</p>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
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
          <Route index element={<EmptyDashboard />} />
          <Route path="companies" element={<Companies />} />
          <Route path="companies/:id" element={<CompanyDetail />} />
          <Route path="header-footer" element={<HeaderFooterEditor />} />
          <Route path="documents" element={<DocumentDrafter />} />
          <Route path="api-gateway" element={<ApiGateway />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
