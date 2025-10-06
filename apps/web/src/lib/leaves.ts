import { Employee } from "./auth";

export type LeaveType = "PAID" | "CASUAL" | "SICK" | "UNPAID";

export function getEnabledLeaveTypes(employee?: Employee | null): LeaveType[] {
  const caps = employee?.leaveTypeCaps;
  const enabled: LeaveType[] = [];
  if (!caps) {
    enabled.push("PAID", "CASUAL", "SICK", "UNPAID");
    return enabled;
  }
  if ((caps.paid ?? 0) > 0) enabled.push("PAID");
  if ((caps.casual ?? 0) > 0) enabled.push("CASUAL");
  if ((caps.sick ?? 0) > 0) enabled.push("SICK");
  enabled.push("UNPAID");
  return enabled;
}

export function getLeaveTypeLabel(type: LeaveType): string {
  switch (type) {
    case "PAID":
      return "Paid";
    case "CASUAL":
      return "Casual";
    case "SICK":
      return "Sick";
    case "UNPAID":
    default:
      return "Unpaid";
  }
}
