function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const v = email.trim();
  if (v.length <= 5) return false;
  // Simple RFC-like pattern used elsewhere in the repo
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  return password.length > 5; // more than 5 characters
}

function normalizePhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits;
}

function isValidPhone(phone) {
  const digits = normalizePhone(phone);
  return digits.length === 10;
}

module.exports = {
  isValidEmail,
  isValidPassword,
  isValidPhone,
  normalizePhone,
};

