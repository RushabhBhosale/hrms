export function isValidEmail(email: string) {
  const v = (email ?? '').trim();
  if (v.length <= 5) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function isValidPassword(password: string) {
  return typeof password === 'string' && password.length > 5;
}

export function normalizePhone(phone: string) {
  return String(phone ?? '').replace(/\D/g, '');
}

export function isValidPhone(phone: string) {
  return normalizePhone(phone).length === 10;
}

