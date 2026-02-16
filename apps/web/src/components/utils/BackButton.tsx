import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";

type BackButtonProps = {
  to?: string;
  label?: string;
  size?: "sm" | "md";
  className?: string;
};

export function BackButton({
  to,
  label = "Back",
  size = "md",
  className,
}: BackButtonProps) {
  const navigate = useNavigate();
  const base =
    size === "sm"
      ? "h-8 px-3 text-xs"
      : "h-10 px-4 text-sm";

  return (
    <Button
      type="button"
      onClick={() => (to ? navigate(to) : navigate(-1))}
      variant="outline"
      size={size === "sm" ? "sm" : "default"}
      className={className}
      aria-label={label}
    >
      <ArrowLeft size={16} />
      {label}
    </Button>
  );
}
