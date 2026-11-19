import { API_URL } from './apiUrl.js';

const PENDING_ROLE_KEY = 'meathub-pending-role';
const CACHED_ROLE_KEY = 'meathub-account-role';
const VALID_ROLES = ['buyer', 'seller', 'rider'];

export function cacheAccountRole(uid, { role, isAdmin }) {
  if (!uid || !VALID_ROLES.includes(role)) return;
  try {
    localStorage.setItem(CACHED_ROLE_KEY, JSON.stringify({ uid, role, isAdmin: isAdmin === true }));
  } catch {
    // Private browsing can refuse storage; the offline fallback just stays unavailable.
  }
}

export function readCachedAccountRole(uid) {
  if (!uid) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHED_ROLE_KEY) || 'null');
    if (!cached || cached.uid !== uid || !VALID_ROLES.includes(cached.role)) return null;
    return { role: cached.role, isAdmin: cached.isAdmin === true };
  } catch {
    return null;
  }
}

export function clearCachedAccountRole() {
  localStorage.removeItem(CACHED_ROLE_KEY);
}

export async function saveAccountRole(user, role) {
  const response = await fetch(`${API_URL}/api/profile/role`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await user.getIdToken()}`
    },
    body: JSON.stringify({ role })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || `Could not save your account type (${response.status}).`);
    error.status = response.status;
    throw error;
  }
}

export function rememberPendingAccountRole(email, role) {
  localStorage.setItem(PENDING_ROLE_KEY, JSON.stringify({
    email: email.trim().toLowerCase(),
    role
  }));
}

export function clearPendingAccountRole() {
  localStorage.removeItem(PENDING_ROLE_KEY);
}

export async function applyPendingAccountRole(user) {
  const pending = JSON.parse(localStorage.getItem(PENDING_ROLE_KEY) || 'null');
  if (!pending || pending.email !== user.email?.trim().toLowerCase()) return;
  if (!['buyer', 'seller', 'rider'].includes(pending.role)) {
    throw new Error('The saved account type is invalid. Create a new account or contact support.');
  }
  try {
    await saveAccountRole(user, pending.role);
  } catch (error) {
    // The account already has a type saved, so sign-in should continue with that one.
    if (error.status !== 409) throw error;
  }
  clearPendingAccountRole();
}
