export type Theme = Partial<{
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
}>;

export function hexToRgbTuple(hex?: string): string | null {
  if (!hex) return null;
  let c = hex.trim();
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) return null;
  if (c.length === 4) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const mapping: Record<string, string> = {
    primary: "--color-primary",
    secondary: "--color-secondary",
    accent: "--color-accent",
    success: "--color-success",
    warning: "--color-warning",
    error: "--color-error",
  };
  Object.entries(theme).forEach(([k, hex]) => {
    const varName = mapping[k];
    const tuple = hexToRgbTuple(hex);
    if (varName && tuple) root.style.setProperty(varName, tuple);
  });
}

export function resetTheme() {
  const root = document.documentElement;
  const vars = [
    "--color-primary",
    "--color-secondary",
    "--color-accent",
    "--color-success",
    "--color-warning",
    "--color-error",
  ];
  vars.forEach((v) => root.style.removeProperty(v));
}
