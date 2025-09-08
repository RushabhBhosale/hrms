import { Leave } from "../../pages/admin/LeaveRequests";

export function StatusBadge({ status }: { status: Leave["status"] }) {
  const map: Record<Leave["status"], string> = {
    PENDING: "bg-accent/10 text-accent",
    APPROVED: "bg-secondary/10 text-secondary",
    REJECTED: "bg-error/10 text-error",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[status]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
