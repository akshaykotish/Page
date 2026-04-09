import { auth } from '../firebase';

const BASE = '/api';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 60000;

// ─── Token Management ─────────────────────────────────────────────────────────

async function getToken() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (err) {
    console.error('Failed to get auth token:', err.message);
    return null;
  }
}

// ─── Request Interceptors ─────────────────────────────────────────────────────

const requestInterceptors = [];
const responseInterceptors = [];

export function addRequestInterceptor(fn) {
  requestInterceptors.push(fn);
  return () => {
    const idx = requestInterceptors.indexOf(fn);
    if (idx > -1) requestInterceptors.splice(idx, 1);
  };
}

export function addResponseInterceptor(fn) {
  responseInterceptors.push(fn);
  return () => {
    const idx = responseInterceptors.indexOf(fn);
    if (idx > -1) responseInterceptors.splice(idx, 1);
  };
}

// ─── Core Request Function ────────────────────────────────────────────────────

async function request(path, options = {}, retryCount = 0) {
  const token = await getToken();

  let config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(options.timeout || REQUEST_TIMEOUT_MS),
    ...options,
  };

  // Run request interceptors
  for (const interceptor of requestInterceptors) {
    config = await interceptor(config);
  }

  let res;
  try {
    res = await fetch(`${BASE}${path}`, config);
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new ApiError('Request timed out. Please try again.', 0, 'TIMEOUT');
    }

    // Retry on network errors
    if (retryCount < MAX_RETRIES && !options.noRetry) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
      return request(path, options, retryCount + 1);
    }

    throw new ApiError('Network error. Please check your connection.', 0, 'NETWORK_ERROR');
  }

  // Run response interceptors
  for (const interceptor of responseInterceptors) {
    await interceptor(res);
  }

  // Handle no-content responses
  if (res.status === 204) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    if (res.ok) return null;
    throw new ApiError(`Server error (${res.status})`, res.status, 'PARSE_ERROR');
  }

  if (!res.ok) {
    // Token expired — try refreshing and retry once
    if (res.status === 401 && data?.code === 'TOKEN_EXPIRED' && retryCount === 0) {
      const user = auth.currentUser;
      if (user) {
        try {
          await user.getIdToken(true); // Force refresh
          return request(path, options, retryCount + 1);
        } catch {
          // Redirect to login
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
      }
    }

    // Rate limited — retry after delay
    if (res.status === 429 && retryCount < MAX_RETRIES && !options.noRetry) {
      const retryAfter = (data?.retryAfter || 5) * 1000;
      await new Promise(resolve => setTimeout(resolve, retryAfter));
      return request(path, options, retryCount + 1);
    }

    throw new ApiError(
      data?.error || `Request failed (${res.status})`,
      res.status,
      data?.code || 'API_ERROR',
      data?.details
    );
  }

  return data;
}

// ─── Custom Error Class ───────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};
