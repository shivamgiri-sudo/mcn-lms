import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

export function generateSalt() {
  return randomBytes(16).toString('hex');
}

export async function hashPassword(password, salt) {
  return bcrypt.hash(password + salt, 10);
}

export async function verifyPassword(password, salt, hash) {
  return bcrypt.compare(password + salt, hash);
}

export function normalize(str) {
  return String(str || '').toLowerCase().trim().replace(/\s+/g, '');
}

export function generateId(prefix = '') {
  return `${prefix}${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;
}
