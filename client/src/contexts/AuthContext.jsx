import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, signOut, signInWithPhoneNumber, RecaptchaVerifier, signInWithCustomToken } from 'firebase/auth';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

// ─── Session Timeout Config ───────────────────────────────────────────────────
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
const TOKEN_REFRESH_INTERVAL_MS = 50 * 60 * 1000; // Refresh token every 50 minutes
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const lastActivityRef = useRef(Date.now());
  const tokenRefreshTimerRef = useRef(null);
  const sessionTimerRef = useRef(null);

  // ─── Activity Tracking ────────────────────────────────────────────────────
  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    ACTIVITY_EVENTS.forEach(event => window.addEventListener(event, updateActivity, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach(event => window.removeEventListener(event, updateActivity));
    };
  }, [updateActivity]);

  // ─── Session Timeout Check ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    sessionTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed > SESSION_TIMEOUT_MS) {
        console.warn('Session timeout due to inactivity');
        logout();
      }
    }, 60_000); // Check every minute

    return () => {
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    };
  }, [user]);

  // ─── Token Refresh ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!firebaseUser) return;

    const refreshToken = async () => {
      try {
        const newToken = await firebaseUser.getIdToken(true);
        setToken(newToken);
      } catch (err) {
        console.error('Token refresh failed:', err.message);
        if (err.code === 'auth/user-token-expired' || err.code === 'auth/user-disabled') {
          logout();
        }
      }
    };

    tokenRefreshTimerRef.current = setInterval(refreshToken, TOKEN_REFRESH_INTERVAL_MS);

    return () => {
      if (tokenRefreshTimerRef.current) clearInterval(tokenRefreshTimerRef.current);
    };
  }, [firebaseUser]);

  // ─── Auth State Observer ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      setAuthError(null);

      if (fbUser) {
        try {
          const t = await fbUser.getIdToken();
          setToken(t);

          const res = await fetch('/api/auth/check-user', {
            method: 'POST',
            headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000),
          });

          if (res.ok) {
            const data = await res.json();
            setUser(data);
            lastActivityRef.current = Date.now();
          } else {
            const err = await res.json().catch(() => ({ error: 'Unknown error' }));
            setUser(null);
            setAuthError(err.error || 'User not registered');
            console.warn('Auth check failed:', err.error);
          }
        } catch (err) {
          setUser(null);
          if (err.name !== 'AbortError') {
            setAuthError('Connection error. Please check your network.');
            console.error('Auth state error:', err.message);
          }
        }
      } else {
        setToken(null);
        setUser(null);
      }
      setLoading(false);
    });

    return unsub;
  }, []);

  // ─── Phone OTP ────────────────────────────────────────────────────────────
  function setupRecaptcha(elementId) {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, elementId, {
        size: 'invisible',
        callback: () => {},
      });
    }
    return window.recaptchaVerifier;
  }

  async function sendOTP(phoneNumber) {
    const formatted = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;
    const appVerifier = setupRecaptcha('recaptcha-container');
    try {
      const confirmation = await signInWithPhoneNumber(auth, formatted, appVerifier);
      return confirmation;
    } catch (err) {
      // Reset recaptcha on failure
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
      throw err;
    }
  }

  // ─── Custom Token Sign In ─────────────────────────────────────────────────
  async function signInWithToken(customToken) {
    const result = await signInWithCustomToken(auth, customToken);
    return result;
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  async function logout() {
    // Clear timers
    if (tokenRefreshTimerRef.current) clearInterval(tokenRefreshTimerRef.current);
    if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);

    // Clear recaptcha
    if (window.recaptchaVerifier) {
      try { window.recaptchaVerifier.clear(); } catch {}
      window.recaptchaVerifier = null;
    }

    await signOut(auth);
    setUser(null);
    setToken(null);
    setAuthError(null);
  }

  // ─── Get Fresh Token ──────────────────────────────────────────────────────
  async function getToken() {
    if (firebaseUser) {
      try {
        const t = await firebaseUser.getIdToken(true);
        setToken(t);
        return t;
      } catch (err) {
        console.error('getToken failed:', err.message);
        if (err.code === 'auth/user-token-expired') {
          await logout();
        }
        return null;
      }
    }
    return null;
  }

  // ─── Role Helpers ─────────────────────────────────────────────────────────
  const isSuperadmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || isSuperadmin;
  const isEmployee = user?.role === 'employee' || isAdmin;
  const isClient = user?.role === 'client';

  return (
    <AuthContext.Provider value={{
      firebaseUser, user, token, loading, authError,
      sendOTP, signInWithToken, logout, getToken, setupRecaptcha,
      isSuperadmin, isAdmin, isEmployee, isClient,
      updateActivity,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
