const DEFAULT_SANDWICH_MIN_DAYS = 5;

function normalizeSandwichMinDays(value, fallback = DEFAULT_SANDWICH_MIN_DAYS) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 1)
    return Math.max(1, Math.floor(Number(fallback) || DEFAULT_SANDWICH_MIN_DAYS));
  return Math.max(1, Math.floor(raw));
}

module.exports = {
  DEFAULT_SANDWICH_MIN_DAYS,
  normalizeSandwichMinDays,
};
