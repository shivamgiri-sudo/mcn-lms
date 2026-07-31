const BLOCKED_NORMALIZED = new Set([
  'password123',
  'welcome123',
  'qwerty1234',
  'changeme123',
  'letmein123',
  'company123',
]);

export function validateStrongPassword(password, identityValues = []) {
  const value = String(password || '');
  if (value.length < 10) return 'Password must contain at least 10 characters.';
  if (value.length > 128) return 'Password cannot exceed 128 characters.';
  if (!/[a-z]/.test(value)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Password must include an uppercase letter.';
  if (!/\d/.test(value)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include a special character.';

  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (BLOCKED_NORMALIZED.has(normalized)) return 'Choose a less predictable password.';
  if (/^(.)\1{9,}$/.test(value)) return 'Password cannot repeat the same character.';

  for (const identity of identityValues) {
    const identityNormalized = String(identity || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (identityNormalized.length >= 4 && normalized.includes(identityNormalized)) {
      return 'Password cannot contain your login ID, employee ID, email, or mobile number.';
    }
  }
  return null;
}
