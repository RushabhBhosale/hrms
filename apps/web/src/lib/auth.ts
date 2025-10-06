export type PrimaryRole = "SUPERADMIN" | "ADMIN" | "EMPLOYEE";
export type SubRole = string;

export type LeaveBalances = {
  casual: number;
  paid: number;
  unpaid: number;
  sick: number;
};

export type LeaveTypeCaps = {
  paid: number;
  casual: number;
  sick: number;
};

export type BankDetails = {
  accountNumber?: string;
  bankName?: string;
  ifsc?: string;
};

export type PermissionActions = Record<string, boolean>;
export type PermissionMap = Record<string, PermissionActions>;

export type Employee = {
  id: string;
  name: string;
  email: string;
  personalEmail?: string;
  phone?: string;
  address?: string;
  dob?: string;
  joiningDate?: string;
  createdAt?: string;
  primaryRole: PrimaryRole;
  subRoles: SubRole[];
  company?: string;
  leaveBalances: LeaveBalances;
  totalLeaveAvailable?: number;
  leaveTypeCaps?: LeaveTypeCaps;
  employeeId?: string;
  aadharNumber?: string;
  panNumber?: string;
  bankDetails?: BankDetails;
  permissions?: PermissionMap;
};

function parseJwt(token: string): any | null {
  try {
    const base64 = token.split(".")[1];
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function setAuth(token: string, employee: Employee) {
  localStorage.setItem("token", token);
  localStorage.setItem("employee", JSON.stringify(employee));
}

export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("employee");
}

export function getEmployee(): Employee | null {
  const token = localStorage.getItem("token");
  if (!token) return null;

  const payload = parseJwt(token);
  if (!payload?.exp || payload.exp * 1000 <= Date.now()) {
    clearAuth();
    return null;
  }

  const raw = localStorage.getItem("employee");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Employee;
  } catch {
    return null;
  }
}

export function hasPermission(
  employee: Employee | null,
  moduleKey: string,
  action: string = "read"
): boolean {
  if (!employee) return false;
  if (
    employee.primaryRole === "ADMIN" ||
    employee.primaryRole === "SUPERADMIN"
  ) {
    return true;
  }
  const perms = employee.permissions || {};
  const modulePerms = perms[moduleKey];
  if (!modulePerms) return false;
  if (action === "read") {
    return !!modulePerms.read || !!modulePerms.write || !!modulePerms[action];
  }
  return !!modulePerms[action];
}
