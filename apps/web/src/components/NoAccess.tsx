import { ShieldAlert } from "lucide-react";

export default function NoAccess({
  message = "You don't have access to this page.",
}: {
  message?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-border bg-surface p-6 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-error/10 text-error">
        <ShieldAlert size={24} />
      </div>
      <h2 className="mb-1 text-lg font-semibold">Access denied</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
