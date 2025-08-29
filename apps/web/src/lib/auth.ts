export type PrimaryRole = 'SUPERADMIN' | 'ADMIN' | 'EMPLOYEE';
export type SubRole = string;

export type LeaveBalances = {
  casual: number;
  paid: number;
  unpaid: number;
  sick: number;
};

export type BankDetails = {
  accountNumber?: string;
  bankName?: string;
  ifsc?: string;
};

export type Employee = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  dob?: string;
  primaryRole: PrimaryRole;
  subRoles: SubRole[];
  company?: string;
  leaveBalances: LeaveBalances;
  employeeId?: string;
  aadharNumber?: string;
  panNumber?: string;
  bankDetails?: BankDetails;
};

export function setAuth(token: string, employee: Employee) {
  localStorage.setItem('token', token);
  localStorage.setItem('employee', JSON.stringify(employee));
}

export function getEmployee(): Employee | null {
  const raw = localStorage.getItem('employee');
  if (!raw) return null;
  try { return JSON.parse(raw) as Employee } catch { return null }
}

export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('employee');
}
