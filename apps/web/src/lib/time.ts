export type MinuteFormatOptions = {
  // Unit to use for minutes when under one hour
  minUnit?: 'm' | 'mins';
  // Unit to use for hours when one hour or more
  hourUnit?: 'h' | 'hrs';
  // Decimal places for hour value
  decimals?: number;
};

/**
 * Format a minute count into a human label.
 * - < 60 minutes => "Xm" or "X mins"
 * - >= 60 minutes => "Y hrs" (rounded to given decimals, default 2)
 */
export function formatMinutesLabel(
  mins?: number,
  opts: MinuteFormatOptions = {}
): string {
  if (mins === undefined || mins === null || isNaN(mins as any)) return '-';
  const m = Math.max(0, Math.round(mins));
  const minUnit = opts.minUnit ?? 'mins';
  const hourUnit = opts.hourUnit ?? 'hrs';
  const decimals = typeof opts.decimals === 'number' ? opts.decimals : 2;

  if (m < 60) return `${m} ${minUnit}`;

  const hours = m / 60;
  // Limit to desired decimals and trim trailing zeros
  const str = hours
    .toFixed(decimals)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
  return `${str} ${hourUnit}`;
}

