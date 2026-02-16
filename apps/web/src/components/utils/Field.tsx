interface FieldProps {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}

export function Field({ label, children, required = false }: FieldProps) {
  return (
    <div className="space-y-2">
      <label
        className={`text-sm font-medium ${required ? "required-label" : ""}`}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
