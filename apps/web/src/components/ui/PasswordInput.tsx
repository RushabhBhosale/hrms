"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { FieldError, UseFormRegisterReturn } from "react-hook-form";

interface PasswordFieldProps {
  label?: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
}

export function PasswordField({
  label,
  registration,
  error,
}: PasswordFieldProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="space-y-1">
      {label && (
        <label className="text-sm font-medium required-label">{label}</label>
      )}
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          className={`w-full border border-border bg-bg rounded px-3 h-10 pr-10 outline-none focus:ring-2 focus:ring-primary ${
            error ? "border-error" : ""
          }`}
          {...registration}
        />
        <button
          type="button"
          onClick={() => setShow((p) => !p)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error && <p className="text-xs text-error mt-1">{error.message}</p>}
    </div>
  );
}
