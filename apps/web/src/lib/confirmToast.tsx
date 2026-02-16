import type { ReactNode } from "react";
import { toast } from "react-hot-toast";
import { Button } from "../components/ui/button";

type ConfirmToastOptions = {
  title: ReactNode;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning";
};

export function confirmToast({
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
}: ConfirmToastOptions) {
  return new Promise<boolean>((resolve) => {
    const accent =
      variant === "danger"
        ? {
            wrap: "border-error/30 bg-error/10",
            variant: "destructive" as const,
          }
        : {
            wrap: "border-warning/30 bg-warning/10",
            variant: "secondary" as const,
          };

    toast.custom(
      (t) => (
        <div
          className={`w-[min(420px,92vw)] rounded-md border ${accent.wrap} bg-surface px-4 py-3 shadow`}
        >
          <div className="font-medium text-sm">{title}</div>
          {message && (
            <div className="mt-1 text-xs text-muted-foreground">{message}</div>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                toast.dismiss(t.id);
                resolve(false);
              }}
            >
              {cancelText}
            </Button>
            <Button
              variant={accent.variant}
              size="sm"
              onClick={() => {
                toast.dismiss(t.id);
                resolve(true);
              }}
            >
              {confirmText}
            </Button>
          </div>
        </div>
      ),
      { duration: Infinity },
    );
  });
}
