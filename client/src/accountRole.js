import { API_URL } from './apiUrl.js';

const PENDING_ROLE_KEY = 'meathub-pending-role';

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
  await saveAccountRole(user, pending.role);
  clearPendingAccountRole();
}
