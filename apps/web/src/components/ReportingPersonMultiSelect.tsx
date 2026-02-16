import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

type Option = {
  value: string;
  label: string;
};

type Props = {
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  onBlur?: () => void;
  disabled?: boolean;
  emptyMessage?: string;
  placeholder?: string;
  showEmpty?: boolean;
};

export default function ReportingPersonMultiSelect({
  options,
  value,
  onChange,
  onBlur,
  disabled,
  emptyMessage = "No employees available",
  showEmpty,
  placeholder = "Search employees",
}: Props) {
  const [query, setQuery] = useState("");
  const selected = useMemo(
    () => (Array.isArray(value) ? value.filter(Boolean) : []),
    [value],
  );
  const selectedOptions = useMemo(() => {
    const map = new Map(options.map((o) => [o.value, o.label]));
    return selected.map((v) => ({
      value: v,
      label: map.get(v) || v,
    }));
  }, [selected, options]);
  const available = useMemo(
    () => options.filter((o) => !selected.includes(o.value)),
    [options, selected],
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const base = available.filter((o) => o.label.toLowerCase().includes(term));
    return base.slice(0, 12);
  }, [available, query]);
  const showDropdown = query.trim().length > 0;
  const [highlighted, setHighlighted] = useState<string | null>(null);

  function add(value: string) {
    if (!value || selected.includes(value) || disabled) return;
    onChange([...selected, value]);
    setQuery("");
    setHighlighted(null);
  }

  function remove(value: string) {
    if (disabled) return;
    onChange(selected.filter((v) => v !== value));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!filtered.length) return;
      const currentIdx = filtered.findIndex((f) => f.value === highlighted);
      const next = filtered[(currentIdx + 1) % filtered.length];
      setHighlighted(next.value);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      const currentIdx = filtered.findIndex((f) => f.value === highlighted);
      const next =
        currentIdx <= 0
          ? filtered[filtered.length - 1]
          : filtered[currentIdx - 1];
      setHighlighted(next.value);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target =
        filtered.find((f) => f.value === highlighted) || filtered[0];
      if (target) add(target.value);
    }
    if (e.key === "Backspace" && !query && selected.length) {
      remove(selected[selected.length - 1]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          className="w-full h-10 rounded border border-border bg-bg px-3 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        {showDropdown && (
          <div className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-border bg-surface shadow-lg max-h-48 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {available.length === 0
                  ? "All employees selected"
                  : "No matches. Keep typing to search."}
              </div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm disabled:opacity-60 ${
                    highlighted === option.value
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-bg"
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(option.value)}
                  onMouseEnter={() => setHighlighted(option.value)}
                  disabled={disabled}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="min-h-[2rem] flex flex-wrap gap-2">
        {selectedOptions.length === 0
          ? !showEmpty && (
              <div className="text-xs text-muted-foreground">
                No employees selected.
              </div>
            )
          : selectedOptions.map((opt) => (
              <span
                key={opt.value}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/30 px-2 py-1 text-xs"
              >
                {opt.label}
                {!disabled && (
                  <button
                    type="button"
                    className="text-primary/70 hover:text-primary"
                    onClick={() => remove(opt.value)}
                    aria-label={`Remove ${opt.label}`}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
      </div>
    </div>
  );
}
