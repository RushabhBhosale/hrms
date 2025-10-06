import type { ChangeEvent } from "react";

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
};

export default function ReportingPersonMultiSelect({
  options,
  value,
  onChange,
  onBlur,
  disabled,
  emptyMessage = "No employees available",
}: Props) {
  const selected = Array.isArray(value) ? value : [];

  function handleToggle(event: ChangeEvent<HTMLInputElement>) {
    const optionValue = event.target.value;
    const exists = selected.includes(optionValue);
    const next = exists
      ? selected.filter((item) => item !== optionValue)
      : [...selected, optionValue];
    onChange(next);
  }

  return (
    <div className="rounded-md border border-border bg-bg">
      {options.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted">{emptyMessage}</div>
      ) : (
        <ul className="max-h-48 overflow-y-auto divide-y divide-border/70">
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <li key={option.value} className="px-3 py-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    value={option.value}
                    checked={checked}
                    onChange={handleToggle}
                    onBlur={onBlur}
                    disabled={disabled}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
