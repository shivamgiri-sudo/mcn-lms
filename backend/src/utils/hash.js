import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

export const CRED_HASH_PREFIX = 'v1$bcrypt$';

export function generateSalt() {
  return randomBytes(16).toString('hex');
}

export async function hashPassword(password, salt) {
  return bcrypt.hash(password + salt, 10);
}

export async function verifyPassword(password, salt, hash) {
  return bcrypt.compare(password + salt, hash);
}

export function isHashedCredential(value) {
  return String(value || '').startsWith(CRED_HASH_PREFIX);
}

export async function hashCredential(value) {
  const salt = generateSalt();
  const digest = await hashPassword(String(value || ''), salt);
  return `${CRED_HASH_PREFIX}${salt}$${digest}`;
}

export async function verifyCredential(value, storedValue) {
  const stored = String(storedValue || '');
  if (!stored) return false;

  // Backward compatibility: existing PINs stored as plain text continue to work
  // and are upgraded to the hashed format after a successful login.
  if (!isHashedCredential(stored)) return String(value || '').trim() === stored.trim();

  const payload = stored.slice(CRED_HASH_PREFIX.length);
  const separator = payload.indexOf('$');
  if (separator <= 0) return false;

  const salt = payload.slice(0, separator);
  const hash = payload.slice(separator + 1);
  return verifyPassword(String(value || ''), salt, hash);
}

export function normalize(str) {
  return String(str || '').toLowerCase().trim().replace(/\s+/g, '');
}

export function generateId(prefix = '') {
  return `${prefix}${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

// Every account-creation path must derive the first-time password the same way.
// HRMS sync and the coordinator portal used to generate a random string that was
// hashed and then discarded (HRMS) or only ever sent over email/SMS (coordinator),
// which left the account unusable whenever delivery was not configured.
// forcePasswordReset still forces a change at first login.
export function firstTimePassword(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '1234';
}
