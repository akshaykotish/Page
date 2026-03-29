import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../utils/api';

export default function Login() {
  const [loginMode, setLoginMode] = useState('phone'); // 'phone' or 'email'
  const [step, setStep] = useState('input'); // 'input' or 'otp'
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { sendOTP, signInWithToken, user, authError } = useAuth();

  // Redirect if already logged in
  if (user) { navigate('/', { replace: true }); return null; }

  // Handle redirect errors (e.g., session expired)
  useEffect(() => {
    if (location.state?.error) {
      setError(location.state.error);
    } else if (authError) {
      setError(authError);
    }
  }, [location.state, authError]);

  // Cleanup recaptcha on unmount
  useEffect(() => {
    return () => {
      if (window.recaptchaVerifier) {
        try {
          window.recaptchaVerifier.clear();
        } catch (err) {
          console.warn('Error clearing recaptcha:', err);
        }
        window.recaptchaVerifier = null;
      }
    };
  }, []);

  function resetForm() {
    setStep('input');
    setOtp('');
    setError('');
    setInfo('');
    setConfirmResult(null);
    if (window.recaptchaVerifier) {
      try {
        window.recaptchaVerifier.clear();
      } catch (err) {
        console.warn('Error clearing recaptcha:', err);
      }
      window.recaptchaVerifier = null;
    }
  }

  function switchMode(mode) {
    if (mode === loginMode) return;
    resetForm();
    setPhone('');
    setEmail('');
    setLoginMode(mode);
  }

  // Validation helpers
  function validatePhone(phoneStr) {
    const digits = phoneStr.replace(/\D/g, '');
    if (digits.length < 10) return 'Phone number must be at least 10 digits';
    return null;
  }

  function validateEmail(emailStr) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailStr)) return 'Enter a valid email address';
    return null;
  }

  function validateOTP(otpStr) {
    if (!otpStr || otpStr.length !== 6) return 'OTP must be 6 digits';
    return null;
  }

  // ---- Phone OTP ----
  async function handleSendPhoneOTP(e) {
    e.preventDefault();

    const phoneErr = validatePhone(phone);
    if (phoneErr) {
      setError(phoneErr);
      return;
    }

    setError('');
    setSending(true);
    try {
      const confirmation = await sendOTP(phone.trim());
      setConfirmResult(confirmation);
      setInfo('OTP sent via SMS!');
      setStep('otp');
    } catch (err) {
      const errorMsg = err instanceof ApiError ? err.message : (err?.message || 'Failed to send OTP. Try again.');
      setError(errorMsg);
      if (window.recaptchaVerifier) {
        try {
          window.recaptchaVerifier.clear();
        } catch (clearErr) {
          console.warn('Error clearing recaptcha:', clearErr);
        }
        window.recaptchaVerifier = null;
      }
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyPhoneOTP(e) {
    e.preventDefault();

    const otpErr = validateOTP(otp);
    if (otpErr) {
      setError(otpErr);
      return;
    }

    setError('');
    setSending(true);
    try {
      if (!confirmResult) {
        throw new Error('Verification session expired. Request a new OTP.');
      }
      await confirmResult.confirm(otp.trim());
      setInfo('Verified! Logging in...');
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      if (err.code === 'auth/invalid-verification-code') {
        setError('Invalid OTP. Check the code and try again.');
      } else if (err.code === 'auth/code-expired') {
        setError('OTP expired. Request a new one.');
      } else {
        setError(err.message || 'Verification failed.');
      }
    } finally {
      setSending(false);
    }
  }

  // ---- Email OTP ----
  async function handleSendEmailOTP(e) {
    e.preventDefault();

    const emailErr = validateEmail(email);
    if (emailErr) {
      setError(emailErr);
      return;
    }

    setError('');
    setSending(true);
    try {
      const data = await api.post('/auth/email-otp', { email: email.trim() });
      if (!data) throw new Error('No response from server');
      setInfo('OTP sent to your email!');
      setStep('otp');
    } catch (err) {
      const errorMsg = err instanceof ApiError ? err.message : (err?.message || 'Failed to send OTP. Try again.');
      setError(errorMsg);
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyEmailOTP(e) {
    e.preventDefault();

    const otpErr = validateOTP(otp);
    if (otpErr) {
      setError(otpErr);
      return;
    }

    setError('');
    setSending(true);
    try {
      const data = await api.post('/auth/verify-email-otp', {
        email: email.trim(),
        otp: otp.trim()
      });
      if (!data?.token) throw new Error('No token in response');

      await signInWithToken(data.token);
      setInfo('Verified! Logging in...');
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      const errorMsg = err instanceof ApiError ? err.message : (err?.message || 'Verification failed.');
      setError(errorMsg);
    } finally {
      setSending(false);
    }
  }

  const tabStyle = (active) => ({
    flex: 1,
    padding: '12px 16px',
    background: active ? '#2e7d32' : '#f5f5f0',
    color: active ? '#fff' : '#1a1a1a',
    border: '3px solid #1a1a1a',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 900,
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    transition: 'all 0.15s',
    boxShadow: active ? '3px 3px 0 #1a1a1a' : 'none',
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0faf0', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420, background: '#fff', border: '4px solid #1a1a1a', borderRadius: 14, padding: '40px 32px', boxShadow: '8px 8px 0 #1a1a1a' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 56, height: 56, background: '#c0e040', border: '3px solid #1a1a1a', borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '4px 4px 0 #1a1a1a', marginBottom: 16 }}>
            <span style={{ fontFamily: 'Playfair Display, serif', fontWeight: 900, fontSize: 22 }}>AK</span>
          </div>
          <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 900, margin: 0 }}>Akshay Kotish & Co.</h1>
          <p style={{ color: '#888', fontSize: 14, fontWeight: 600, marginTop: 4 }}>View Your Bills</p>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          <button type="button" style={tabStyle(loginMode === 'phone')} onClick={() => switchMode('phone')}>
            Phone
          </button>
          <button type="button" style={tabStyle(loginMode === 'email')} onClick={() => switchMode('email')}>
            Email
          </button>
        </div>

        {/* ===== PHONE MODE ===== */}
        {loginMode === 'phone' && step === 'input' && (
          <form onSubmit={handleSendPhoneOTP}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Phone Number</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ padding: '12px 14px', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 16, fontWeight: 700, background: '#f5f5f0' }}>+91</span>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Phone number" autoFocus maxLength={10}
                  style={{ flex: 1, padding: '12px 14px', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 16, fontWeight: 600, outline: 'none' }} />
              </div>
            </div>
            <button type="submit" disabled={sending || !phone.trim()}
              style={{ width: '100%', padding: '14px 20px', background: '#2e7d32', color: 'white', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 16, fontWeight: 900, cursor: sending || !phone.trim() ? 'not-allowed' : 'pointer', boxShadow: '4px 4px 0 #1a1a1a', textTransform: 'uppercase', letterSpacing: '1px', opacity: sending || !phone.trim() ? 0.6 : 1 }}>
              {sending ? 'Sending...' : 'Send OTP'}
            </button>
          </form>
        )}

        {loginMode === 'phone' && step === 'otp' && (
          <form onSubmit={handleVerifyPhoneOTP}>
            {info && <div style={{ padding: '10px 14px', background: '#e8f5e9', border: '2px solid #2e7d32', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 700, color: '#2e7d32' }}>{info}</div>}
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Enter 6-Digit OTP</label>
              <input type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength={6} autoFocus
                style={{ width: '100%', padding: '14px', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 28, fontWeight: 900, textAlign: 'center', letterSpacing: '8px', outline: 'none', fontFamily: 'JetBrains Mono, monospace', boxSizing: 'border-box' }} />
            </div>
            <p style={{ fontSize: 12, color: '#888', marginBottom: 16, textAlign: 'center' }}>
              Sent to +91{phone}&nbsp;
              <button type="button" onClick={resetForm}
                style={{ background: 'none', border: 'none', color: '#2e7d32', fontWeight: 800, cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>Change</button>
            </p>
            <button type="submit" disabled={sending || otp.length !== 6}
              style={{ width: '100%', padding: '14px 20px', background: '#2e7d32', color: 'white', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 16, fontWeight: 900, cursor: (sending || otp.length !== 6) ? 'not-allowed' : 'pointer', boxShadow: '4px 4px 0 #1a1a1a', textTransform: 'uppercase', letterSpacing: '1px', opacity: (sending || otp.length !== 6) ? 0.6 : 1 }}>
              {sending ? 'Verifying...' : 'Verify & Login'}
            </button>
          </form>
        )}

        {/* ===== EMAIL MODE ===== */}
        {loginMode === 'email' && step === 'input' && (
          <form onSubmit={handleSendEmailOTP}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" autoFocus
                style={{ width: '100%', padding: '12px 14px', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 16, fontWeight: 600, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <button type="submit" disabled={sending || !email.trim()}
              style={{ width: '100%', padding: '14px 20px', background: '#2e7d32', color: 'white', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 16, fontWeight: 900, cursor: sending || !email.trim() ? 'not-allowed' : 'pointer', boxShadow: '4px 4px 0 #1a1a1a', textTransform: 'uppercase', letterSpacing: '1px', opacity: sending || !email.trim() ? 0.6 : 1 }}>
              {sending ? 'Sending...' : 'Send OTP'}
            </button>
          </form>
        )}

        {loginMode === 'email' && step === 'otp' && (
          <form onSubmit={handleVerifyEmailOTP}>
            {info && <div style={{ padding: '10px 14px', background: '#e8f5e9', border: '2px solid #2e7d32', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 700, color: '#2e7d32' }}>{info}</div>}
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Enter 6-Digit OTP</label>
              <input type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength={6} autoFocus
                style={{ width: '100%', padding: '14px', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 28, fontWeight: 900, textAlign: 'center', letterSpacing: '8px', outline: 'none', fontFamily: 'JetBrains Mono, monospace', boxSizing: 'border-box' }} />
            </div>
            <p style={{ fontSize: 12, color: '#888', marginBottom: 16, textAlign: 'center' }}>
              Sent to {email}&nbsp;
              <button type="button" onClick={resetForm}
                style={{ background: 'none', border: 'none', color: '#2e7d32', fontWeight: 800, cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>Change</button>
            </p>
            <button type="submit" disabled={sending || otp.length !== 6}
              style={{ width: '100%', padding: '14px 20px', background: '#2e7d32', color: 'white', border: '3px solid #1a1a1a', borderRadius: 8, fontSize: 16, fontWeight: 900, cursor: (sending || otp.length !== 6) ? 'not-allowed' : 'pointer', boxShadow: '4px 4px 0 #1a1a1a', textTransform: 'uppercase', letterSpacing: '1px', opacity: (sending || otp.length !== 6) ? 0.6 : 1 }}>
              {sending ? 'Verifying...' : 'Verify & Login'}
            </button>
          </form>
        )}

        {/* Error */}
        {error && <div style={{ padding: '10px 14px', background: '#ffebee', border: '2px solid #ef5350', borderRadius: 8, marginTop: 16, fontSize: 13, fontWeight: 700, color: '#c62828' }}>{error}</div>}

        {/* Contextual info */}
        <p style={{ textAlign: 'center', fontSize: 12, color: '#aaa', marginTop: 24, fontWeight: 600 }}>
          {loginMode === 'phone'
            ? 'Login as Employee or Client with your registered phone'
            : 'Login as Client with your registered email'}
        </p>
        <p style={{ textAlign: 'center', fontSize: 11, color: '#ccc', marginTop: 8 }}>Only authorized users can login. Contact administrator for access.</p>
        <div id="recaptcha-container"></div>
      </div>
    </div>
  );
}
