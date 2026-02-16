import { api } from "./api";

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
  attendanceStartDate?: string;
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
  uan?: string;
  bankDetails?: BankDetails;
  profileImage?: string | null;
  permissions?: PermissionMap;
};

const AUTH_EVENT_KEY = "auth:changed";

let cachedToken: string | null = null;
let cachedEmployeeRaw: string | null = null;
let cachedEmployee: Employee | null = null;
let cachedTokenExpMs: number | null = null;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures (private mode, quotas, etc.)
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function notifyAuthChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EVENT_KEY));
}

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
  const raw = JSON.stringify(employee);
  safeSet("token", token);
  safeSet("employee", raw);
  const tokenChanged = cachedToken !== token;
  const employeeChanged = cachedEmployeeRaw !== raw;
  cachedToken = token;
  cachedEmployee = employee;
  cachedEmployeeRaw = raw;
  const payload = parseJwt(token);
  cachedTokenExpMs = payload?.exp ? payload.exp * 1000 : null;
  if (tokenChanged || employeeChanged) notifyAuthChange();
}

export function clearAuth() {
  safeRemove("token");
  safeRemove("employee");
  cachedToken = null;
  cachedEmployee = null;
  cachedEmployeeRaw = null;
  cachedTokenExpMs = null;
  notifyAuthChange();
}

export function getEmployee(): Employee | null {
  const token = safeGet("token");
  if (!token) {
    cachedToken = null;
    cachedEmployee = null;
    cachedEmployeeRaw = null;
    cachedTokenExpMs = null;
    return null;
  }

  if (cachedToken !== token) {
    const payload = parseJwt(token);
    cachedTokenExpMs = payload?.exp ? payload.exp * 1000 : null;
    cachedToken = token;
  }

  if (cachedTokenExpMs === null) {
    clearAuth();
    return null;
  }

  if (cachedTokenExpMs && cachedTokenExpMs <= Date.now()) {
    clearAuth();
    return null;
  }

  const raw = safeGet("employee");
  if (!raw) {
    clearAuth();
    return null;
  }

  if (raw !== cachedEmployeeRaw) {
    try {
      cachedEmployee = JSON.parse(raw) as Employee;
      cachedEmployeeRaw = raw;
    } catch {
      cachedEmployee = null;
      cachedEmployeeRaw = null;
      clearAuth();
      return null;
    }
  }

  return cachedEmployee;
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

export function subscribeToAuthChanges(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(AUTH_EVENT_KEY, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(AUTH_EVENT_KEY, handler);
    window.removeEventListener("storage", handler);
  };
}

export async function refreshEmployeeFromApi(): Promise<Employee | null> {
  const token = localStorage.getItem("token");
  if (!token) return null;
  try {
    const res = await api.get("/auth/me", { skipToast: true });
    const employee: Employee | undefined = res?.data?.employee;
    if (employee) {
      setAuth(token, employee);
      return employee;
    }
  } catch (err: any) {
    if (err?.response?.status === 401) {
      clearAuth();
      return null;
    }
    throw err;
  }
  return null;
}
